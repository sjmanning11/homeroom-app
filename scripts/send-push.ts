/**
 * Web push for high-priority cards (Session 4B).
 *
 * Usage:  npx tsx scripts/send-push.ts
 *
 * Finds homeroom_cards with priority=high and notified_at null, sends a web
 * push to every subscription in homeroom_push_subscriptions, prunes dead
 * (404/410) subscriptions, then stamps notified_at.
 */
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function main() {
  const env = loadEnv();
  webpush.setVapidDetails(
    env.VAPID_SUBJECT,
    env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY
  );
  const supabase = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: cards, error: cardsErr } = await supabase
    .from('homeroom_cards')
    .select('id, title, summary')
    .eq('priority', 'high')
    .is('notified_at', null);
  if (cardsErr) throw new Error(cardsErr.message);
  if (!cards?.length) {
    console.log('send-push: no unnotified high-priority cards');
    return;
  }

  const { data: subs, error: subsErr } = await supabase
    .from('homeroom_push_subscriptions')
    .select('id, endpoint, p256dh, auth');
  if (subsErr) throw new Error(subsErr.message);
  if (!subs?.length) {
    console.log(`send-push: ${cards.length} card(s) pending but no subscriptions; leaving unnotified`);
    return;
  }

  const dead = new Set<string>();
  let sent = 0;
  for (const card of cards) {
    const payload = JSON.stringify({
      title: card.title,
      body: card.summary ?? '',
      tag: `card-${card.id}`,
      url: '/',
    });
    for (const sub of subs) {
      if (dead.has(sub.id)) continue;
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) dead.add(sub.id);
        else console.error(`send-push: failed for sub ${sub.id}: ${status ?? e}`);
      }
    }
    const { error } = await supabase
      .from('homeroom_cards')
      .update({ notified_at: new Date().toISOString() })
      .eq('id', card.id);
    if (error) console.error(`send-push: failed to stamp card ${card.id}: ${error.message}`);
  }

  if (dead.size) {
    const { error } = await supabase
      .from('homeroom_push_subscriptions')
      .delete()
      .in('id', [...dead]);
    if (error) console.error(`send-push: prune failed: ${error.message}`);
    else console.log(`send-push: pruned ${dead.size} dead subscription(s)`);
  }
  console.log(`send-push: ${cards.length} card(s), ${sent} push(es) sent`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
