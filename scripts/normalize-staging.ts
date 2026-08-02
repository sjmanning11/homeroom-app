/**
 * LLM normalization: staging emails → cards (Session 2B).
 *
 * Usage:  npx tsx scripts/normalize-staging.ts [--limit 50]
 *
 * Reads unprocessed homeroom_email_staging rows, asks Claude to classify each
 * into a structured card, inserts into homeroom_cards (idempotent on
 * source_ref = gmail_message_id), then marks the staging row processed.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
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

const CardSchema = z.object({
  category: z.enum([
    'announcement',
    'grade',
    'attendance',
    'event',
    'permission_slip',
    'lunch_menu',
    'other',
  ]),
  title: z.string().describe('Short card title a parent scans on a phone, max ~60 chars'),
  summary: z
    .string()
    .describe('2-3 sentence summary of what the parent needs to know, including any action required'),
  due_date: z
    .string()
    .nullable()
    .describe('YYYY-MM-DD date of the event/deadline if one exists, else null'),
  priority: z
    .enum(['low', 'medium', 'high'])
    .describe('high = action required soon or urgent (discipline, deadline, permission slip); medium = upcoming event or notable info; low = FYI/newsletter'),
  family_member: z
    .string()
    .nullable()
    .describe('Exact name from the provided family member list if the email is about one specific kid, else null for whole-family/general'),
});

async function main() {
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : 50;

  const env = loadEnv();
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: members, error: mErr } = await supabase
    .from('homeroom_family_members')
    .select('id, name, relation')
    .eq('relation', 'kid');
  if (mErr) throw new Error(mErr.message);
  const memberByName = new Map(members!.map((m) => [m.name.toLowerCase(), m.id]));

  const { data: gmailSource, error: sErr } = await supabase
    .from('homeroom_sources')
    .select('id')
    .eq('platform', 'gmail')
    .single();
  if (sErr) throw new Error(sErr.message);

  const { data: rows, error: rErr } = await supabase
    .from('homeroom_email_staging')
    .select('id, gmail_message_id, thread_id, from_address, subject, received_at, body_text')
    .is('processed_at', null)
    .order('received_at', { ascending: true })
    .limit(limit);
  if (rErr) throw new Error(rErr.message);
  console.log(`${rows!.length} unprocessed staging rows`);

  const system = `You turn school emails into dashboard cards for busy parents.
The family's kids are: ${members!.map((m) => m.name).join(', ')}.
Kid attribution: only attribute an email to a specific kid if the email clearly concerns that kid (named in subject/body, their classroom, their teacher). District-wide or school-wide messages are family-level (null).`;

  let created = 0;
  for (const row of rows!) {
    const response = await anthropic.messages.parse({
      model: 'claude-opus-4-6',
      max_tokens: 2000,
      thinking: { type: 'adaptive' },
      system,
      messages: [
        {
          role: 'user',
          content: `From: ${row.from_address}\nSubject: ${row.subject}\nDate: ${row.received_at}\n\n${(row.body_text || '').slice(0, 8000)}`,
        },
      ],
      output_config: { format: zodOutputFormat(CardSchema) },
    });

    const card = response.parsed_output;
    if (!card) throw new Error(`No parsed output for ${row.gmail_message_id}`);

    const familyMemberId = card.family_member
      ? (memberByName.get(card.family_member.toLowerCase()) ?? null)
      : null;

    const { error: iErr } = await supabase.from('homeroom_cards').upsert(
      {
        source_id: gmailSource!.id,
        source_ref: row.gmail_message_id,
        family_member_id: familyMemberId,
        category: card.category,
        title: card.title,
        summary: card.summary,
        raw_link: row.thread_id
          ? `https://mail.google.com/mail/u/0/#inbox/${row.thread_id}`
          : null,
        due_date: card.due_date,
        priority: card.priority,
        created_at: row.received_at ?? new Date().toISOString(),
      },
      { onConflict: 'source_ref', ignoreDuplicates: true }
    );
    if (iErr) throw new Error(`Card insert failed for ${row.gmail_message_id}: ${iErr.message}`);

    const { error: uErr } = await supabase
      .from('homeroom_email_staging')
      .update({ processed_at: new Date().toISOString() })
      .eq('id', row.id);
    if (uErr) throw new Error(`Failed to mark processed: ${uErr.message}`);

    created++;
    console.log(`[${card.priority}] ${card.category}: ${card.title}${card.family_member ? ` (${card.family_member})` : ''}`);
  }

  await supabase
    .from('homeroom_sources')
    .update({ status: 'active', last_synced_at: new Date().toISOString() })
    .eq('id', gmailSource!.id);

  console.log(`Done — ${created} emails normalized.`);
}

main().catch((err) => {
  console.error('Normalize failed:', err.message);
  process.exit(1);
});
