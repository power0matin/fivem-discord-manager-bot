#!/usr/bin/env bash
set -Eeuo pipefail

APP="fivem-discord-manager-bot"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_ROOT="${APP_ROOT:-/opt/$APP}"
DATA_DIR="${DATA_DIR:-/var/lib/$APP}"
CONFIG_DIR="${CONFIG_DIR:-/etc/$APP}"
SERVICE_FILE="${SERVICE_FILE:-/etc/systemd/system/$APP.service}"
SENTINEL="$APP_ROOT/.managed-install"
PURGE_DATA=false
[[ "${1:-}" == "--purge-data" ]] && PURGE_DATA=true

# shellcheck source=scripts/lib/deploy-common.sh
source "$SCRIPT_DIR/lib/deploy-common.sh"

require_root
require_supported_platform
acquire_deploy_lock

if ! is_test_mode; then
  [[ "$APP_ROOT" == "/opt/$APP" ]] || die "Refusing non-default APP_ROOT in production uninstall: $APP_ROOT"
  [[ "$DATA_DIR" == "/var/lib/$APP" ]] || die "Refusing non-default DATA_DIR in production uninstall: $DATA_DIR"
  [[ "$CONFIG_DIR" == "/etc/$APP" ]] || die "Refusing non-default CONFIG_DIR in production uninstall: $CONFIG_DIR"
  [[ "$SERVICE_FILE" == "/etc/systemd/system/$APP.service" ]] || die "Refusing non-default service path in production uninstall: $SERVICE_FILE"
else
  assert_safe_absolute_dir "$APP_ROOT" APP_ROOT
  assert_safe_absolute_dir "$DATA_DIR" DATA_DIR
  assert_safe_absolute_dir "$CONFIG_DIR" CONFIG_DIR
fi

[[ -f "$SENTINEL" ]] || die "Managed-install sentinel is missing; refusing destructive uninstall: $SENTINEL"
grep -Fxq "$APP" "$SENTINEL" || die "Managed-install sentinel does not match this application."

if systemctl cat "$APP" >/dev/null 2>&1; then
  systemctl disable --now "$APP"
fi

if [[ -f "$SERVICE_FILE" ]]; then rm -f -- "$SERVICE_FILE"; fi
systemctl daemon-reload

safe_remove_tree "$APP_ROOT" "$(dirname "$APP_ROOT")"
safe_remove_tree "$CONFIG_DIR" "$(dirname "$CONFIG_DIR")"

if $PURGE_DATA; then
  if [[ -d "$DATA_DIR" ]]; then safe_remove_tree "$DATA_DIR" "$(dirname "$DATA_DIR")"; fi
  if ! is_test_mode && id -u "$SERVICE_USER" >/dev/null 2>&1; then userdel "$SERVICE_USER"; fi
  if ! is_test_mode && getent group "$SERVICE_GROUP" >/dev/null 2>&1; then groupdel "$SERVICE_GROUP"; fi
  printf 'Application, configuration and data removed. Backups under /var/backups/%s were preserved.\n' "$APP"
else
  printf 'Application and configuration removed. Data and service account preserved at %s.\n' "$DATA_DIR"
fi
