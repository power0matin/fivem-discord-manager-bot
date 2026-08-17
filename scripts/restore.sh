#!/usr/bin/env bash
set -Eeuo pipefail

APP="fivem-discord-manager-bot"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_ROOT="${APP_ROOT:-/opt/$APP}"
DATA_FILE="${DATA_FILE:-/var/lib/$APP/data.json}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/$APP}"
SERVICE_NAME="${SERVICE_NAME:-$APP}"
BACKUP_FILE="${1:-}"

# shellcheck source=scripts/lib/deploy-common.sh
source "$SCRIPT_DIR/lib/deploy-common.sh"

require_root
require_command node
require_command sha256sum
require_command mktemp
assert_safe_absolute_dir "$(dirname "$DATA_FILE")" DATA_DIR
assert_safe_absolute_dir "$BACKUP_DIR" BACKUP_DIR
[[ "$BACKUP_DIR/" != "$APP_ROOT/"* ]] || die "BACKUP_DIR must be outside the release directory."
[[ -n "$BACKUP_FILE" && -f "$BACKUP_FILE" ]] || die "Usage: $0 /path/to/data-backup.json"
[[ -f "$BACKUP_FILE.sha256" ]] || die "Backup checksum is missing: $BACKUP_FILE.sha256"

backup_dir="$(cd "$(dirname "$BACKUP_FILE")" && pwd)"
backup_base="$(basename "$BACKUP_FILE")"
(
  cd "$backup_dir"
  sha256sum -c "$backup_base.sha256" >/dev/null
) || die "Backup checksum verification failed."
node "$SCRIPT_DIR/validate-data.js" "$BACKUP_FILE"

service_present=0
service_was_active=0
current_release=""
if systemctl cat "$SERVICE_NAME" >/dev/null 2>&1; then
  service_present=1
  if systemctl is-active --quiet "$SERVICE_NAME" >/dev/null 2>&1; then
    service_was_active=1
  fi
  if [[ -e "$APP_ROOT/current" || -L "$APP_ROOT/current" ]]; then
    current_release="$(resolve_current_release "$APP_ROOT")" || die "Managed current release is invalid; refusing restore."
  fi
fi

had_original=0
safety_backup=""
if [[ -f "$DATA_FILE" ]]; then
  had_original=1
  safety_backup="$(DATA_FILE="$DATA_FILE" BACKUP_DIR="$BACKUP_DIR" DEPLOY_TEST_MODE="$DEPLOY_TEST_MODE" SERVICE_USER="$SERVICE_USER" SERVICE_GROUP="$SERVICE_GROUP" bash "$SCRIPT_DIR/backup.sh")"
  [[ -f "$safety_backup" && -f "$safety_backup.sha256" ]] || die "Failed to create verified pre-restore safety backup."
fi

data_dir="$(dirname "$DATA_FILE")"
if [[ ! -d "$data_dir" ]]; then
  install_dir 700 "$SERVICE_USER" "$SERVICE_GROUP" "$data_dir"
fi
verify_dir_security "$data_dir" 700 "$SERVICE_USER" "$SERVICE_GROUP"

tmp_file="$(mktemp "$data_dir/.restore-XXXXXXXX.json")"
swapped=0
restore_succeeded=0

rollback_restore() {
  local rollback_ok=1 rollback_tmp
  log "Restore failed after data replacement; restoring the previous database."

  if (( had_original == 1 )) && [[ -n "$safety_backup" && -f "$safety_backup" ]]; then
    rollback_tmp="$(mktemp "$data_dir/.rollback-XXXXXXXX.json")" || rollback_ok=0
    if (( rollback_ok == 1 )); then
      if ! cp -- "$safety_backup" "$rollback_tmp"; then rollback_ok=0; fi
    fi
    if (( rollback_ok == 1 )); then
      chmod 600 "$rollback_tmp"
      if ! is_test_mode && ! chown "$SERVICE_USER:$SERVICE_GROUP" "$rollback_tmp"; then rollback_ok=0; fi
    fi
    if (( rollback_ok == 1 )) && ! node "$SCRIPT_DIR/validate-data.js" "$rollback_tmp"; then rollback_ok=0; fi
    if (( rollback_ok == 1 )) && ! mv -f -- "$rollback_tmp" "$DATA_FILE"; then rollback_ok=0; fi
    if [[ -n "${rollback_tmp:-}" && -f "$rollback_tmp" ]]; then rm -f -- "$rollback_tmp"; fi
  elif (( had_original == 0 )); then
    if ! rm -f -- "$DATA_FILE"; then rollback_ok=0; fi
  fi

  if (( service_present == 1 && service_was_active == 1 )); then
    if systemctl start "$SERVICE_NAME"; then
      if [[ -n "$current_release" ]] && ! wait_for_readiness "$current_release" "$DATA_FILE"; then
        rollback_ok=0
      fi
    else
      rollback_ok=0
    fi
  fi

  if (( rollback_ok == 0 )); then
    printf '[deploy] CRITICAL: restore rollback was incomplete. Previous safety backup: %s\n' "$safety_backup" >&2
  fi
}

cleanup_restore() {
  local rc=$?
  set +e
  if [[ -f "$tmp_file" ]]; then rm -f -- "$tmp_file"; fi
  if (( rc != 0 && swapped == 1 && restore_succeeded == 0 )); then
    rollback_restore
  fi
  return "$rc"
}
trap cleanup_restore EXIT

cp -- "$BACKUP_FILE" "$tmp_file"
chmod 600 "$tmp_file"
if ! is_test_mode; then chown "$SERVICE_USER:$SERVICE_GROUP" "$tmp_file"; fi
node "$SCRIPT_DIR/validate-data.js" "$tmp_file"
node -e '
  const fs = require("node:fs");
  const fd = fs.openSync(process.argv[1], "r");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
' "$tmp_file"

if (( service_present == 1 && service_was_active == 1 )); then
  systemctl stop "$SERVICE_NAME"
fi

mv -f -- "$tmp_file" "$DATA_FILE"
swapped=1
verify_file_security "$DATA_FILE" 600 "$SERVICE_USER" "$SERVICE_GROUP"
node "$SCRIPT_DIR/validate-data.js" "$DATA_FILE"

if (( service_present == 1 && service_was_active == 1 )); then
  systemctl start "$SERVICE_NAME"
  if [[ -n "$current_release" ]] && ! wait_for_readiness "$current_release" "$DATA_FILE"; then
    die "Restored data was written but the service did not become ready; rolling back data."
  fi
fi

restore_succeeded=1
printf 'Restored: %s\n' "$DATA_FILE"
[[ -n "$safety_backup" ]] && printf 'Pre-restore safety backup: %s\n' "$safety_backup"
