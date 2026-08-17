#!/usr/bin/env bash
set -Eeuo pipefail

APP="fivem-discord-manager-bot"
SOURCE_DIR="${SOURCE_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
APP_ROOT="${APP_ROOT:-/opt/$APP}"
DATA_DIR="${DATA_DIR:-/var/lib/$APP}"
CONFIG_DIR="${CONFIG_DIR:-/etc/$APP}"
SERVICE_FILE="/etc/systemd/system/$APP.service"

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "Run installer as root." >&2; exit 1; }
command -v node >/dev/null || { echo "Node.js >=18.17 is required." >&2; exit 1; }
command -v npm >/dev/null || { echo "npm is required." >&2; exit 1; }
command -v systemctl >/dev/null || { echo "systemd is required." >&2; exit 1; }
node -e 'const [M,m]=process.versions.node.split(".").map(Number); if(M<18 || (M===18&&m<17)) process.exit(1)' || {
  echo "Node.js >=18.17 is required; found $(node -v)." >&2; exit 1;
}
[[ -f "$SOURCE_DIR/package-lock.json" && -f "$SOURCE_DIR/src/index.js" ]] || { echo "SOURCE_DIR is not a valid repository checkout." >&2; exit 1; }

if ! id -u fivembot >/dev/null 2>&1; then
  useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin fivembot
fi
install -d -o fivembot -g fivembot -m 700 "$DATA_DIR"
install -d -o root -g fivembot -m 750 "$CONFIG_DIR"
install -d -o root -g root -m 755 "$APP_ROOT/releases"

if [[ ! -f "$CONFIG_DIR/bot.env" ]]; then
  install -m 640 -o root -g fivembot "$SOURCE_DIR/.env.example" "$CONFIG_DIR/bot.env"
  echo "Created $CONFIG_DIR/bot.env. Fill DISCORD_TOKEN and DISCORD_CLIENT_ID, then rerun." >&2
  exit 2
fi

grep -Eq '^DISCORD_TOKEN=.+$' "$CONFIG_DIR/bot.env" || { echo "DISCORD_TOKEN is missing in $CONFIG_DIR/bot.env" >&2; exit 2; }

release="$(date -u +%Y%m%dT%H%M%SZ)-$(sha256sum "$SOURCE_DIR/package-lock.json" | cut -c1-12)"
release_dir="$APP_ROOT/releases/$release"
[[ ! -e "$release_dir" ]] || { echo "Release directory already exists: $release_dir" >&2; exit 1; }
mkdir -p "$release_dir"

tar -C "$SOURCE_DIR" --exclude=.git --exclude=node_modules --exclude=data.json --exclude=.env -cf - . | tar -C "$release_dir" -xf -
cd "$release_dir"
npm ci --omit=dev --ignore-scripts
chown -R root:root "$release_dir"
chmod -R go-w "$release_dir"
ln -sfn "$release_dir" "$APP_ROOT/current.new"
mv -Tf "$APP_ROOT/current.new" "$APP_ROOT/current"

install -m 644 "$release_dir/deploy/$APP.service" "$SERVICE_FILE"
systemctl daemon-reload
systemctl enable "$APP"
systemctl restart "$APP"

for _ in $(seq 1 30); do
  if DATA_FILE="$DATA_DIR/data.json" node "$release_dir/scripts/healthcheck.js" >/dev/null 2>&1; then
    echo "Installation ready: $release_dir"
    exit 0
  fi
  sleep 2
done

systemctl status "$APP" --no-pager -l || true
echo "Service started but readiness did not pass." >&2
exit 1
