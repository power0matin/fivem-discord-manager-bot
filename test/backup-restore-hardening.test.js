"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { createDeployHarness } = require("./helpers/deploy-harness");

async function mode(file) {
  return (await fs.stat(file)).mode & 0o777;
}

async function rewriteChecksum(file) {
  const raw = await fs.readFile(file);
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  await fs.writeFile(`${file}.sha256`, `${hash}  ${path.basename(file)}\n`, "utf8");
}

async function assertServiceActive(h) {
  assert.ok(await fs.stat(h.activeFile));
}

test("rapid backups are unique, verified and stored outside release directories", async () => {
  const h = await createDeployHarness({ existing: true });
  try {
    const results = [];
    for (let i = 0; i < 8; i += 1) {
      const result = h.runScript("backup.sh");
      assert.equal(result.status, 0, result.stderr);
      results.push(result.stdout.trim());
    }
    assert.equal(new Set(results).size, results.length);
    for (const file of results) {
      assert.ok(file.startsWith(`${h.backupDir}${path.sep}`));
      assert.equal(file.startsWith(`${h.appRoot}${path.sep}`), false);
      assert.equal(await mode(file), 0o600);
      assert.equal(await mode(`${file}.sha256`), 0o600);
      assert.equal(JSON.parse(await fs.readFile(file, "utf8")).schemaVersion, 1);
    }
  } finally {
    await h.cleanup();
  }
});

test("restore rejects nonexistent backup without changing healthy data", async () => {
  const h = await createDeployHarness({ existing: true });
  try {
    const original = await h.readData();
    const result = h.runScript("restore.sh", [path.join(h.backupDir, "missing.json")]);
    assert.notEqual(result.status, 0);
    assert.deepEqual(await h.readData(), original);
    await assertServiceActive(h);
  } finally {
    await h.cleanup();
  }
});

test("restore rejects checksum corruption before touching the database", async () => {
  const h = await createDeployHarness({ existing: true });
  try {
    const original = await h.readData();
    const backupResult = h.runScript("backup.sh");
    assert.equal(backupResult.status, 0, backupResult.stderr);
    const backup = backupResult.stdout.trim();
    await fs.appendFile(backup, "tampered\n", "utf8");

    const result = h.runScript("restore.sh", [backup]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /checksum/i);
    assert.deepEqual(await h.readData(), original);
    await assertServiceActive(h);
  } finally {
    await h.cleanup();
  }
});

test("restore rejects malformed JSON even when its checksum is internally consistent", async () => {
  const h = await createDeployHarness({ existing: true });
  try {
    const original = await h.readData();
    const backupResult = h.runScript("backup.sh");
    assert.equal(backupResult.status, 0, backupResult.stderr);
    const backup = backupResult.stdout.trim();
    await fs.writeFile(backup, "{malformed-json", "utf8");
    await rewriteChecksum(backup);

    const result = h.runScript("restore.sh", [backup]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid persistence file/i);
    assert.deepEqual(await h.readData(), original);
    await assertServiceActive(h);
  } finally {
    await h.cleanup();
  }
});

test("restore readiness failure rolls the original healthy database back", async () => {
  const h = await createDeployHarness({ existing: true });
  try {
    const original = await h.readData();
    const backupResult = h.runScript("backup.sh");
    assert.equal(backupResult.status, 0, backupResult.stderr);
    const backup = backupResult.stdout.trim();
    const badButValid = { schemaVersion: 1, marker: "restored-bad", state: { lastTickAt: 1 } };
    await fs.writeFile(backup, JSON.stringify(badButValid) + "\n", "utf8");
    await rewriteChecksum(backup);

    const result = h.runScript("restore.sh", [backup], {
      HEALTH_FAIL_DATA_MARKER: "restored-bad",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /did not become ready/i);
    assert.deepEqual(await h.readData(), original);
    assert.equal(await mode(path.join(h.dataDir, "data.json")), 0o600);
    await assertServiceActive(h);
  } finally {
    await h.cleanup();
  }
});

test("restore preserves original state and resumes service when the data directory is not safely writable", async () => {
  const h = await createDeployHarness({ existing: true });
  try {
    const original = await h.readData();
    const backupResult = h.runScript("backup.sh");
    assert.equal(backupResult.status, 0, backupResult.stderr);
    const backup = backupResult.stdout.trim();

    await fs.chmod(h.dataDir, 0o500);
    const result = h.runScript("restore.sh", [backup]);
    assert.notEqual(result.status, 0);
    await fs.chmod(h.dataDir, 0o700);
    assert.deepEqual(await h.readData(), original);
    await assertServiceActive(h);
  } finally {
    await fs.chmod(h.dataDir, 0o700).catch(() => {});
    await h.cleanup();
  }
});

test("pre-restore safety-backup failure resumes the original service without changing data", async () => {
  const h = await createDeployHarness({ existing: true });
  try {
    const original = await h.readData();
    const backupResult = h.runScript("backup.sh");
    assert.equal(backupResult.status, 0, backupResult.stderr);
    const originalBackup = backupResult.stdout.trim();

    const externalDir = path.join(h.base, "external-restore-source");
    await fs.mkdir(externalDir, { recursive: true });
    const restoreSource = path.join(externalDir, path.basename(originalBackup));
    await fs.copyFile(originalBackup, restoreSource);
    await fs.copyFile(`${originalBackup}.sha256`, `${restoreSource}.sha256`);

    const invalidSafetyDir = path.join(h.base, "safety-backup-target-is-file");
    await fs.writeFile(invalidSafetyDir, "not-a-directory", "utf8");

    const result = h.runScript("restore.sh", [restoreSource], {
      BACKUP_DIR: invalidSafetyDir,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /pre-restore safety backup|Failed to create/i);
    assert.deepEqual(await h.readData(), original);
    await assertServiceActive(h);
  } finally {
    await h.cleanup();
  }
});

test("restore rejects a backup directory nested inside the release tree", async () => {
  const h = await createDeployHarness({ existing: true });
  try {
    const original = await h.readData();
    const unsafeDir = path.join(h.appRoot, "backups");
    await fs.mkdir(unsafeDir, { recursive: true });
    const copy = path.join(unsafeDir, "copy.json");
    await fs.writeFile(copy, JSON.stringify(original) + "\n", "utf8");
    await rewriteChecksum(copy);

    const result = h.runScript("restore.sh", [copy], { BACKUP_DIR: unsafeDir });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /outside the release directory/i);
    assert.deepEqual(await h.readData(), original);
    await assertServiceActive(h);
  } finally {
    await h.cleanup();
  }
});

test("successful restore preserves schema and enforces mode 0600", async () => {
  const h = await createDeployHarness({ existing: true });
  try {
    const backupResult = h.runScript("backup.sh");
    assert.equal(backupResult.status, 0, backupResult.stderr);
    const backup = backupResult.stdout.trim();
    const desired = { schemaVersion: 1, marker: "restored-good", state: { lastTickAt: 1 } };
    await fs.writeFile(backup, JSON.stringify(desired) + "\n", "utf8");
    await rewriteChecksum(backup);

    const result = h.runScript("restore.sh", [backup]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(await h.readData(), desired);
    assert.equal((await h.readData()).schemaVersion, 1);
    assert.equal(await mode(path.join(h.dataDir, "data.json")), 0o600);
    await assertServiceActive(h);
  } finally {
    await h.cleanup();
  }
});

test("uninstall refuses missing sentinel and safe uninstall preserves data", async () => {
  const h = await createDeployHarness({ existing: true });
  try {
    const original = await h.readData();
    await fs.rm(path.join(h.appRoot, ".managed-install"));
    let result = h.runScript("uninstall.sh");
    assert.notEqual(result.status, 0);
    assert.deepEqual(await h.readData(), original);
    assert.ok(await fs.stat(h.appRoot));

    await fs.writeFile(path.join(h.appRoot, ".managed-install"), "fivem-discord-manager-bot\n", "utf8");
    await fs.chmod(path.join(h.appRoot, ".managed-install"), 0o600);
    result = h.runScript("uninstall.sh");
    assert.equal(result.status, 0, result.stderr);
    await assert.rejects(fs.access(h.appRoot));
    await assert.rejects(fs.access(h.configDir));
    assert.deepEqual(await h.readData(), original);
  } finally {
    await h.cleanup();
  }
});
