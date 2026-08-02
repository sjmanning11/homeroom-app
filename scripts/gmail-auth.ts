/**
 * One-time Gmail OAuth grant (Session 2A).
 *
 * Usage:  npx tsx scripts/gmail-auth.ts
 *
 * Prints an auth URL. Open it on any device, sign in as the family Gmail
 * account, approve. The browser will fail to load http://localhost/?code=...
 * — that's expected. Copy the FULL url from the address bar (or just the
 * code= value) and paste it at the prompt. The refresh token is written to
 * .env.local (GMAIL_REFRESH_TOKEN) and never printed.
 */
import { google } from 'googleapis';
import { readFileSync, appendFileSync, readFileSync as read } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CLIENT_PATH = path.join(ROOT, '.gmail-oauth-client.json');
const ENV_PATH = path.join(ROOT, '.env.local');
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

async function main() {
  const { installed } = JSON.parse(readFileSync(CLIENT_PATH, 'utf8'));
  const oauth2 = new google.auth.OAuth2(
    installed.client_id,
    installed.client_secret,
    'http://localhost'
  );

  const url = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [SCOPE],
  });

  console.log('\nOpen this URL, approve, then paste the resulting URL (or code) below.');
  console.log('The "This site can\u2019t be reached / localhost" error page is expected.\n');
  console.log(url + '\n');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('Paste redirect URL or code: ')).trim();
  rl.close();

  const code = answer.includes('code=')
    ? new URL(answer).searchParams.get('code')!
    : answer;

  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('No refresh_token returned — re-run and make sure you approved with prompt=consent.');
  }

  const env = read(ENV_PATH, 'utf8');
  if (env.includes('GMAIL_REFRESH_TOKEN=')) {
    throw new Error('.env.local already has GMAIL_REFRESH_TOKEN — remove it first if re-authing.');
  }
  appendFileSync(ENV_PATH, `GMAIL_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  console.log('\nRefresh token saved to .env.local. Done.');
}

main().catch((err) => {
  console.error('Auth failed:', err.message);
  process.exit(1);
});
