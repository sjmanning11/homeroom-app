/**
 * Transparent Classroom scraper for Nora (Session 3B).
 *
 * Usage:
 *   npx tsx scripts/tc-fetch.ts --dump [path]   # login + dump page (recon)
 *   npx tsx scripts/tc-fetch.ts                 # login + extract activity into cards
 *
 * Auth: TC_USER / TC_PASS in .env.local. Session persisted to .tc-state.json
 * ("remember me" cookie), so most runs skip the login form.
 * Fails loudly on bad credentials or layout changes.
 */
import { chromium, type BrowserContext, type Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const STATE_FILE = path.join(ROOT, '.tc-state.json');
const BASE = 'https://www.transparentclassroom.com';

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const env = loadEnv();
for (const key of ['TC_USER', 'TC_PASS']) {
  if (!env[key]) throw new Error(`Missing ${key} in .env.local`);
}

async function login(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/souls/sign_in`, { waitUntil: 'networkidle', timeout: 60000 });

  // A valid remembered session redirects away from the sign-in form.
  if (!page.url().includes('sign_in')) {
    console.log('tc: reused saved session ->', page.url());
    return page;
  }

  await page.fill('#soul_login', env.TC_USER);
  await page.fill('#soul_password', env.TC_PASS);
  // Checkbox is covered by a styled SVG; check the underlying input directly.
  await page.check('#soul_remember_me', { force: true });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 60000 }),
    page.click('input[type=submit][name=commit]'),
  ]);

  if (page.url().includes('sign_in')) {
    const err = (await page.textContent('.alert, .flash, body').catch(() => '')) ?? '';
    throw new Error(
      `tc: login failed — still on sign-in page (${err.trim().slice(0, 120)})`
    );
  }
  console.log('tc: logged in ->', page.url());
  await context.storageState({ path: STATE_FILE });
  return page;
}

async function dump(page: Page, target?: string) {
  if (target) {
    await page.goto(`${BASE}${target}`, { waitUntil: 'networkidle', timeout: 60000 });
  }
  console.log('=== URL:', page.url());
  const links = await page.$$eval('a', (as) =>
    as
      .map((a) => ({ href: a.getAttribute('href')?.slice(0, 60), text: (a.textContent || '').trim().slice(0, 50) }))
      .filter((l) => l.text)
      .slice(0, 50)
  );
  console.table(links);
  console.log('=== BODY (first 2500 chars) ===');
  console.log(((await page.textContent('body')) ?? '').replace(/\s+/g, ' ').slice(0, 2500));
}

async function get(page: Page, target: string) {
  const res = await page.request.get(`${BASE}${target}`);
  console.log('status:', res.status(), 'url:', target);
  const text = await res.text();
  console.log(text.slice(0, 4000));
}

type TcPost = {
  id: number;
  date: string | null;
  created_at: string;
  html: string;
  normalized_text: string | null;
  author: string | null;
  photo_url: string | null;
};

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function extract(page: Page, days: number) {
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: source, error: srcErr } = await supabase
    .from('homeroom_sources')
    .upsert({ platform: 'transparent_classroom', status: 'active' }, { onConflict: 'platform' })
    .select('id')
    .single();
  if (srcErr || !source) throw new Error(`tc: source upsert failed: ${srcErr?.message}`);
  const { data: members, error: memErr } = await supabase
    .from('homeroom_family_members')
    .select('id, name')
    .eq('relation', 'kid');
  if (memErr) throw new Error(memErr.message);
  const memberByFirst = new Map(
    (members ?? []).map((m) => [m.name.split(' ')[0].toLowerCase(), m.id])
  );

  // Kid pages are linked from the nav: /s/<school>/children/<childId> with the
  // child's first name as link text.
  const childLinks = await page.$$eval('a[href*="/children/"]', (as) =>
    as
      .map((a) => ({
        href: a.getAttribute('href') ?? '',
        name: (a.textContent || '').trim(),
      }))
      .filter((l) => /^\/s\/\d+\/children\/\d+/.test(l.href) && /^[A-Z][a-z]+$/.test(l.name))
  );
  const kids = [...new Map(childLinks.map((l) => [l.href.split('?')[0], l])).values()];
  if (kids.length === 0) {
    throw new Error('tc: no child links found in nav — layout change or wrong account');
  }
  console.log(`tc: found ${kids.length} kid(s): ${kids.map((k) => k.name).join(', ')}`);

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const cards = [];
  for (const kid of kids) {
    const childPath = kid.href.split('?')[0];
    const res = await page.request.get(`${BASE}${childPath}/posts.json?locale=en`);
    if (!res.ok()) {
      throw new Error(`tc: posts.json for ${kid.name} returned HTTP ${res.status()}`);
    }
    const posts = (await res.json()) as TcPost[];
    const recent = posts.filter((p) => new Date(p.created_at).getTime() >= cutoff);
    console.log(`tc: ${kid.name} — ${posts.length} post(s), ${recent.length} in last ${days}d`);
    for (const post of recent) {
      // Replace [child_123] tokens with names where known, then strip markup.
      let text = post.normalized_text ?? stripHtml(post.html ?? '');
      text = text.replace(/\[child_(\d+)\]/g, (_, cid) => {
        const match = kids.find((k) => k.href.includes(`/children/${cid}`));
        return match?.name ?? 'a classmate';
      });
      text = stripHtml(text);
      const author = post.author ? stripHtml(post.author) : null;
      const hasStory = text.replace(/[A-Z][a-z]+ [A-Z]\b/g, '').trim().length >= 30;
      cards.push({
        source_id: source.id,
        family_member_id: memberByFirst.get(kid.name.toLowerCase()) ?? null,
        category: 'announcement' as const,
        title: `${kid.name}: new classroom ${post.photo_url ? 'photo' : 'post'}${author ? ` from ${author.split(' ')[0]}` : ''}`,
        summary: hasStory
          ? text.slice(0, 280)
          : `A new ${post.photo_url ? 'photo' : 'post'} of ${kid.name} was shared in Transparent Classroom${post.date ? ` (${post.date})` : ''}.`,
        due_date: null,
        priority: 'low' as const,
        raw_link: `${BASE}${childPath}`,
        created_at: post.created_at,
        source_ref: `tc:post:${post.id}`,
      });
    }
  }

  if (cards.length) {
    const { error } = await supabase
      .from('homeroom_cards')
      .upsert(cards, { onConflict: 'source_ref', ignoreDuplicates: true });
    if (error) throw new Error(`tc: card upsert failed: ${error.message}`);
  }
  await supabase
    .from('homeroom_sources')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('id', source.id);
  console.log(`tc: done — ${cards.length} card candidate(s) upserted`);
}

async function main() {
  const dumpIdx = process.argv.indexOf('--dump');
  const browser = await chromium.launch();
  const context = await browser.newContext(
    existsSync(STATE_FILE) ? { storageState: STATE_FILE } : {}
  );
  try {
    const page = await login(context);
    if (dumpIdx > -1) {
      await dump(page, process.argv[dumpIdx + 1]);
      return;
    }
    const getIdx = process.argv.indexOf('--get');
    if (getIdx > -1) {
      await get(page, process.argv[getIdx + 1]);
      return;
    }
    const daysIdx = process.argv.indexOf('--days');
    await extract(page, daysIdx > -1 ? Number(process.argv[daysIdx + 1]) : 7);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
