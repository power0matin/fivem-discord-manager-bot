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
require_supported_platform
require_command node
require_command sha256sum
require_command mktemp
assert_safe_absolute_dir "$(dirname "$DATA_FILE")" DATA_DIR
assert_safe_absolute_dir "$BACKUP_DIR" BACKUP_DIR
[[ "$BACKUP_DIR/" != "$APP_ROOT/"* ]] || die "BACKUP_DIR must be outside the release directory."
[[ -n "$BACKUP_FILE" && -f "$BACKUP_FILE" ]] || die "Usage: $0 /path/to/data-backup.json"
[[ -f "$BACKUP_FILE.sha256" ]] || die "Backup checksum is missing: $BACKUP_FILE.sha256"

acquire_deploy_lock

backup_dir="$(cd "$(dirname "$BACKUP_FILE")" && pwd)"
backup_base="$(basename "$BACKUP_FILE")"
if ! (
  cd "$backup_dir"
  sha256sum -c "$backup_base.sha256" >/dev/null
); then
  die "Backup checksum verification failed."
fi
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

service_stopped_for_restore=0
had_original=0
safety_backup=""
data_dir="$(dirname "$DATA_FILE")"
tmp_file=""
swapped=0
restore_succeeded=0

resume_original_service() {
  local resume_ok=1
  if (( service_present == 1 && service_was_active == 1 && service_stopped_for_restore == 1 )); then
    if systemctl start "$SERVICE_NAME"; then
      if [[ -n "$current_release" && -f "$DATA_FILE" ]] && ! wait_for_readiness "$current_release" "$DATA_FILE"; then
        resume_ok=0
      fi
    else
      resume_ok=0
    fi
  fi
  if (( resume_ok == 0 )); then
    printf '[deploy] CRITICAL: restore failed before data replacement and the original service could not be resumed cleanly.\n' >&2
  fi
}

rollback_restore() {
  local rollback_ok=1 rollback_tmp=""
  log "Restore failed after data replacement; restoring the previous database."

  if (( service_present == 1 && service_was_active == 1 )); then
    if ! systemctl stop "$SERVICE_NAME"; then rollback_ok=0; fi
  fi

  if (( had_original == 1 )) && [[ -n "$safety_backup" && -f "$safety_backup" ]]; then
    if ! rollback_tmp="$(mktemp "$data_dir/.rollback-XXXXXXXX.json")"; then
      rollback_ok=0
    fi
    if (( rollback_ok == 1 )) && ! cp -- "$safety_backup" "$rollback_tmp"; then rollback_ok=0; fi
    if (( rollback_ok == 1 )); then
      chmod 600 "$rollback_tmp"
      if ! is_test_mode && ! chown "$SERVICE_USER:$SERVICE_GROUP" "$rollback_tmp"; then rollback_ok=0; fi
    fi
    if (( rollback_ok == 1 )) && ! node "$SCRIPT_DIR/validate-data.js" "$rollback_tmp"; then rollback_ok=0; fi
    if (( rollback_ok == 1 )) && ! mv -f -- "$rollback_tmp" "$DATA_FILE"; then rollback_ok=0; fi
    if [[ -n "$rollback_tmp" && -f "$rollback_tmp" ]]; then rm -f -- "$rollback_tmp"; fi
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
  if [[ -n "$tmp_file" && -f "$tmp_file" ]]; then rm -f -- "$tmp_file"; fi
  if (( rc != 0 && restore_succeeded == 0 )); then
    if (( swapped == 1 )); then
      rollback_restore
    else
      resume_original_service
    fi
  fi
  return "$rc"
}
trap cleanup_restore EXIT

if (( service_present == 1 && service_was_active == 1 )); then
  systemctl stop "$SERVICE_NAME"
  service_stopped_for_restore=1
fi

if [[ -f "$DATA_FILE" ]]; then
  had_original=1
  safety_backup="$(DATA_FILE="$DATA_FILE" BACKUP_DIR="$BACKUP_DIR" DEPLOY_TEST_MODE="$DEPLOY_TEST_MODE" SERVICE_USER="$SERVICE_USER" SERVICE_GROUP="$SERVICE_GROUP" bash "$SCRIPT_DIR/backup.sh")" || \
    die "Failed to create pre-restore safety backup."
  [[ -f "$safety_backup" && -f "$safety_backup.sha256" ]] || \
    die "Failed to create verified pre-restore safety backup."
fi

if [[ ! -d "$data_dir" ]]; then
  install_dir 700 "$SERVICE_USER" "$SERVICE_GROUP" "$data_dir"
fi
verify_dir_security "$data_dir" 700 "$SERVICE_USER" "$SERVICE_GROUP"

tmp_file="$(mktemp "$data_dir/.restore-XXXXXXXX.json")"
cp -- "$BACKUP_FILE" "$tmp_file"
chmod 600 "$tmp_file"
if ! is_test_mode; then chown "$SERVICE_USER:$SERVICE_GROUP" "$tmp_file"; fi
node "$SCRIPT_DIR/validate-data.js" "$tmp_file"
node -e '
  const fs = require("node:fs");
  const fd = fs.openSync(process.argv[1], "r");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
' "$tmp_file"

mv -f -- "$tmp_file" "$DATA_FILE"
tmp_file=""
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
if [[ -n "$safety_backup" ]]; then
  printf 'Pre-restore safety backup: %s\n' "$safety_backup"
fi
