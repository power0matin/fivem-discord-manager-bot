#!/usr/bin/env bash
set -Eeuo pipefail

APP="fivem-discord-manager-bot"
SOURCE_DIR="${SOURCE_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
APP_ROOT="${APP_ROOT:-/opt/$APP}"
DATA_DIR="${DATA_DIR:-/var/lib/$APP}"
LOCK_FILE="/run/lock/$APP-update.lock"

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "Run updater as root." >&2; exit 1; }
command -v flock >/dev/null || { echo "flock is required." >&2; exit 1; }
exec 9>"$LOCK_FILE"
flock -n 9 || { echo "Another update is already running." >&2; exit 1; }

[[ -L "$APP_ROOT/current" ]] || { echo "No managed installation found at $APP_ROOT/current" >&2; exit 1; }
old_release="$(readlink -f "$APP_ROOT/current")"
[[ "$old_release" == "$APP_ROOT/releases/"* ]] || { echo "Unsafe current symlink target: $old_release" >&2; exit 1; }

backup=""
if [[ -f "$DATA_DIR/data.json" ]]; then
  backup="$(DATA_FILE="$DATA_DIR/data.json" BACKUP_DIR="/var/backups/$APP" bash "$old_release/scripts/backup.sh")"
fi

rollback() {
  echo "Update failed; rolling back to $old_release" >&2
  ln -sfn "$old_release" "$APP_ROOT/current.rollback"
  mv -Tf "$APP_ROOT/current.rollback" "$APP_ROOT/current"
  systemctl restart "$APP" || true
}
trap rollback ERR

SOURCE_DIR="$SOURCE_DIR" APP_ROOT="$APP_ROOT" DATA_DIR="$DATA_DIR" CONFIG_DIR="/etc/$APP" bash "$SOURCE_DIR/scripts/install.sh"

DATA_FILE="$DATA_DIR/data.json" node "$APP_ROOT/current/scripts/healthcheck.js"
trap - ERR

echo "Update successful. Previous release: $old_release"
[[ -n "$backup" ]] && echo "Verified pre-update backup: $backup"
