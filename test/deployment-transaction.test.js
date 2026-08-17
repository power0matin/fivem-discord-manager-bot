"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createDeployHarness } = require("./helpers/deploy-harness");

async function mode(file) {
  return (await fs.stat(file)).mode & 0o777;
}

test("first install creates a managed, permission-checked release and is rerunnable", async () => {
  const h = await createDeployHarness();
  try {
    let result = h.runScript("install.sh", [], { RELEASE_ID: "release-one" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(path.basename(await h.currentRelease()), "release-one");
    assert.equal(await mode(h.dataDir), 0o700);
    assert.equal(await mode(h.configDir), 0o750);
    assert.equal(await mode(h.backupDir), 0o700);
    assert.equal(await mode(path.join(h.configDir, "bot.env")), 0o640);
    assert.equal(await mode(path.join(h.dataDir, "data.json")), 0o600);
    assert.equal(await mode(path.join(h.appRoot, ".managed-install")), 0o600);
    assert.equal(
      (await fs.readFile(path.join(h.appRoot, ".managed-install"), "utf8")).trim(),
      "fivem-discord-manager-bot"
    );

    const firstData = await h.readData();
    result = h.runScript("install.sh", [], { RELEASE_ID: "release-two" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(path.basename(await h.currentRelease()), "release-two");
    assert.deepEqual(await h.readData(), firstData);
    assert.ok((await h.backups()).length >= 1, "reinstall should create a verified data backup");
  } finally {
    await h.cleanup();
  }
});

test("installer rejects an invalid existing current symlink instead of treating it as a first install", async () => {
  const h = await createDeployHarness();
  try {
    const outside = path.join(h.base, "outside-release");
    await fs.mkdir(outside, { recursive: true });
    await fs.symlink(outside, path.join(h.appRoot, "current"));
    const result = h.runScript("install.sh", [], { RELEASE_ID: "release-bad-current" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /outside managed releases|invalid/i);
    assert.equal(await fs.realpath(path.join(h.appRoot, "current")), outside);
  } finally {
    await h.cleanup();
  }
});

test("npm ci failure occurs before release switch and preserves old service and data", async () => {
  const h = await createDeployHarness({ existing: true });
  try {
    const old = await h.currentRelease();
    const original = await h.readData();
    const oldUnit = await fs.readFile(h.serviceFile, "utf8");
    const result = h.runScript("install.sh", [], {
      RELEASE_ID: "release-npm-fail",
      MOCK_NPM_FAIL: "1",
    });
    assert.notEqual(result.status, 0);
    assert.equal(await h.currentRelease(), old);
    assert.deepEqual(await h.readData(), original);
    assert.equal(await fs.readFile(h.serviceFile, "utf8"), oldUnit);
    await assert.rejects(fs.access(path.join(h.appRoot, "releases", "release-npm-fail")));
  } finally {
    await h.cleanup();
  }
});

test("installer readiness failure rolls back symlink, unit and active release", async () => {
  const h = await createDeployHarness({ existing: true });
  try {
    const old = await h.currentRelease();
    const oldUnit = await fs.readFile(h.serviceFile, "utf8");
    const result = h.runScript("install.sh", [], {
      RELEASE_ID: "release-not-ready",
      HEALTH_FAIL_RELEASE: "release-not-ready",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /did not become ready/i);
    assert.equal(await h.currentRelease(), old);
    assert.equal(await fs.readFile(h.serviceFile, "utf8"), oldUnit);
    await assert.rejects(fs.access(path.join(h.appRoot, "releases", "release-not-ready")));
    assert.equal(await fs.readFile(h.activeFile, "utf8"), "");
  } finally {
    await h.cleanup();
  }
});

test("service installation failure does not leave a half-switched release", async () => {
  const h = await createDeployHarness({ existing: true });
  try {
    const old = await h.currentRelease();
    const oldUnit = await fs.readFile(h.serviceFile, "utf8");
    const result = h.runScript("install.sh", [], {
      RELEASE_ID: "release-service-fail",
      MOCK_SYSTEMCTL_FAIL_ONCE: "enable",
    });
    assert.notEqual(result.status, 0);
    assert.equal(await h.currentRelease(), old);
    assert.equal(await fs.readFile(h.serviceFile, "utf8"), oldUnit);
    await assert.rejects(fs.access(path.join(h.appRoot, "releases", "release-service-fail")));
  } finally {
    await h.cleanup();
  }
});

test("stale transition symlink does not permanently block a later install", async () => {
  const h = await createDeployHarness({ existing: true });
  try {
    await fs.symlink(await h.currentRelease(), path.join(h.appRoot, "current.new"));
    const result = h.runScript("install.sh", [], { RELEASE_ID: "release-after-stale" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(path.basename(await h.currentRelease()), "release-after-stale");
    await assert.rejects(fs.lstat(path.join(h.appRoot, "current.new")));
  } finally {
    await h.cleanup();
  }
});

test("successful updater creates backup, switches release and preserves data", async () => {
  const h = await createDeployHarness({ existing: true });
  try {
    const old = await h.currentRelease();
    const original = await h.readData();
    const result = h.runScript("update.sh", [], { RELEASE_ID: "release-update-ok" });
    assert.equal(result.status, 0, result.stderr);
    const current = await h.currentRelease();
    assert.notEqual(current, old);
    assert.equal(path.basename(current), "release-update-ok");
    assert.deepEqual(await h.readData(), original);
    assert.ok((await h.backups()).length >= 1);
  } finally {
    await h.cleanup();
  }
});

test("failed new release rolls code and mutated persistence back to the original state", async () => {
  const h = await createDeployHarness({ existing: true });
  try {
    const old = await h.currentRelease();
    const original = await h.readData();
    const result = h.runScript("update.sh", [], {
      RELEASE_ID: "release-update-bad",
      HEALTH_MUTATE_RELEASE: "release-update-bad",
      HEALTH_FAIL_RELEASE: "release-update-bad",
    });
    assert.notEqual(result.status, 0);
    assert.equal(await h.currentRelease(), old);
    assert.deepEqual(await h.readData(), original);
  } finally {
    await h.cleanup();
  }
});

test("updater npm failure never switches current release", async () => {
  const h = await createDeployHarness({ existing: true });
  try {
    const old = await h.currentRelease();
    const original = await h.readData();
    const result = h.runScript("update.sh", [], {
      RELEASE_ID: "release-update-npm-fail",
      MOCK_NPM_FAIL: "1",
    });
    assert.notEqual(result.status, 0);
    assert.equal(await h.currentRelease(), old);
    assert.deepEqual(await h.readData(), original);
  } finally {
    await h.cleanup();
  }
});

test("stale lock file without a holder does not block an update", async () => {
  const h = await createDeployHarness({ existing: true });
  try {
    await fs.writeFile(h.lockFile, "stale-file-is-not-a-lock\n", "utf8");
    const result = h.runScript("update.sh", [], { RELEASE_ID: "release-stale-lock" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(path.basename(await h.currentRelease()), "release-stale-lock");
  } finally {
    await h.cleanup();
  }
});

test("concurrent updater cannot acquire the held deployment lock and succeeds after release", async () => {
  const h = await createDeployHarness({ existing: true });
  try {
    const lockHolder = spawn("flock", [h.lockFile, "sleep", "0.4"], {
      env: h.env,
      stdio: "ignore",
    });
    await new Promise((resolve) => setTimeout(resolve, 80));

    let result = h.runScript("update.sh", [], { RELEASE_ID: "release-lock-blocked" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /already running/i);

    await new Promise((resolve, reject) => {
      lockHolder.on("error", reject);
      lockHolder.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`lock holder exited with ${code}`));
      });
    });

    result = h.runScript("update.sh", [], { RELEASE_ID: "release-after-lock" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(path.basename(await h.currentRelease()), "release-after-lock");
  } finally {
    await h.cleanup();
  }
});

test("backup failure aborts updater before any release switch", async () => {
  const h = await createDeployHarness({ existing: true });
  try {
    const old = await h.currentRelease();
    const original = await h.readData();
    const badBackupPath = path.join(h.base, "backup-is-a-file");
    await fs.writeFile(badBackupPath, "not a directory", "utf8");
    const result = h.runScript("update.sh", [], {
      BACKUP_DIR: badBackupPath,
      RELEASE_ID: "release-no-backup",
    });
    assert.notEqual(result.status, 0);
    assert.equal(await h.currentRelease(), old);
    assert.deepEqual(await h.readData(), original);
  } finally {
    await h.cleanup();
  }
});
