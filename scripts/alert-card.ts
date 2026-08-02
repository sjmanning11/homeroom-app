/**
 * Failure alerting (Session 3C): write a high-priority alert card to the
 * dashboard when a sync step fails, so breakage is visible instead of silent.
 *
 * Usage:  npx tsx scripts/alert-card.ts <platform> <message...>
 *   platform: gmail | skyward | transparent_classroom | parentsquare
 *
 * Idempotent per platform per day (source_ref alert:<platform>:<YYYY-MM-DD>).
 * Also marks the homeroom_sources row status=error.
 */
import { createClient } from '@supabase/supabase-js';
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

const LABELS: Record<string, string> = {
  gmail: 'Gmail sync',
  skyward: 'Skyward sync',
  transparent_classroom: 'Transparent Classroom sync',
  parentsquare: 'ParentSquare sync',
};

async function main() {
  const [platform, ...rest] = process.argv.slice(2);
  const label = LABELS[platform];
  if (!label) throw new Error(`alert-card: unknown platform "${platform}"`);
  const message = (rest.join(' ') || 'No error detail captured.').slice(0, 400);

  const env = loadEnv();
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: source, error: srcErr } = await supabase
    .from('homeroom_sources')
    .upsert({ platform, status: 'error' }, { onConflict: 'platform' })
    .select('id')
    .single();
  if (srcErr || !source) throw new Error(`alert-card: source upsert failed: ${srcErr?.message}`);

  const today = new Date().toISOString().slice(0, 10);
  const { error } = await supabase.from('homeroom_cards').upsert(
    {
      source_id: source.id,
      family_member_id: null,
      category: 'other',
      title: `${label} failed`,
      summary: `${label} hit an error and cards from this source may be stale. Error: ${message}`,
      due_date: null,
      priority: 'high',
      source_ref: `alert:${platform}:${today}`,
    },
    { onConflict: 'source_ref', ignoreDuplicates: true }
  );
  if (error) throw new Error(`alert-card: card upsert failed: ${error.message}`);
  console.log(`alert-card: alert written for ${platform} (${today})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
