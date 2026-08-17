#!/usr/bin/env bash
set -Eeuo pipefail

APP="fivem-discord-manager-bot"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA_FILE="${DATA_FILE:-/var/lib/$APP/data.json}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/$APP}"

# shellcheck source=scripts/lib/deploy-common.sh
source "$SCRIPT_DIR/lib/deploy-common.sh"

require_root
require_command node
require_command sha256sum
require_command mktemp
assert_safe_absolute_dir "$BACKUP_DIR" BACKUP_DIR
[[ -f "$DATA_FILE" ]] || die "Data file not found: $DATA_FILE"

install_dir 700 root root "$BACKUP_DIR"
verify_dir_security "$BACKUP_DIR" 700 root root
node "$SCRIPT_DIR/validate-data.js" "$DATA_FILE"

stamp="$(date -u +%Y%m%dT%H%M%S)"
backup_file="$(mktemp "$BACKUP_DIR/data-$stamp-XXXXXXXX.json")"
checksum_file="$backup_file.sha256"
cleanup_needed=1

cleanup_backup() {
  local rc=$?
  if (( rc != 0 && cleanup_needed == 1 )); then
    rm -f -- "$backup_file" "$checksum_file"
  fi
  return "$rc"
}
trap cleanup_backup EXIT

cp -- "$DATA_FILE" "$backup_file"
chmod 600 "$backup_file"
if ! is_test_mode; then chown root:root "$backup_file"; fi
node "$SCRIPT_DIR/validate-data.js" "$backup_file"

node -e '
  const fs = require("node:fs");
  const fd = fs.openSync(process.argv[1], "r");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
' "$backup_file"

backup_base="$(basename "$backup_file")"
(
  cd "$BACKUP_DIR"
  sha256sum "$backup_base" > "$backup_base.sha256"
  sha256sum -c "$backup_base.sha256" >/dev/null
)
chmod 600 "$checksum_file"
if ! is_test_mode; then chown root:root "$checksum_file"; fi
verify_file_security "$backup_file" 600 root root
verify_file_security "$checksum_file" 600 root root

cleanup_needed=0
printf '%s\n' "$backup_file"
