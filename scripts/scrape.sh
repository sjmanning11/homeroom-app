#!/usr/bin/env bash
# Direct scrapers: Skyward (attendance/test scores) + Transparent Classroom
# (classroom posts). Run by cron daily — these are low-frequency sources.
# Logs to ~/homeroom/scrape.log.
# On step failure, writes a high-priority alert card to the dashboard.
set -uo pipefail

export PATH="$HOME/.nvm/versions/node/v24.18.1/bin:$PATH"
cd "$HOME/homeroom"

FAIL=0
run_step() {
  local platform="$1"
  shift
  local out
  if out=$("$@" 2>&1); then
    echo "$out"
  else
    echo "$out"
    npx tsx scripts/alert-card.ts "$platform" "$(echo "$out" | tail -c 400)" || true
    FAIL=1
  fi
}

echo "=== scrape $(date -Is) ==="
run_step skyward npx tsx scripts/skyward-fetch.ts
run_step transparent_classroom npx tsx scripts/tc-fetch.ts
# Push any high-priority cards produced (attendance alerts, sync-failure alerts).
npx tsx scripts/send-push.ts || echo "send-push failed (non-fatal)"
exit $FAIL
