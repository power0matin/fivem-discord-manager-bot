#!/usr/bin/env bash
set -Eeuo pipefail

APP="fivem-discord-manager-bot"
SOURCE_DIR="${SOURCE_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
APP_ROOT="${APP_ROOT:-/opt/$APP}"
DATA_DIR="${DATA_DIR:-/var/lib/$APP}"
CONFIG_DIR="${CONFIG_DIR:-/etc/$APP}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/$APP}"
SERVICE_FILE="${SERVICE_FILE:-/etc/systemd/system/$APP.service}"
DATA_FILE="$DATA_DIR/data.json"

# shellcheck source=scripts/lib/deploy-common.sh
source "$SOURCE_DIR/scripts/lib/deploy-common.sh"

require_root
require_supported_platform
validate_node_version
for cmd in sha256sum flock readlink; do require_command "$cmd"; done
assert_safe_absolute_dir "$APP_ROOT" APP_ROOT
assert_safe_absolute_dir "$DATA_DIR" DATA_DIR
assert_safe_absolute_dir "$CONFIG_DIR" CONFIG_DIR
assert_safe_absolute_dir "$BACKUP_DIR" BACKUP_DIR
[[ "$BACKUP_DIR/" != "$APP_ROOT/"* ]] || die "BACKUP_DIR must be outside the release directory."

if ! is_test_mode; then
  [[ "$APP_ROOT" == "/opt/$APP" ]] || die "Custom APP_ROOT is supported only in DEPLOY_TEST_MODE."
  [[ "$DATA_DIR" == "/var/lib/$APP" ]] || die "Custom DATA_DIR is supported only in DEPLOY_TEST_MODE."
  [[ "$CONFIG_DIR" == "/etc/$APP" ]] || die "Custom CONFIG_DIR is supported only in DEPLOY_TEST_MODE."
  [[ "$BACKUP_DIR" == "/var/backups/$APP" ]] || die "Custom BACKUP_DIR is supported only in DEPLOY_TEST_MODE."
  [[ "$SERVICE_FILE" == "/etc/systemd/system/$APP.service" ]] || die "Custom SERVICE_FILE is supported only in DEPLOY_TEST_MODE."
fi

[[ -f "$SOURCE_DIR/scripts/install.sh" && -f "$SOURCE_DIR/scripts/backup.sh" && -f "$SOURCE_DIR/scripts/restore.sh" ]] || \
  die "SOURCE_DIR does not contain the managed deployment scripts."

acquire_deploy_lock
old_release="$(resolve_current_release "$APP_ROOT")" || die "No valid managed installation found at $APP_ROOT/current"
old_data_hash=""
backup_file=""
had_data=0

if [[ -f "$DATA_FILE" ]]; then
  had_data=1
  old_data_hash="$(sha256sum "$DATA_FILE" | awk '{print $1}')"
  backup_file="$(
    DATA_FILE="$DATA_FILE" \
    BACKUP_DIR="$BACKUP_DIR" \
    DEPLOY_TEST_MODE="$DEPLOY_TEST_MODE" \
    SERVICE_USER="$SERVICE_USER" \
    SERVICE_GROUP="$SERVICE_GROUP" \
    bash "$SOURCE_DIR/scripts/backup.sh"
  )"
  [[ -f "$backup_file" && -f "$backup_file.sha256" ]] || die "Update aborted: verified pre-update backup was not created."
  log "Verified pre-update backup: $backup_file"
fi

if SKIP_PREINSTALL_BACKUP=1 \
  SOURCE_DIR="$SOURCE_DIR" \
  APP_ROOT="$APP_ROOT" \
  DATA_DIR="$DATA_DIR" \
  CONFIG_DIR="$CONFIG_DIR" \
  BACKUP_DIR="$BACKUP_DIR" \
  SERVICE_FILE="$SERVICE_FILE" \
  DEPLOY_TEST_MODE="$DEPLOY_TEST_MODE" \
  DEPLOY_LOCK_FD="$DEPLOY_LOCK_FD" \
  DEPLOY_LOCK_FILE="$DEPLOY_LOCK_FILE" \
  SERVICE_USER="$SERVICE_USER" \
  SERVICE_GROUP="$SERVICE_GROUP" \
  READINESS_ATTEMPTS="$READINESS_ATTEMPTS" \
  READINESS_INTERVAL_SECONDS="$READINESS_INTERVAL_SECONDS" \
  DEPLOY_HEALTHCHECK_HELPER="${DEPLOY_HEALTHCHECK_HELPER:-}" \
  RELEASE_ID="${RELEASE_ID:-}" \
  bash "$SOURCE_DIR/scripts/install.sh"; then
  install_rc=0
else
  install_rc=$?
fi

if (( install_rc != 0 )); then
  printf '[deploy] Update installation phase failed with status %d.\n' "$install_rc" >&2

  current_after_failure="$(resolve_current_release "$APP_ROOT")" || die "Update failed and current release is no longer valid."
  if [[ "$current_after_failure" != "$old_release" ]]; then
    log "Installer did not restore the previous symlink; forcing rollback."
    atomic_switch_link "$old_release" "$APP_ROOT/current"
    systemctl restart "$APP"
  fi

  if (( had_data == 1 )); then
    current_hash=""
    if [[ -f "$DATA_FILE" ]]; then current_hash="$(sha256sum "$DATA_FILE" | awk '{print $1}')"; fi
    if [[ "$current_hash" != "$old_data_hash" ]]; then
      log "Persistence changed during failed update; restoring verified pre-update data."
      DATA_FILE="$DATA_FILE" \
      BACKUP_DIR="$BACKUP_DIR" \
      APP_ROOT="$APP_ROOT" \
      SERVICE_NAME="$APP" \
      DEPLOY_TEST_MODE="$DEPLOY_TEST_MODE" \
      DEPLOY_LOCK_FD="$DEPLOY_LOCK_FD" \
      DEPLOY_LOCK_FILE="$DEPLOY_LOCK_FILE" \
      SERVICE_USER="$SERVICE_USER" \
      SERVICE_GROUP="$SERVICE_GROUP" \
      READINESS_ATTEMPTS="$READINESS_ATTEMPTS" \
      READINESS_INTERVAL_SECONDS="$READINESS_INTERVAL_SECONDS" \
      DEPLOY_HEALTHCHECK_HELPER="${DEPLOY_HEALTHCHECK_HELPER:-}" \
      bash "$SOURCE_DIR/scripts/restore.sh" "$backup_file"
    fi
  fi

  if service_is_active && ! wait_for_readiness "$old_release" "$DATA_FILE"; then
    die "Rollback returned to the previous release, but readiness still fails."
  fi
  exit "$install_rc"
fi

new_release="$(resolve_current_release "$APP_ROOT")" || die "Update completed but current release is invalid."
[[ "$new_release" != "$old_release" ]] || die "Update reported success without switching to a new release."
node "$SOURCE_DIR/scripts/validate-data.js" "$DATA_FILE"
if ! wait_for_readiness "$new_release" "$DATA_FILE"; then
  die "Post-update verification failed after installer success."
fi

printf 'Update successful.\nPrevious release: %s\nCurrent release: %s\n' "$old_release" "$new_release"
if [[ -n "$backup_file" ]]; then
  printf 'Verified pre-update backup: %s\n' "$backup_file"
fi
