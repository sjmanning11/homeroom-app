/**
 * Skyward Family Access scraper (Session 3A).
 *
 * Usage:
 *   npx tsx scripts/skyward-fetch.ts --dump          # login + print raw page text (recon)
 *   npx tsx scripts/skyward-fetch.ts                 # login + extract grades/attendance
 *
 * Auth: SKYWARD_URL / SKYWARD_USER / SKYWARD_PASS in .env.local.
 * Session cookies persisted to .skyward-state.json to avoid repeated logins.
 * Fails loudly on bad credentials, MFA prompts, or unexpected page layout.
 */
import { chromium, type BrowserContext, type Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const STATE_FILE = path.join(ROOT, '.skyward-state.json');

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const env = loadEnv();
for (const key of ['SKYWARD_URL', 'SKYWARD_USER', 'SKYWARD_PASS']) {
  if (!env[key]) throw new Error(`Missing ${key} in .env.local`);
}

async function login(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();

  // With valid saved cookies, the home program loads directly; otherwise
  // Skyward bounces back to the login page.
  const homeUrl = env.SKYWARD_URL.replace(/seplog01\.w$/, 'sfhome01.w');
  await page.goto(homeUrl, { waitUntil: 'networkidle', timeout: 60000 });
  const homeBody = (await page.textContent('body').catch(() => '')) ?? '';
  if (
    !page.url().includes('seplog01') &&
    !/session has expired|logged out/i.test(homeBody) &&
    (await page.locator('a:text-is("Attendance")').count()) > 0
  ) {
    console.log('skyward: reused saved session');
    return page;
  }
  await page.goto(env.SKYWARD_URL, { waitUntil: 'networkidle', timeout: 60000 });

  await page.fill('#login', env.SKYWARD_USER);
  await page.fill('#password', env.SKYWARD_PASS);

  // Successful login opens Family Access in a new window.
  const popupPromise = context.waitForEvent('page', { timeout: 30000 }).catch(() => null);
  await page.click('#bLogin');

  // Watch for explicit failure states on the login page while waiting.
  const popup = await popupPromise;
  if (!popup) {
    const mfaVisible = await page.isVisible('#securityCode').catch(() => false);
    const bodyText = (await page.textContent('body').catch(() => '')) ?? '';
    if (mfaVisible && /security code|verification/i.test(bodyText)) {
      throw new Error(
        'skyward: MFA security code requested — cannot proceed headless. ' +
          'Log in manually once with "trust this device", or disable MFA.'
      );
    }
    const err = bodyText.match(/invalid login|incorrect|failed|locked/i);
    throw new Error(
      `skyward: login did not open Family Access window${err ? ` (page says: "${err[0]}")` : ''}. ` +
        'Possible bad credentials or layout change.'
    );
  }

  await popup.waitForLoadState('networkidle', { timeout: 60000 });
  if (!/sfhome|Family Access/i.test(popup.url() + (await popup.title()))) {
    throw new Error(
      `skyward: unexpected post-login page "${await popup.title()}" at ${popup.url()}`
    );
  }
  console.log('skyward: logged in, landed on', await popup.title());
  await context.storageState({ path: STATE_FILE });
  return popup;
}

async function dumpNav(page: Page) {
  console.log('=== NAV LINKS ===');
  const links = await page.$$eval('a', (as) =>
    as
      .map((a) => ({ id: a.id, text: (a.textContent || '').trim().slice(0, 50) }))
      .filter((l) => l.text)
      .slice(0, 60)
  );
  console.table(links);
  console.log('=== BODY TEXT (first 3000 chars) ===');
  console.log(((await page.textContent('body')) ?? '').replace(/\s+/g, ' ').slice(0, 3000));
}

async function gotoSection(page: Page, label: string) {
  // Nav element ids are randomized per session; find the sidebar tile by text.
  const link = page.locator(`a:text-is("${label}")`).last();
  if ((await link.count()) === 0) throw new Error(`skyward: no nav link "${label}"`);
  await link.click();
  await page.waitForLoadState('networkidle', { timeout: 60000 });
}

type CardInsert = {
  source_id: string;
  family_member_id: string | null;
  category: 'attendance' | 'grade';
  title: string;
  summary: string;
  due_date: null;
  priority: 'high' | 'medium';
  source_ref: string;
};

async function extract(page: Page) {
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // Source row + kid members for attribution.
  const { data: source, error: srcErr } = await supabase
    .from('homeroom_sources')
    .upsert({ platform: 'skyward', status: 'active' }, { onConflict: 'platform' })
    .select('id')
    .single();
  if (srcErr || !source) throw new Error(`skyward: source upsert failed: ${srcErr?.message}`);
  const { data: members, error: memErr } = await supabase
    .from('homeroom_family_members')
    .select('id, name')
    .eq('relation', 'kid');
  if (memErr) throw new Error(memErr.message);
  const memberByFirst = new Map(
    (members ?? []).map((m) => [m.name.split(' ')[0].toLowerCase(), m.id])
  );

  const cards: CardInsert[] = [];

  // --- Attendance ---
  await gotoSection(page, 'Attendance');
  const attText = ((await page.textContent('#sf_ContentRight, body')) ?? '').replace(/\s+/g, ' ');
  const todayMatch = attText.match(/Today's Attendance:\s*([A-Za-z]{3} [A-Za-z]{3} \d{1,2}, \d{4})/);
  if (!todayMatch) {
    throw new Error('skyward: attendance page layout changed — "Today\'s Attendance" not found');
  }
  console.log(`skyward: attendance page OK (${todayMatch[1]})`);
  // Absence/tardy rows render as "<Weekday> <Mon> <D>, <YYYY> ... Absent|Tardy ..." entries.
  const absRe =
    /([A-Za-z]{3} [A-Za-z]{3} \d{1,2}, \d{4})[^.]{0,120}?(Absent|Tardy|Excused|Unexcused)/g;
  for (const m of attText.matchAll(absRe)) {
    const [, dateStr, kind] = m;
    const iso = new Date(dateStr).toISOString().slice(0, 10);
    const who = attText.match(/recorded for (\w+)/)?.[1] ?? members?.[0]?.name.split(' ')[0] ?? '';
    cards.push({
      source_id: source.id,
      family_member_id: memberByFirst.get(who.toLowerCase()) ?? null,
      category: 'attendance',
      title: `${who} marked ${kind} on ${dateStr}`,
      summary: `Skyward attendance shows ${kind.toLowerCase()} for ${who} on ${dateStr}. Check Family Access for details or submit an absence request if needed.`,
      due_date: null,
      priority: 'high',
      source_ref: `skyward:att:${who.toLowerCase()}:${iso}:${kind.toLowerCase()}`,
    });
  }

  // --- Test scores / grades ---
  await gotoSection(page, 'Test Scores');
  const bodyText = ((await page.textContent('body')) ?? '').replace(/\s+/g, ' ');
  const scoreLinks = await page.$$eval('a.showScores', (as) =>
    as.map((a) => ({
      testid: a.getAttribute('data-testid'),
      testdate: a.getAttribute('data-testdate'),
      testname: a.getAttribute('data-testname'),
      student: a.getAttribute('data-stuName') || a.getAttribute('data-stuname'),
    }))
  );
  if (scoreLinks.length === 0 && !/No test scores found/i.test(bodyText)) {
    throw new Error('skyward: test scores page layout changed — no rows and no empty-state text');
  }
  console.log(`skyward: test scores page OK (${scoreLinks.length} score row(s))`);
  for (const s of scoreLinks) {
    if (!s.testid || !s.testname) continue;
    const who = (s.student ?? '').split(' ')[0];
    cards.push({
      source_id: source.id,
      family_member_id: memberByFirst.get(who.toLowerCase()) ?? null,
      category: 'grade',
      title: `${s.testname} scores posted${who ? ` for ${who}` : ''}`,
      summary: `New ${s.testname} results${s.testdate ? ` (${s.testdate})` : ''} are available in Skyward Family Access under Test Scores.`,
      due_date: null,
      priority: 'medium',
      source_ref: `skyward:test:${who.toLowerCase()}:${s.testid}`,
    });
  }

  if (cards.length) {
    const { error } = await supabase
      .from('homeroom_cards')
      .upsert(cards, { onConflict: 'source_ref', ignoreDuplicates: true });
    if (error) throw new Error(`skyward: card upsert failed: ${error.message}`);
  }
  await supabase
    .from('homeroom_sources')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('id', source.id);
  console.log(`skyward: done — ${cards.length} card candidate(s) upserted`);
}

async function main() {
  const dump = process.argv.includes('--dump');
  const pageArg = process.argv.indexOf('--page');
  const section = pageArg > -1 ? process.argv[pageArg + 1] : null;
  const browser = await chromium.launch();
  const context = await browser.newContext(
    existsSync(STATE_FILE) ? { storageState: STATE_FILE } : {}
  );
  try {
    const page = await login(context);
    if (section) {
      await gotoSection(page, section);
      await dumpNav(page);
      return;
    }
    if (dump) {
      await dumpNav(page);
      return;
    }
    await extract(page);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
