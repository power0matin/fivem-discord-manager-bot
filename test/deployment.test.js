"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createDeployHarness } = require("./helpers/deploy-harness");

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
  const h = await createDeployHarness({ existing: true });
  try {
    const original = await h.readData();
    const backup = h.runScript("backup.sh");
    assert.equal(backup.status, 0, backup.stderr);
    const backupFile = backup.stdout.trim();
    assert.ok(backupFile.startsWith(h.backupDir));

    await fs.writeFile(h.dataFile, JSON.stringify({ schemaVersion: 1, changed: true, state: { lastTickAt: 1 } }));
    const restore = h.runScript("restore.sh", [backupFile]);
    assert.equal(restore.status, 0, restore.stderr);
    assert.deepEqual(await h.readData(), original);
  } finally {
    await h.cleanup();
  }
});

test("shell scripts parse successfully", () => {
  for (const script of ["backup.sh", "restore.sh", "install.sh", "update.sh", "uninstall.sh"]) {
    const result = run("bash", ["-n", `scripts/${script}`]);
    assert.equal(result.status, 0, `${script}: ${result.stderr}`);
  }
});
