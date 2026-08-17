#!/usr/bin/env bash
# shellcheck shell=bash

APP="${APP:-fivem-discord-manager-bot}"
DEPLOY_TEST_MODE="${DEPLOY_TEST_MODE:-0}"
SERVICE_USER="${SERVICE_USER:-fivembot}"
SERVICE_GROUP="${SERVICE_GROUP:-fivembot}"
DEPLOY_LOCK_FILE="${DEPLOY_LOCK_FILE:-/run/lock/${APP}-deploy.lock}"
READINESS_ATTEMPTS="${READINESS_ATTEMPTS:-30}"
READINESS_INTERVAL_SECONDS="${READINESS_INTERVAL_SECONDS:-2}"

log() {
  printf '[deploy] %s\n' "$*"
}

die() {
  printf '[deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

is_test_mode() {
  [[ "$DEPLOY_TEST_MODE" == "1" ]]
}

require_root() {
  if is_test_mode; then
    SERVICE_USER="${SERVICE_USER:-$(id -un)}"
    SERVICE_GROUP="${SERVICE_GROUP:-$(id -gn)}"
    if [[ "$SERVICE_USER" == "fivembot" ]]; then SERVICE_USER="$(id -un)"; fi
    if [[ "$SERVICE_GROUP" == "fivembot" ]]; then SERVICE_GROUP="$(id -gn)"; fi
    export SERVICE_USER SERVICE_GROUP
    return 0
  fi
  [[ ${EUID:-$(id -u)} -eq 0 ]] || die "This command must be run as root."
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

require_supported_platform() {
  [[ "$(uname -s)" == "Linux" ]] || die "Production deployment supports Linux only."
  require_command systemctl
  if ! is_test_mode && [[ ! -d /run/systemd/system ]]; then
    die "systemd is not running as the system service manager."
  fi
}

validate_node_version() {
  require_command node
  require_command npm
  node -e '
    const [major] = process.versions.node.split(".").map(Number);
    if (!Number.isInteger(major) || major < 22) process.exit(1);
  ' || die "Node.js >=22 LTS is required; found $(node -v 2>/dev/null || echo unknown)."
}

validate_positive_int() {
  [[ "$2" =~ ^[1-9][0-9]*$ ]] || die "$1 must be a positive integer."
}

validate_sleep_value() {
  [[ "$2" =~ ^[0-9]+([.][0-9]+)?$ ]] || die "$1 must be a non-negative number."
}

assert_safe_absolute_dir() {
  local value="$1" label="$2"
  [[ "$value" == /* ]] || die "$label must be an absolute path: $value"
  case "$value" in
    /|/bin|/boot|/dev|/etc|/home|/lib|/lib64|/opt|/proc|/root|/run|/sbin|/srv|/sys|/tmp|/usr|/var)
      die "$label is too broad or unsafe: $value"
      ;;
  esac
}

safe_remove_tree() {
  local value="$1" required_prefix="$2"
  assert_safe_absolute_dir "$value" "remove path"
  [[ "$value" == "$required_prefix"/* ]] || die "Refusing to remove path outside $required_prefix: $value"
  rm -rf --one-file-system -- "$value"
}

install_dir() {
  local mode="$1" owner="$2" group="$3" target="$4"
  if is_test_mode; then
    install -d -m "$mode" "$target"
  else
    install -d -o "$owner" -g "$group" -m "$mode" "$target"
  fi
}

install_file() {
  local mode="$1" owner="$2" group="$3" source="$4" target="$5"
  if is_test_mode; then
    install -m "$mode" "$source" "$target"
  else
    install -m "$mode" -o "$owner" -g "$group" "$source" "$target"
  fi
}

verify_mode() {
  local path="$1" expected="$2" actual
  actual="$(stat -c '%a' "$path")"
  [[ "$actual" == "$expected" ]] || die "Unexpected permissions for $path: $actual (expected $expected)"
}

verify_owner_group() {
  local path="$1" expected_owner="$2" expected_group="$3" actual
  if is_test_mode; then
    expected_owner="$(id -un)"
    expected_group="$(id -gn)"
  fi
  actual="$(stat -c '%U:%G' "$path")"
  [[ "$actual" == "$expected_owner:$expected_group" ]] || \
    die "Unexpected ownership for $path: $actual (expected $expected_owner:$expected_group)"
}

verify_dir_security() {
  local path="$1" mode="$2" owner="$3" group="$4"
  [[ -d "$path" ]] || die "Required directory is missing: $path"
  verify_mode "$path" "$mode"
  verify_owner_group "$path" "$owner" "$group"
}

verify_file_security() {
  local path="$1" mode="$2" owner="$3" group="$4"
  [[ -f "$path" ]] || die "Required file is missing: $path"
  verify_mode "$path" "$mode"
  verify_owner_group "$path" "$owner" "$group"
}

acquire_deploy_lock() {
  require_command flock
  validate_positive_int READINESS_ATTEMPTS "$READINESS_ATTEMPTS"
  validate_sleep_value READINESS_INTERVAL_SECONDS "$READINESS_INTERVAL_SECONDS"

  if [[ -n "${DEPLOY_LOCK_FD:-}" ]]; then
    [[ "$DEPLOY_LOCK_FD" =~ ^[0-9]+$ ]] || die "DEPLOY_LOCK_FD is invalid."
    [[ -e "/proc/$$/fd/$DEPLOY_LOCK_FD" ]] || die "Inherited deployment lock descriptor is not open."
    flock -n "$DEPLOY_LOCK_FD" || die "Inherited deployment lock is not held."
    return 0
  fi

  mkdir -p "$(dirname "$DEPLOY_LOCK_FILE")"
  exec {DEPLOY_LOCK_FD}>"$DEPLOY_LOCK_FILE"
  if ! flock -n "$DEPLOY_LOCK_FD"; then
    die "Another install/update operation is already running."
  fi
  export DEPLOY_LOCK_FD
}

resolve_current_release() {
  local app_root="$1" link="$app_root/current" target
  if [[ ! -e "$link" && ! -L "$link" ]]; then
    return 1
  fi
  [[ -L "$link" ]] || die "Managed current path exists but is not a symlink: $link"
  target="$(readlink -f "$link")"
  [[ -d "$target" ]] || die "Current release target is missing: $target"
  [[ "$target" == "$app_root/releases/"* ]] || die "Current symlink points outside managed releases: $target"
  printf '%s\n' "$target"
}

remove_stale_transition_link() {
  local path="$1"
  if [[ -L "$path" ]]; then
    rm -f -- "$path"
  elif [[ -e "$path" ]]; then
    die "Refusing to replace non-symlink transition path: $path"
  fi
}

atomic_switch_link() {
  local target="$1" link="$2" tmp="${link}.new.$$"
  remove_stale_transition_link "$tmp"
  ln -s "$target" "$tmp"
  mv -Tf "$tmp" "$link"
}

run_healthcheck() {
  local release_dir="$1" data_file="$2"
  if [[ -n "${DEPLOY_HEALTHCHECK_HELPER:-}" ]]; then
    is_test_mode || die "DEPLOY_HEALTHCHECK_HELPER is allowed only in DEPLOY_TEST_MODE=1."
    "$DEPLOY_HEALTHCHECK_HELPER" "$release_dir" "$data_file"
    return
  fi
  DATA_FILE="$data_file" node "$release_dir/scripts/healthcheck.js"
}

wait_for_readiness() {
  local release_dir="$1" data_file="$2" attempt
  for ((attempt = 1; attempt <= READINESS_ATTEMPTS; attempt += 1)); do
    if run_healthcheck "$release_dir" "$data_file" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$READINESS_INTERVAL_SECONDS"
  done
  return 1
}

service_exists() {
  systemctl cat "$APP" >/dev/null 2>&1
}

service_is_active() {
  systemctl is-active --quiet "$APP" >/dev/null 2>&1
}

validate_env_file() {
  local release_dir="$1" env_file="$2"
  (
    cd "$release_dir"
    DOTENV_CONFIG_PATH="$env_file" node -r dotenv/config -e '
      const { loadConfig } = require("./src/modules/stream-notifier/config");
      loadConfig(process.env);
    '
  ) >/dev/null
}

verify_unit_syntax() {
  local unit_file="$1"
  if command -v systemd-analyze >/dev/null 2>&1; then
    systemd-analyze verify "$unit_file"
  fi
}
