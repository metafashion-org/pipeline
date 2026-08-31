#!/bin/bash
# Triggers the pipeline app's Discord Team Manager temp-access expiry check
# on this VM, via a native crontab entry — same shape and same reasoning as
# Catalog Intel's own scripts/discord_temp_access_cron.sh (see that file's
# comments for why a VM crontab over GitHub Actions, and the real incident
# where a sibling cron script silently lost its executable bit to a
# `git reset --hard` deploy).
#
# Temp access grants are day-granular (the panel's own UI), so hourly is
# more than tight enough. Finds every grant whose expiresAt has passed and
# revokes the real Discord permission overwrite + removes the grant row —
# same logic the manual "Revoke Now" button uses
# (team-service.ts's revokeTempAccessGrant, shared by both).
#
# Setup: crontab -e, add
#   0 * * * * /home/azureuser/catalog-intel/pipeline/scripts/discord-temp-access-cron.sh
#
# IMPORTANT — this file must stay executable (chmod +x) or cron silently
# fails to run it at all. Committed with the executable bit set from the
# start (`git update-index --chmod=+x`), same fix Catalog Intel's own
# script needed after losing it once.
#
# This app has no shared network-level Basic Auth wall the way Catalog
# Intel does (confirmed directly — kanban.metafashion.in is reachable with
# zero credentials), so the route this hits is gated on a shared secret
# instead (DISCORD_CRON_SECRET, read from .env.local here, checked against
# the same env var on the server via the x-cron-secret header).
set -uo pipefail
cd "$(dirname "$0")/.."
CRON_SECRET=$(grep -m1 "^DISCORD_CRON_SECRET=" .env.local | cut -d= -f2-)
LOG_FILE="logs/discord-temp-access-cron.log"
mkdir -p logs
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
{
  echo "[$TS] Checking for expired Discord temp-access grants..."
  if [ -z "$CRON_SECRET" ]; then
    echo "DISCORD_CRON_SECRET not found in .env.local - aborting."
    exit 1
  fi
  RESPONSE=$(curl -s -w '\n%{http_code}' -X POST -H "x-cron-secret: ${CRON_SECRET}" http://127.0.0.1:3002/api/admin/discord/expire-temp-access)
  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')
  echo "HTTP ${HTTP_CODE}"
  echo "$BODY" | node -e '
    let d = "";
    process.stdin.on("data", c => d += c);
    process.stdin.on("end", () => {
      try {
        const j = JSON.parse(d);
        console.log(`expired=${j.expired}`);
        (j.results || []).forEach(r => {
          console.log(`  - ${r.channelName} / ${r.granteeName}: ${r.ok ? "revoked" : "FAILED: " + (r.error || "unknown")}`);
        });
      } catch (e) {
        console.log("(could not parse response as JSON: " + e.message + ")");
        console.log(d.slice(0, 500));
      }
    });
  '
  echo ""
} >> "$LOG_FILE" 2>&1
tail -n 2000 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
