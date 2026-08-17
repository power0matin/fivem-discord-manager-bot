#!/usr/bin/env bash
set -Eeuo pipefail

SERVICE="${SERVICE_NAME:-fivem-discord-manager-bot}"
DATA_FILE="${DATA_FILE:-/var/lib/fivem-discord-manager-bot/data.json}"
BACKUP_FILE="${1:-}"

[[ -n "$BACKUP_FILE" && -f "$BACKUP_FILE" ]] || { echo "Usage: $0 /path/to/data-backup.json" >&2; exit 2; }
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));' "$BACKUP_FILE"
if [[ -f "$BACKUP_FILE.sha256" ]]; then
  sha256sum -c "$BACKUP_FILE.sha256"
fi

install -d -m 700 "$(dirname "$DATA_FILE")"
if [[ -f "$DATA_FILE" ]]; then
  DATA_FILE="$DATA_FILE" "$(dirname "$0")/backup.sh" >/dev/null
fi

if command -v systemctl >/dev/null 2>&1 && systemctl cat "$SERVICE" >/dev/null 2>&1; then
  systemctl stop "$SERVICE"
fi

tmp="${DATA_FILE}.restore.$$"
trap 'rm -f "$tmp"' EXIT
install -m 600 "$BACKUP_FILE" "$tmp"
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));' "$tmp"
mv -f "$tmp" "$DATA_FILE"

if command -v systemctl >/dev/null 2>&1 && systemctl cat "$SERVICE" >/dev/null 2>&1; then
  systemctl start "$SERVICE"
fi

echo "Restored: $DATA_FILE"
