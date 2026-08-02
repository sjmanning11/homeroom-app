#!/usr/bin/env bash
# Gmail ingest sync: fetch new school emails, normalize into cards.
# Run by cron every 2h. Logs to ~/homeroom/sync.log.
set -euo pipefail

export PATH="$HOME/.nvm/versions/node/v24.18.1/bin:$PATH"
cd "$HOME/homeroom"

echo "=== sync $(date -Is) ==="
npx tsx scripts/gmail-fetch.ts --days 3
npx tsx scripts/normalize-staging.ts
npx tsx scripts/skyward-fetch.ts
npx tsx scripts/tc-fetch.ts
npx tsx scripts/send-push.ts
