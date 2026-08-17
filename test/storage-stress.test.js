"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

async function withStorage(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fivem-storage-stress-"));
  const file = path.join(dir, "data.json");
  process.env.DATA_FILE = file;
  const modulePath = require.resolve("../src/modules/stream-notifier/storage");
  delete require.cache[modulePath];
  const storage = require(modulePath);
  try {
    await fn(storage, file, dir);
  } finally {
    storage._resetForTests();
    delete require.cache[modulePath];
    delete process.env.DATA_FILE;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("two thousand burst mutations coalesce to a bounded write backlog and persist the latest state", async () => {
  await withStorage(async (storage, file) => {
    const db = await storage.loadDb();
    let renameCount = 0;
    storage._setFsForTests({
      rename: async (...args) => {
        renameCount += 1;
        await delay(2);
        return fs.rename(...args);
      },
    });

    let immediateFired = false;
    const immediate = new Promise((resolve) => setImmediate(() => {
      immediateFired = true;
      resolve();
    }));

    const writes = [];
    for (let i = 0; i < 2000; i += 1) {
      db.state.lastTickAt = i;
      writes.push(storage.saveDb(db, { createBackup: false }));
    }

    assert.ok(new Set(writes).size <= 2, "burst writes should share at most active + pending promises");
    await immediate;
    assert.equal(immediateFired, true);
    await Promise.all(writes);
    await storage.flushDb();

    const persisted = JSON.parse(await fs.readFile(file, "utf8"));
    assert.equal(persisted.state.lastTickAt, 1999);
    assert.ok(renameCount <= 3, `expected coalesced physical writes, saw ${renameCount}`);
    assert.deepEqual(storage._getQueueState(), {
      writerRunning: false,
      hasPendingSnapshot: false,
      hasPendingPromise: false,
      lastWriteError: null,
    });
  });
});

test("save queued while backup copy is in progress persists the later mutation", async () => {
  await withStorage(async (storage, file) => {
    const db = await storage.loadDb();
    let copyStartedResolve;
    const copyStarted = new Promise((resolve) => { copyStartedResolve = resolve; });
    let unblockCopyResolve;
    const unblockCopy = new Promise((resolve) => { unblockCopyResolve = resolve; });

    storage._setFsForTests({
      copyFile: async (...args) => {
        copyStartedResolve();
        await unblockCopy;
        return fs.copyFile(...args);
      },
    });

    db.state.lastTickAt = 10;
    const first = storage.saveDb(db);
    await copyStarted;
    db.state.lastTickAt = 11;
    const second = storage.saveDb(db);
    unblockCopyResolve();
    await Promise.all([first, second]);
    await storage.flushDb();

    assert.equal(JSON.parse(await fs.readFile(file, "utf8")).state.lastTickAt, 11);
  });
});

test("flush waits for a pending atomic rename before returning", async () => {
  await withStorage(async (storage, file) => {
    const db = await storage.loadDb();
    let renameStartedResolve;
    const renameStarted = new Promise((resolve) => { renameStartedResolve = resolve; });
    let unblockResolve;
    const unblock = new Promise((resolve) => { unblockResolve = resolve; });

    storage._setFsForTests({
      rename: async (...args) => {
        renameStartedResolve();
        await unblock;
        return fs.rename(...args);
      },
    });

    db.state.lastTickAt = 22;
    const save = storage.saveDb(db, { createBackup: false });
    await renameStarted;
    let flushed = false;
    const flush = storage.flushDb().then(() => { flushed = true; });
    await delay(10);
    assert.equal(flushed, false);
    unblockResolve();
    await Promise.all([save, flush]);
    assert.equal(JSON.parse(await fs.readFile(file, "utf8")).state.lastTickAt, 22);
  });
});

test("rename rejection keeps the prior database, removes temp files and queue recovers", async () => {
  await withStorage(async (storage, file, dir) => {
    const db = await storage.loadDb();
    const before = await fs.readFile(file, "utf8");
    let failed = false;
    storage._setFsForTests({
      rename: async (...args) => {
        if (!failed) {
          failed = true;
          const err = new Error("simulated rename failure");
          err.code = "EIO";
          throw err;
        }
        return fs.rename(...args);
      },
    });

    db.state.lastTickAt = 30;
    await assert.rejects(storage.saveDb(db, { createBackup: false }), /rename failure/);
    await assert.rejects(storage.flushDb(), /rename failure/);
    assert.equal(await fs.readFile(file, "utf8"), before);
    assert.equal((await fs.readdir(dir)).some((name) => name.includes(".tmp-")), false);

    db.state.lastTickAt = 31;
    await storage.saveDb(db, { createBackup: false });
    await storage.flushDb();
    assert.equal(JSON.parse(await fs.readFile(file, "utf8")).state.lastTickAt, 31);
  });
});

test("fsync rejection fails the save without replacing the database and later save succeeds", async () => {
  await withStorage(async (storage, file, dir) => {
    const db = await storage.loadDb();
    const before = await fs.readFile(file, "utf8");
    let failSync = true;
    storage._setFsForTests({
      open: async (...args) => {
        const handle = await fs.open(...args);
        return {
          writeFile: (...writeArgs) => handle.writeFile(...writeArgs),
          sync: async () => {
            if (failSync) {
              failSync = false;
              throw new Error("simulated fsync rejection");
            }
            return handle.sync();
          },
          close: () => handle.close(),
        };
      },
    });

    db.state.lastTickAt = 40;
    await assert.rejects(storage.saveDb(db, { createBackup: false }), /fsync rejection/);
    assert.equal(await fs.readFile(file, "utf8"), before);
    assert.equal((await fs.readdir(dir)).some((name) => name.includes(".tmp-")), false);

    db.state.lastTickAt = 41;
    await storage.saveDb(db, { createBackup: false });
    assert.equal(JSON.parse(await fs.readFile(file, "utf8")).state.lastTickAt, 41);
  });
});

test("write rejection leaves no temp file and does not poison future writes", async () => {
  await withStorage(async (storage, file, dir) => {
    const db = await storage.loadDb();
    let failWrite = true;
    storage._setFsForTests({
      open: async (...args) => {
        const handle = await fs.open(...args);
        return {
          writeFile: async (...writeArgs) => {
            if (failWrite) {
              failWrite = false;
              throw new Error("simulated write rejection");
            }
            return handle.writeFile(...writeArgs);
          },
          sync: () => handle.sync(),
          close: () => handle.close(),
        };
      },
    });

    db.state.lastTickAt = 50;
    await assert.rejects(storage.saveDb(db, { createBackup: false }), /write rejection/);
    assert.equal((await fs.readdir(dir)).some((name) => name.includes(".tmp-")), false);

    db.state.lastTickAt = 51;
    await storage.saveDb(db, { createBackup: false });
    assert.equal(JSON.parse(await fs.readFile(file, "utf8")).state.lastTickAt, 51);
  });
});

test("corrupted previous-backup verification aborts replacement", async () => {
  await withStorage(async (storage, file) => {
    const db = await storage.loadDb();
    const before = await fs.readFile(file, "utf8");
    storage._setFsForTests({
      copyFile: async (_source, destination) => {
        await fs.writeFile(destination, "{corrupt-backup", "utf8");
      },
    });

    db.state.lastTickAt = 60;
    await assert.rejects(storage.saveDb(db), /Unexpected token|JSON|load/i);
    assert.equal(await fs.readFile(file, "utf8"), before);
  });
});

test("shutdown flush after a concurrent save persists the final mutation", async () => {
  await withStorage(async (storage, file) => {
    const db = await storage.loadDb();
    storage._setFsForTests({
      rename: async (...args) => {
        await delay(5);
        return fs.rename(...args);
      },
    });
    db.state.lastTickAt = 70;
    const save = storage.saveDb(db, { createBackup: false });
    const shutdownFlush = storage.flushDb();
    await Promise.all([save, shutdownFlush]);
    assert.equal(JSON.parse(await fs.readFile(file, "utf8")).state.lastTickAt, 70);
  });
});
