#!/usr/bin/env bash
set -Eeuo pipefail

DATA_FILE="${DATA_FILE:-/var/lib/fivem-discord-manager-bot/data.json}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/fivem-discord-manager-bot}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="$BACKUP_DIR/data-$STAMP-$$.json"

[[ -f "$DATA_FILE" ]] || { echo "Data file not found: $DATA_FILE" >&2; exit 1; }
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));' "$DATA_FILE"
cp --preserve=mode,timestamps "$DATA_FILE" "$BACKUP_FILE"
chmod 600 "$BACKUP_FILE"
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));' "$BACKUP_FILE"
sha256sum "$BACKUP_FILE" > "$BACKUP_FILE.sha256"
sha256sum -c "$BACKUP_FILE.sha256" >/dev/null

echo "$BACKUP_FILE"
