"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "../..");

async function writeExecutable(file, content) {
  await fs.writeFile(file, content, "utf8");
  await fs.chmod(file, 0o755);
}

async function createDeployHarness({ existing = false } = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "fivem-deploy-"));
  const appRoot = path.join(base, "opt", "fivem-discord-manager-bot");
  const dataDir = path.join(base, "var", "lib", "fivem-discord-manager-bot");
  const dataFile = path.join(dataDir, "data.json");
  const configDir = path.join(base, "etc", "fivem-discord-manager-bot");
  const backupDir = path.join(base, "var", "backups", "fivem-discord-manager-bot");
  const systemdDir = path.join(base, "etc", "systemd", "system");
  const serviceFile = path.join(systemdDir, "fivem-discord-manager-bot.service");
  const lockFile = path.join(base, "run", "lock", "deploy.lock");
  const mockBin = path.join(base, "mockbin");
  const activeFile = path.join(base, "service-active");
  const enabledFile = path.join(base, "service-enabled");
  const systemctlLog = path.join(base, "systemctl.log");
  const npmLog = path.join(base, "npm.log");
  const failState = path.join(base, "systemctl-failed-once");
  const healthHelper = path.join(base, "health-helper.sh");

  for (const dir of [
    path.join(appRoot, "releases"),
    dataDir,
    configDir,
    backupDir,
    systemdDir,
    path.dirname(lockFile),
    mockBin,
  ]) {
    await fs.mkdir(dir, { recursive: true });
  }
  await fs.chmod(appRoot, 0o755);
  await fs.chmod(path.join(appRoot, "releases"), 0o755);
  await fs.chmod(dataDir, 0o700);
  await fs.chmod(configDir, 0o750);
  await fs.chmod(backupDir, 0o700);

  await fs.writeFile(
    path.join(configDir, "bot.env"),
    "DISCORD_TOKEN=test-token-for-deployment-harness\nDISCORD_CLIENT_ID=\nMENTION_HERE=false\n",
    "utf8"
  );
  await fs.chmod(path.join(configDir, "bot.env"), 0o640);

  await writeExecutable(
    path.join(mockBin, "systemctl"),
    `#!/usr/bin/env bash
set -Eeuo pipefail
cmd="\${1:-}"
printf '%s\\n' "$*" >> "$MOCK_SYSTEMCTL_LOG"
if [[ -n "\${MOCK_SYSTEMCTL_FAIL_ONCE:-}" && "$cmd" == "$MOCK_SYSTEMCTL_FAIL_ONCE" && ! -e "$MOCK_FAIL_STATE" ]]; then
  : > "$MOCK_FAIL_STATE"
  exit 41
fi
case "$cmd" in
  cat)
    [[ -f "$MOCK_SERVICE_FILE" ]]
    ;;
  is-active)
    [[ -f "$MOCK_ACTIVE_FILE" ]]
    ;;
  daemon-reload|status)
    exit 0
    ;;
  enable)
    : > "$MOCK_ENABLED_FILE"
    exit 0
    ;;
  restart|start)
    : > "$MOCK_ACTIVE_FILE"
    exit 0
    ;;
  stop)
    rm -f "$MOCK_ACTIVE_FILE"
    exit 0
    ;;
  disable)
    rm -f "$MOCK_ACTIVE_FILE" "$MOCK_ENABLED_FILE"
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
`
  );

  await writeExecutable(
    path.join(mockBin, "systemd-analyze"),
    `#!/usr/bin/env bash
set -Eeuo pipefail
[[ "\${1:-}" == "verify" ]] || exit 2
[[ -f "\${2:-}" ]] || exit 3
exit 0
`
  );

  await writeExecutable(
    path.join(mockBin, "npm"),
    `#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s :: %s\\n' "$PWD" "$*" >> "$MOCK_NPM_LOG"
if [[ "\${1:-}" == "ci" ]]; then
  if [[ "\${MOCK_NPM_FAIL:-0}" == "1" ]]; then exit 42; fi
  rm -rf node_modules
  ln -s "$MOCK_ROOT_NODE_MODULES" node_modules
  exit 0
fi
if [[ "\${1:-}" == "run" && "\${2:-}" == "check:syntax" ]]; then
  exec node scripts/check-syntax.js
fi
exit 0
`
  );

  await writeExecutable(
    healthHelper,
    `#!/usr/bin/env bash
set -Eeuo pipefail
release_dir="$1"
data_file="$2"
base="$(basename "$release_dir")"
mkdir -p "$(dirname "$data_file")"
if [[ ! -f "$data_file" ]]; then
  printf '{"schemaVersion":1,"state":{"lastTickAt":1},"marker":"created"}\\n' > "$data_file"
fi
if [[ -n "\${HEALTH_MUTATE_RELEASE:-}" && "$base" == "$HEALTH_MUTATE_RELEASE" ]]; then
  printf '{"schemaVersion":1,"state":{"lastTickAt":1},"marker":"mutated-by-new-release"}\\n' > "$data_file"
fi
if [[ "\${HEALTH_ALWAYS_FAIL:-0}" == "1" ]]; then exit 1; fi
if [[ -n "\${HEALTH_FAIL_RELEASE:-}" && "$base" == "$HEALTH_FAIL_RELEASE" ]]; then exit 1; fi
if [[ -n "\${HEALTH_FAIL_DATA_MARKER:-}" ]] && grep -Fq "$HEALTH_FAIL_DATA_MARKER" "$data_file"; then exit 1; fi
exit 0
`
  );

  const env = {
    ...process.env,
    PATH: `${mockBin}:${process.env.PATH}`,
    DEPLOY_TEST_MODE: "1",
    SOURCE_DIR: root,
    APP_ROOT: appRoot,
    DATA_DIR: dataDir,
    DATA_FILE: dataFile,
    CONFIG_DIR: configDir,
    BACKUP_DIR: backupDir,
    SERVICE_FILE: serviceFile,
    SERVICE_NAME: "fivem-discord-manager-bot",
    DEPLOY_LOCK_FILE: lockFile,
    DEPLOY_HEALTHCHECK_HELPER: healthHelper,
    READINESS_ATTEMPTS: "2",
    READINESS_INTERVAL_SECONDS: "0.01",
    MOCK_SYSTEMCTL_LOG: systemctlLog,
    MOCK_SERVICE_FILE: serviceFile,
    MOCK_ACTIVE_FILE: activeFile,
    MOCK_ENABLED_FILE: enabledFile,
    MOCK_FAIL_STATE: failState,
    MOCK_NPM_LOG: npmLog,
    MOCK_ROOT_NODE_MODULES: path.join(root, "node_modules"),
  };

  async function seedExisting({ marker = "original" } = {}) {
    const oldRelease = path.join(appRoot, "releases", "old-release");
    await fs.mkdir(oldRelease, { recursive: true });
    await fs.symlink(oldRelease, path.join(appRoot, "current"));
    await fs.writeFile(serviceFile, "old-service-unit\n", "utf8");
    await fs.chmod(serviceFile, 0o644);
    await fs.writeFile(activeFile, "active\n", "utf8");
    await fs.writeFile(
      dataFile,
      JSON.stringify({ schemaVersion: 1, marker, state: { lastTickAt: 1 } }) + "\n",
      "utf8"
    );
    await fs.chmod(dataFile, 0o600);
    await fs.writeFile(path.join(appRoot, ".managed-install"), "fivem-discord-manager-bot\n", "utf8");
    await fs.chmod(path.join(appRoot, ".managed-install"), 0o600);
    return oldRelease;
  }

  if (existing) await seedExisting();

  function runScript(script, args = [], extraEnv = {}) {
    return spawnSync("bash", [path.join(root, "scripts", script), ...args], {
      cwd: root,
      env: { ...env, ...extraEnv },
      encoding: "utf8",
    });
  }

  function spawnScript(script, args = [], extraEnv = {}) {
    return spawn("bash", [path.join(root, "scripts", script), ...args], {
      cwd: root,
      env: { ...env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  async function currentRelease() {
    return fs.realpath(path.join(appRoot, "current"));
  }

  async function readData() {
    return JSON.parse(await fs.readFile(dataFile, "utf8"));
  }

  async function backups() {
    const entries = await fs.readdir(backupDir).catch(() => []);
    return entries.filter((name) => name.endsWith(".json")).sort();
  }

  async function cleanup() {
    await fs.rm(base, { recursive: true, force: true });
  }

  return {
    root,
    base,
    appRoot,
    dataDir,
    dataFile,
    configDir,
    backupDir,
    serviceFile,
    lockFile,
    activeFile,
    systemctlLog,
    npmLog,
    env,
    seedExisting,
    runScript,
    spawnScript,
    currentRelease,
    readData,
    backups,
    cleanup,
  };
}

module.exports = { createDeployHarness, root };
