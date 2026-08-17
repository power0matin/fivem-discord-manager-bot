#!/usr/bin/env bash
set -Eeuo pipefail

APP="fivem-discord-manager-bot"
SOURCE_DIR="${SOURCE_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
APP_ROOT="${APP_ROOT:-/opt/$APP}"
DATA_DIR="${DATA_DIR:-/var/lib/$APP}"
CONFIG_DIR="${CONFIG_DIR:-/etc/$APP}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/$APP}"
SERVICE_FILE="${SERVICE_FILE:-/etc/systemd/system/$APP.service}"
RELEASES_DIR="$APP_ROOT/releases"
CURRENT_LINK="$APP_ROOT/current"
DATA_FILE="$DATA_DIR/data.json"
SENTINEL="$APP_ROOT/.managed-install"

# shellcheck source=scripts/lib/deploy-common.sh
source "$SOURCE_DIR/scripts/lib/deploy-common.sh"

require_root
require_supported_platform
validate_node_version
for cmd in tar install sha256sum stat getent readlink flock; do
  require_command "$cmd"
done

assert_safe_absolute_dir "$APP_ROOT" APP_ROOT
assert_safe_absolute_dir "$DATA_DIR" DATA_DIR
assert_safe_absolute_dir "$CONFIG_DIR" CONFIG_DIR
assert_safe_absolute_dir "$BACKUP_DIR" BACKUP_DIR

if ! is_test_mode; then
  [[ "$APP_ROOT" == "/opt/$APP" ]] || die "Custom APP_ROOT is supported only in DEPLOY_TEST_MODE."
  [[ "$DATA_DIR" == "/var/lib/$APP" ]] || die "Custom DATA_DIR is supported only in DEPLOY_TEST_MODE."
  [[ "$CONFIG_DIR" == "/etc/$APP" ]] || die "Custom CONFIG_DIR is supported only in DEPLOY_TEST_MODE."
  [[ "$BACKUP_DIR" == "/var/backups/$APP" ]] || die "Custom BACKUP_DIR is supported only in DEPLOY_TEST_MODE."
  [[ "$SERVICE_FILE" == "/etc/systemd/system/$APP.service" ]] || die "Custom SERVICE_FILE is supported only in DEPLOY_TEST_MODE."
fi

for required in package.json package-lock.json .env.example src/index.js deploy/$APP.service scripts/healthcheck.js scripts/backup.sh scripts/validate-data.js; do
  [[ -f "$SOURCE_DIR/$required" ]] || die "SOURCE_DIR is not a complete repository checkout: missing $required"
done

acquire_deploy_lock

# A killed installer may leave only staging directories behind. Because this
# process owns the deployment lock, no live installer can legitimately own them.
for stale_staging in "$RELEASES_DIR"/.staging-*; do
  [[ -d "$stale_staging" ]] || continue
  safe_remove_tree "$stale_staging" "$RELEASES_DIR"
  log "Removed stale installer staging directory: $stale_staging"
done

if ! is_test_mode; then
  if command -v nologin >/dev/null 2>&1; then
    nologin_shell="$(command -v nologin)"
  else
    nologin_shell="/usr/sbin/nologin"
  fi
  [[ -x "$nologin_shell" ]] || die "A nologin shell is required for the service account."

  if ! getent group "$SERVICE_GROUP" >/dev/null; then
    groupadd --system "$SERVICE_GROUP"
  fi

  if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
    useradd --system --gid "$SERVICE_GROUP" --home-dir "$DATA_DIR" --shell "$nologin_shell" "$SERVICE_USER"
  else
    [[ "$(id -gn "$SERVICE_USER")" == "$SERVICE_GROUP" ]] || die "Existing $SERVICE_USER user has an unexpected primary group."
    user_entry="$(getent passwd "$SERVICE_USER")"
    user_home="$(cut -d: -f6 <<<"$user_entry")"
    user_shell="$(cut -d: -f7 <<<"$user_entry")"
    [[ "$user_home" == "$DATA_DIR" ]] || die "Existing $SERVICE_USER user has home $user_home; expected $DATA_DIR."
    [[ "$user_shell" == "$nologin_shell" || "$user_shell" == "/usr/sbin/nologin" || "$user_shell" == "/sbin/nologin" ]] || \
      die "Existing $SERVICE_USER user has an interactive shell: $user_shell"
  fi
fi

install_dir 755 root root "$APP_ROOT"
install_dir 755 root root "$RELEASES_DIR"
install_dir 700 "$SERVICE_USER" "$SERVICE_GROUP" "$DATA_DIR"
install_dir 750 root "$SERVICE_GROUP" "$CONFIG_DIR"
install_dir 700 root root "$BACKUP_DIR"
verify_dir_security "$APP_ROOT" 755 root root
verify_dir_security "$RELEASES_DIR" 755 root root
verify_dir_security "$DATA_DIR" 700 "$SERVICE_USER" "$SERVICE_GROUP"
verify_dir_security "$CONFIG_DIR" 750 root "$SERVICE_GROUP"
verify_dir_security "$BACKUP_DIR" 700 root root

if [[ ! -f "$CONFIG_DIR/bot.env" ]]; then
  install_file 640 root "$SERVICE_GROUP" "$SOURCE_DIR/.env.example" "$CONFIG_DIR/bot.env"
  verify_file_security "$CONFIG_DIR/bot.env" 640 root "$SERVICE_GROUP"
  printf 'Created %s. Fill DISCORD_TOKEN and DISCORD_CLIENT_ID if slash registration is used, then rerun.\n' "$CONFIG_DIR/bot.env" >&2
  exit 2
fi

if is_test_mode; then
  chmod 640 "$CONFIG_DIR/bot.env"
else
  chown root:"$SERVICE_GROUP" "$CONFIG_DIR/bot.env"
  chmod 640 "$CONFIG_DIR/bot.env"
fi
verify_file_security "$CONFIG_DIR/bot.env" 640 root "$SERVICE_GROUP"
grep -Eq '^DISCORD_TOKEN=[^[:space:]].+$' "$CONFIG_DIR/bot.env" || die "DISCORD_TOKEN is missing in $CONFIG_DIR/bot.env"

old_release=""
if [[ -e "$CURRENT_LINK" || -L "$CURRENT_LINK" ]]; then
  old_release="$(resolve_current_release "$APP_ROOT")" || die "Existing current release is invalid."
  log "Existing managed release detected: $old_release"
fi

if [[ -n "$old_release" && -f "$DATA_FILE" && "${SKIP_PREINSTALL_BACKUP:-0}" != "1" ]]; then
  preinstall_backup="$(DATA_FILE="$DATA_FILE" BACKUP_DIR="$BACKUP_DIR" DEPLOY_TEST_MODE="$DEPLOY_TEST_MODE" SERVICE_USER="$SERVICE_USER" SERVICE_GROUP="$SERVICE_GROUP" bash "$SOURCE_DIR/scripts/backup.sh")"
  [[ -f "$preinstall_backup" && -f "$preinstall_backup.sha256" ]] || die "Verified pre-install backup was not created."
  log "Verified pre-install backup: $preinstall_backup"
fi

release_id="${RELEASE_ID:-$(date -u +%Y%m%dT%H%M%S)-$(date +%N)-$(sha256sum "$SOURCE_DIR/package-lock.json" | cut -c1-12)}"
[[ "$release_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{5,127}$ ]] || die "Generated RELEASE_ID is invalid: $release_id"
release_dir="$RELEASES_DIR/$release_id"
staging_dir="$RELEASES_DIR/.staging-$release_id-$$"
[[ ! -e "$release_dir" ]] || die "Release directory already exists: $release_dir"
[[ ! -e "$staging_dir" ]] || die "Staging directory already exists: $staging_dir"

service_preexisted=0
service_was_active=0
service_backup=""
switched=0
release_finalized=0
transaction_started=1
install_succeeded=0

if [[ -f "$SERVICE_FILE" ]]; then
  service_preexisted=1
  service_backup="$(mktemp "${SERVICE_FILE}.backup.XXXXXX")"
  cp -p "$SERVICE_FILE" "$service_backup"
fi
if service_is_active; then service_was_active=1; fi

rollback_install() {
  local rollback_ok=1
  log "Installation failed; restoring the previous managed state."

  if (( switched == 1 )); then
    if [[ -n "$old_release" && -d "$old_release" ]]; then
      if ! atomic_switch_link "$old_release" "$CURRENT_LINK"; then rollback_ok=0; fi
    elif [[ -L "$CURRENT_LINK" ]]; then
      if ! rm -f -- "$CURRENT_LINK"; then rollback_ok=0; fi
    fi
  fi

  if (( service_preexisted == 1 )) && [[ -n "$service_backup" && -f "$service_backup" ]]; then
    if ! install_file 644 root root "$service_backup" "$SERVICE_FILE"; then rollback_ok=0; fi
  elif [[ -f "$SERVICE_FILE" ]]; then
    if ! rm -f -- "$SERVICE_FILE"; then rollback_ok=0; fi
  fi

  if ! systemctl daemon-reload; then rollback_ok=0; fi

  if [[ -n "$old_release" && -d "$old_release" && $service_was_active -eq 1 ]]; then
    if systemctl restart "$APP"; then
      if ! wait_for_readiness "$old_release" "$DATA_FILE"; then
        printf '[deploy] CRITICAL: previous release restarted but did not become ready.\n' >&2
        rollback_ok=0
      fi
    else
      printf '[deploy] CRITICAL: failed to restart previous release.\n' >&2
      rollback_ok=0
    fi
  elif (( service_preexisted == 0 )); then
    if ! systemctl disable --now "$APP" >/dev/null 2>&1; then
      log "First-install rollback could not disable the service; inspect systemctl state manually."
    fi
  elif (( service_was_active == 0 )); then
    if ! systemctl stop "$APP" >/dev/null 2>&1; then
      log "Rollback could not restore the previous inactive service state."
      rollback_ok=0
    fi
  fi

  if (( release_finalized == 1 )) && [[ -d "$release_dir" ]]; then
    if ! safe_remove_tree "$release_dir" "$RELEASES_DIR"; then rollback_ok=0; fi
  fi

  if (( rollback_ok == 0 )); then
    printf '[deploy] CRITICAL: automatic rollback was incomplete. Do not retry blindly; inspect current symlink, service unit, and logs.\n' >&2
  fi
}

cleanup_install() {
  local rc=$?
  set +e
  if [[ -L "$APP_ROOT/current.new" ]]; then rm -f -- "$APP_ROOT/current.new"; fi
  if [[ -L "${CURRENT_LINK}.new.$$" ]]; then rm -f -- "${CURRENT_LINK}.new.$$"; fi
  if [[ -d "$staging_dir" ]]; then
    safe_remove_tree "$staging_dir" "$RELEASES_DIR" 2>/dev/null
  fi
  if (( rc != 0 && transaction_started == 1 && install_succeeded == 0 )); then
    rollback_install
  fi
  if [[ -n "$service_backup" && -f "$service_backup" ]]; then
    rm -f -- "$service_backup"
  fi
  return "$rc"
}
trap cleanup_install EXIT

mkdir -m 755 "$staging_dir"
tar -C "$SOURCE_DIR" \
  --exclude=.git \
  --exclude=node_modules \
  --exclude=data.json \
  --exclude='data.json.*' \
  --exclude=.env \
  --exclude='*.log' \
  -cf - . | tar -C "$staging_dir" -xf -

(
  cd "$staging_dir"
  npm ci --omit=dev --ignore-scripts
  npm run check:syntax
)
validate_env_file "$staging_dir" "$CONFIG_DIR/bot.env"
verify_unit_syntax "$staging_dir/deploy/$APP.service"

if is_test_mode; then
  chmod -R go-w "$staging_dir"
else
  chown -R root:root "$staging_dir"
  chmod -R go-w "$staging_dir"
fi

mv "$staging_dir" "$release_dir"
release_finalized=1
verify_owner_group "$release_dir" root root

install_file 644 root root "$release_dir/deploy/$APP.service" "$SERVICE_FILE"
verify_file_security "$SERVICE_FILE" 644 root root
systemctl daemon-reload
systemctl enable "$APP"

remove_stale_transition_link "$APP_ROOT/current.new"
ln -s "$release_dir" "$APP_ROOT/current.new"
mv -Tf "$APP_ROOT/current.new" "$CURRENT_LINK"
switched=1

systemctl restart "$APP"
if ! wait_for_readiness "$release_dir" "$DATA_FILE"; then
  if ! systemctl status "$APP" --no-pager -l >&2; then
    log "systemctl status was unavailable while reporting readiness failure."
  fi
  die "New release did not become ready within the configured readiness window."
fi

[[ -f "$DATA_FILE" ]] || die "Readiness passed but persistence file is missing: $DATA_FILE"
if is_test_mode; then
  chmod 600 "$DATA_FILE"
else
  chown "$SERVICE_USER:$SERVICE_GROUP" "$DATA_FILE"
  chmod 600 "$DATA_FILE"
fi
verify_file_security "$DATA_FILE" 600 "$SERVICE_USER" "$SERVICE_GROUP"
verify_dir_security "$DATA_DIR" 700 "$SERVICE_USER" "$SERVICE_GROUP"
verify_dir_security "$BACKUP_DIR" 700 root root
verify_file_security "$CONFIG_DIR/bot.env" 640 root "$SERVICE_GROUP"

sentinel_tmp="$APP_ROOT/.managed-install.new.$$"
printf '%s\n' "$APP" > "$sentinel_tmp"
chmod 600 "$sentinel_tmp"
if ! is_test_mode; then chown root:root "$sentinel_tmp"; fi
mv -f -- "$sentinel_tmp" "$SENTINEL"
verify_file_security "$SENTINEL" 600 root root

install_succeeded=1
transaction_started=0
log "Installation ready: $release_dir"
