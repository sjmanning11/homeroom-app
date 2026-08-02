/**
 * Gmail fetch pipeline (Session 2A).
 *
 * Usage:  npx tsx scripts/gmail-fetch.ts [--days 30]
 *
 * Pulls school-related emails via the Gmail API (read-only) and upserts them
 * into homeroom_email_staging. Idempotent on gmail_message_id.
 */
import { google, type gmail_v1 } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

// Sender domains for school platforms (spec: Session 2A)
const SENDER_DOMAINS = [
  'parentsquare.com',
  'georgetownisd.org',
  'skyward.com',
  'transparentclassroom.com',
  'community-montessori.org',
];

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function decodeBody(data?: string | null): string {
  if (!data) return '';
  return Buffer.from(data, 'base64url').toString('utf8');
}

/** Prefer text/plain; fall back to stripped text/html. */
function extractText(payload?: gmail_v1.Schema$MessagePart): string {
  if (!payload) return '';
  const parts: gmail_v1.Schema$MessagePart[] = [];
  const walk = (p: gmail_v1.Schema$MessagePart) => {
    parts.push(p);
    p.parts?.forEach(walk);
  };
  walk(payload);

  const plain = parts.find((p) => p.mimeType === 'text/plain' && p.body?.data);
  if (plain) return decodeBody(plain.body!.data);

  const html = parts.find((p) => p.mimeType === 'text/html' && p.body?.data);
  if (html) {
    return decodeBody(html.body!.data)
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return '';
}

function header(msg: gmail_v1.Schema$Message, name: string): string | null {
  return (
    msg.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())
      ?.value ?? null
  );
}

async function main() {
  const daysArg = process.argv.indexOf('--days');
  const days = daysArg > -1 ? Number(process.argv[daysArg + 1]) : 30;

  const env = loadEnv();
  const { installed } = JSON.parse(
    readFileSync(path.join(ROOT, '.gmail-oauth-client.json'), 'utf8')
  );
  const oauth2 = new google.auth.OAuth2(installed.client_id, installed.client_secret);
  oauth2.setCredentials({ refresh_token: env.GMAIL_REFRESH_TOKEN });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });

  const supabase = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY
  );

  const query = `from:(${SENDER_DOMAINS.join(' OR ')}) newer_than:${days}d`;
  console.log(`Query: ${query}`);

  // List all matching message IDs (paginated)
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 100,
      pageToken,
    });
    for (const m of res.data.messages ?? []) if (m.id) ids.push(m.id);
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  console.log(`Matched ${ids.length} messages`);

  const { count: before } = await supabase
    .from('homeroom_email_staging')
    .select('*', { count: 'exact', head: true });

  let processed = 0;
  for (const id of ids) {
    const { data: msg } = await gmail.users.messages.get({
      userId: 'me',
      id,
      format: 'full',
    });

    const receivedMs = msg.internalDate ? Number(msg.internalDate) : null;
    const row = {
      gmail_message_id: msg.id!,
      thread_id: msg.threadId ?? null,
      from_address: header(msg, 'From'),
      subject: header(msg, 'Subject'),
      received_at: receivedMs ? new Date(receivedMs).toISOString() : null,
      snippet: msg.snippet ?? null,
      body_text: extractText(msg.payload ?? undefined).slice(0, 100_000),
      raw: {
        labelIds: msg.labelIds ?? [],
        headers: Object.fromEntries(
          (msg.payload?.headers ?? [])
            .filter((h) => ['from', 'to', 'subject', 'date', 'list-id'].includes(h.name?.toLowerCase() ?? ''))
            .map((h) => [h.name!, h.value])
        ),
      },
    };

    const { error } = await supabase
      .from('homeroom_email_staging')
      .upsert(row, { onConflict: 'gmail_message_id', ignoreDuplicates: true });
    if (error) throw new Error(`Insert failed for ${id}: ${error.message}`);
    processed++;
  }

  const { count: after } = await supabase
    .from('homeroom_email_staging')
    .select('*', { count: 'exact', head: true });
  console.log(
    `Processed ${processed} messages, ${(after ?? 0) - (before ?? 0)} new. Staging table now holds ${after} rows.`
  );
}

main().catch((err) => {
  console.error('Fetch failed:', err.message);
  process.exit(1);
});
