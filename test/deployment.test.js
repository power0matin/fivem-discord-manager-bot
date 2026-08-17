"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");

function run(command, args, env = {}) {
  return spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

test("healthcheck distinguishes ready and stale runtime state", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fivem-health-"));
  const file = path.join(dir, "data.json");
  try {
    await fs.writeFile(file, JSON.stringify({ state: { lastTickAt: Date.now() } }));
    let result = run(process.execPath, ["scripts/healthcheck.js"], { DATA_FILE: file });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^READY/);

    await fs.writeFile(file, JSON.stringify({ state: { lastTickAt: Date.now() - 3600_000 } }));
    result = run(process.execPath, ["scripts/healthcheck.js"], {
      DATA_FILE: file,
      HEALTH_MAX_TICK_AGE_SECONDS: "60",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^NOT_READY/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("backup and restore round-trip preserves database", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fivem-backup-"));
  const data = path.join(dir, "data.json");
  const backups = path.join(dir, "backups");
  const original = { schemaVersion: 1, settings: { keywordRegex: "original" }, state: { lastTickAt: 123 } };
  try {
    await fs.writeFile(data, JSON.stringify(original));
    const backup = run("bash", ["scripts/backup.sh"], { DATA_FILE: data, BACKUP_DIR: backups });
    assert.equal(backup.status, 0, backup.stderr);
    const backupFile = backup.stdout.trim();
    assert.ok(backupFile.startsWith(backups));

    await fs.writeFile(data, JSON.stringify({ changed: true }));
    const restore = run("bash", ["scripts/restore.sh", backupFile], {
      DATA_FILE: data,
      BACKUP_DIR: backups,
      SERVICE_NAME: "definitely-not-a-real-service",
    });
    assert.equal(restore.status, 0, restore.stderr);
    assert.deepEqual(JSON.parse(await fs.readFile(data, "utf8")), original);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("shell scripts parse successfully", () => {
  for (const script of ["backup.sh", "restore.sh", "install.sh", "update.sh", "uninstall.sh"]) {
    const result = run("bash", ["-n", `scripts/${script}`]);
    assert.equal(result.status, 0, `${script}: ${result.stderr}`);
  }
});
