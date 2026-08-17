"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

async function withStorage(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fivem-storage-"));
  const file = path.join(dir, "data.json");
  process.env.DATA_FILE = file;
  const modPath = require.resolve("../src/modules/stream-notifier/storage");
  delete require.cache[modPath];
  const storage = require(modPath);
  try {
    await fn(storage, file, dir);
  } finally {
    delete require.cache[modPath];
    delete process.env.DATA_FILE;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("missing database creates a valid default database", async () => {
  await withStorage(async (storage, file) => {
    const db = await storage.loadDb();
    assert.equal(db.schemaVersion, 1);
    assert.equal(db.fivem.settings.baseUrl, null);
    const raw = JSON.parse(await fs.readFile(file, "utf8"));
    assert.equal(raw.schemaVersion, 1);
  });
});

test("corrupt database fails closed and is not overwritten", async () => {
  await withStorage(async (storage, file) => {
    await fs.writeFile(file, "{not-json", "utf8");
    await assert.rejects(storage.loadDb(), /Failed to load/);
    assert.equal(await fs.readFile(file, "utf8"), "{not-json");
  });
});

test("concurrent saves are serialized and keep valid JSON", async () => {
  await withStorage(async (storage, file) => {
    const db = await storage.loadDb();
    const writes = [];
    for (let i = 0; i < 100; i += 1) {
      db.state.lastTickAt = i;
      writes.push(storage.saveDb(db));
    }
    await Promise.all(writes);
    await storage.flushDb();
    const raw = JSON.parse(await fs.readFile(file, "utf8"));
    assert.equal(raw.state.lastTickAt, 99);
  });
});

test("loadDb returns one canonical reference", async () => {
  await withStorage(async (storage) => {
    const a = await storage.loadDb();
    const b = await storage.loadDb();
    assert.equal(a, b);
  });
});

test("backup can restore persisted configuration", async () => {
  await withStorage(async (storage) => {
    const db = await storage.loadDb();
    db.settings.keywordRegex = "first";
    await storage.saveDb(db);
    db.settings.keywordRegex = "second";
    await storage.saveDb(db);
    db.settings.keywordRegex = "third";
    await storage.restoreBackup();
    assert.equal(db.settings.keywordRegex, "first");
  });
});

test("legacy ticket mappings migrate without data loss", async () => {
  await withStorage(async (storage, file) => {
    await fs.writeFile(file, JSON.stringify({
      tickets: {
        settings: { categoryId: "cat", staffRoleIds: ["staff"] },
        state: { openByUserId: { u1: "c1" }, openByChannelId: { c1: "u1" } }
      }
    }), "utf8");
    const db = await storage.loadDb();
    assert.equal(db.tickets.settings.types.support.categoryId, "cat");
    assert.deepEqual(db.tickets.settings.types.support.staffRoleIds, ["staff"]);
    assert.equal(db.tickets.state.byUser.u1.support, "c1");
    assert.equal(db.tickets.state.channels.c1.ownerId, "u1");
  });
});
