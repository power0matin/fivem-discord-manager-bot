#!/usr/bin/env bash
set -Eeuo pipefail

APP="fivem-discord-manager-bot"
APP_ROOT="${APP_ROOT:-/opt/$APP}"
DATA_DIR="${DATA_DIR:-/var/lib/$APP}"
CONFIG_DIR="${CONFIG_DIR:-/etc/$APP}"
PURGE_DATA=false
[[ "${1:-}" == "--purge-data" ]] && PURGE_DATA=true

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "Run uninstaller as root." >&2; exit 1; }

safe_exact_path() {
  local value="$1" expected="$2"
  [[ "$value" == "$expected" ]] || { echo "Refusing unsafe path: $value (expected $expected)" >&2; exit 1; }
}

safe_exact_path "$APP_ROOT" "/opt/$APP"
safe_exact_path "$DATA_DIR" "/var/lib/$APP"
safe_exact_path "$CONFIG_DIR" "/etc/$APP"

systemctl disable --now "$APP" 2>/dev/null || true
rm -f "/etc/systemd/system/$APP.service"
systemctl daemon-reload

rm -rf --one-file-system "$APP_ROOT"
rm -rf --one-file-system "$CONFIG_DIR"

if $PURGE_DATA; then
  rm -rf --one-file-system "$DATA_DIR"
  echo "Application, configuration and data removed. Backups under /var/backups/$APP were preserved."
else
  echo "Application and configuration removed. Data preserved at $DATA_DIR."
fi
