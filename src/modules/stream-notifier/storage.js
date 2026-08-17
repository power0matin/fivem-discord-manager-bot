"use strict";

const realFs = require("node:fs/promises");
let fs = realFs;
const path = require("node:path");
const crypto = require("node:crypto");

const DATA_DIR = path.resolve(process.env.DATA_DIR || process.cwd());
const DB_PATH = path.resolve(process.env.DATA_FILE || path.join(DATA_DIR, "data.json"));
const BACKUP_PATH = `${DB_PATH}.bak`;
const SCHEMA_VERSION = 1;

const DEFAULT_DB = {
  schemaVersion: SCHEMA_VERSION,
  settings: {
    notifyChannelId: null,
    mentionHere: true,
    keywordRegex: "nox\\s*rp",
    checkIntervalSeconds: 60,
    discoveryMode: false,
    discoveryTwitchPages: 5,
    discoveryKickLimit: 100,
    twitchGta5GameId: "32982",
    kickGtaCategoryName: "Grand Theft Auto V",
    kickGtaCategoryId: null,
    kickGtaCategoryResolvedAt: 0,
  },
  fivem: {
    settings: {
      enabled: false,
      baseUrl: null,
      statusChannelId: null,
      statusMessageId: null,
      checkIntervalSeconds: 300,
      timeoutMs: 5000,
      title: null,
      description: null,
      bannerImageUrl: null,
      embedColor: null,
      connectCommand: null,
      connectLabel: "Connect",
      connectUrl: null,
      websiteLabel: "Website",
      websiteUrl: null,
      websiteEmoji: "🌐",
      connectEmoji: "🎮",
      showPlayers: true,
      maxPlayersShown: 10,
      restartTimes: [],
      voiceStatusChannelId: null,
      enableScheduledEvents: false,
    },
    state: {
      consecutiveFailures: 0,
      nextAllowedAt: 0,
      lastError: null,
      lastErrorAt: 0,
      lastSuccessAt: 0,
      lastCheckedAt: 0,
      lastOnline: null,
      wentOnlineAt: 0,
      lastRestartEventAt: 0,
    },
  },
  tickets: {
    settings: {
      enabled: false,
      categoryId: null,
      staffRoleIds: [],
      panelChannelId: null,
      panelMessageId: null,
      logChannelId: null,
      ticketNamePrefix: "ticket",
      maxOpenPerUser: 1,
      allowUserClose: true,
      enableTextCommands: false,
      panel: {
        channelId: null,
        messageId: null,
        title: "Support Center",
        description: "Choose a category below to open a private ticket.\n\nPlease provide complete details (screenshots, IDs, timestamps) for faster resolution.",
        footer: "Abuse/spam may lead to penalties. One ticket per category.",
        buttonsPerRow: 2,
      },
      types: {
        support: {
          label: "Support",
          emoji: "🎫",
          categoryId: null,
          staffRoleIds: [],
          mentionRoleIds: [],
          introMessage: "Hello {mention}.\nPlease describe your issue with full details.\nIf this is a report, include proof (clip/screenshot) and player IDs.",
          voiceMove: {
            enabled: false,
            targetVoiceChannelId: null,
            label: "Move to Staff Voice",
            emoji: "🔊",
          },
        },
      },
    },
    state: {
      openByUserId: {},
      openByChannelId: {},
      byUser: {},
      channels: {},
      pendingCreates: {},
    },
  },
  welcome: {
    settings: {
      enabled: false,
      channelId: null,
      messageTemplate: "Welcome {mention} to **{server}**!",
      embedTitle: "Community",
      embedDescriptionTemplate: "Welcome to **{server}**! We are glad to have you.",
      buttons: {
        button1Label: "Rules",
        button1Url: null,
        button2Label: "Website",
        button2Url: null,
      },
      dmEnabled: false,
      dmTemplate: "Welcome to {server}!",
      autoRoleId: null,
      bannerImageUrl: null,
      antiRaidEnabled: false,
      antiRaidThreshold: 5,
      goodbyeEnabled: false,
      goodbyeChannelId: null,
      goodbyeTitle: "Goodbye!",
      goodbyeMessage: "See you next time, {user}!",
      goodbyeColor: null,
      statsVoiceChannelId: null,
      statsFormat: "Members: {total}",
      logChannelId: null,
    },
  },
  kick: { streamers: [] },
  twitch: { streamers: [] },
  state: {
    kickLastAnnounced: {},
    twitchLastAnnounced: {},
    kickActiveMessages: {},
    twitchActiveMessages: {},
    kickHealth: {
      consecutiveFailures: 0,
      nextAllowedAt: 0,
      lastError: null,
      lastErrorAt: 0,
      lastSuccessAt: 0,
      lastLoggedAt: 0,
    },
    twitchHealth: {
      consecutiveFailures: 0,
      nextAllowedAt: 0,
      lastError: null,
      lastErrorAt: 0,
      lastSuccessAt: 0,
      lastLoggedAt: 0,
    },
    lastTickAt: 0,
    lastTickDurationMs: 0,
  },
};

let canonicalDb = null;
let loadPromise = null;
let writerPromise = null;
let pendingSnapshot = null;
let pendingBackupRequired = false;
let pendingDeferred = null;
let lastWriteError = null;

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function cloneDefault() {
  return structuredClone(DEFAULT_DB);
}

function mergeDb(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("data.json root must be a JSON object");
  }

  const db = {
    ...cloneDefault(),
    ...parsed,
    schemaVersion: SCHEMA_VERSION,
    settings: { ...DEFAULT_DB.settings, ...(parsed.settings || {}) },
    fivem: { ...DEFAULT_DB.fivem, ...(parsed.fivem || {}) },
    tickets: { ...DEFAULT_DB.tickets, ...(parsed.tickets || {}) },
    welcome: { ...DEFAULT_DB.welcome, ...(parsed.welcome || {}) },
    kick: { ...DEFAULT_DB.kick, ...(parsed.kick || {}) },
    twitch: { ...DEFAULT_DB.twitch, ...(parsed.twitch || {}) },
    state: { ...DEFAULT_DB.state, ...(parsed.state || {}) },
  };

  db.fivem.settings = { ...DEFAULT_DB.fivem.settings, ...(db.fivem.settings || {}) };
  db.fivem.state = { ...DEFAULT_DB.fivem.state, ...(db.fivem.state || {}) };

  db.tickets.settings = { ...DEFAULT_DB.tickets.settings, ...(db.tickets.settings || {}) };
  db.tickets.settings.panel = { ...DEFAULT_DB.tickets.settings.panel, ...(db.tickets.settings.panel || {}) };
  db.tickets.settings.types = { ...DEFAULT_DB.tickets.settings.types, ...(db.tickets.settings.types || {}) };
  db.tickets.settings.types.support = {
    ...DEFAULT_DB.tickets.settings.types.support,
    ...(db.tickets.settings.types.support || {}),
  };
  db.tickets.state = { ...DEFAULT_DB.tickets.state, ...(db.tickets.state || {}) };
  db.tickets.state.openByUserId ||= {};
  db.tickets.state.openByChannelId ||= {};
  db.tickets.state.byUser ||= {};
  db.tickets.state.channels ||= {};
  db.tickets.state.pendingCreates ||= {};

  if (!db.tickets.settings.panel.channelId && db.tickets.settings.panelChannelId) {
    db.tickets.settings.panel.channelId = db.tickets.settings.panelChannelId;
  }
  if (!db.tickets.settings.panel.messageId && db.tickets.settings.panelMessageId) {
    db.tickets.settings.panel.messageId = db.tickets.settings.panelMessageId;
  }
  if (!db.tickets.settings.types.support.categoryId && db.tickets.settings.categoryId) {
    db.tickets.settings.types.support.categoryId = db.tickets.settings.categoryId;
  }
  if (
    Array.isArray(db.tickets.settings.staffRoleIds) &&
    db.tickets.settings.staffRoleIds.length &&
    !db.tickets.settings.types.support.staffRoleIds?.length
  ) {
    db.tickets.settings.types.support.staffRoleIds = [...db.tickets.settings.staffRoleIds];
  }

  for (const [channelId, ownerId] of Object.entries(db.tickets.state.openByChannelId)) {
    if (!db.tickets.state.channels[channelId] && typeof ownerId === "string" && ownerId) {
      db.tickets.state.channels[channelId] = {
        ownerId,
        typeKey: "support",
        createdAt: 0,
        claimedById: null,
        assignedToId: null,
        openMessageId: null,
        lifecycle: "open",
      };
    }
  }
  for (const [userId, channelId] of Object.entries(db.tickets.state.openByUserId)) {
    if (typeof channelId === "string" && channelId) {
      db.tickets.state.byUser[userId] ||= {};
      db.tickets.state.byUser[userId].support ||= channelId;
    }
  }

  db.welcome.settings = { ...DEFAULT_DB.welcome.settings, ...(db.welcome.settings || {}) };
  db.welcome.settings.buttons = { ...DEFAULT_DB.welcome.settings.buttons, ...(db.welcome.settings.buttons || {}) };

  db.kick.streamers ||= [];
  db.twitch.streamers ||= [];
  db.state.kickLastAnnounced ||= {};
  db.state.twitchLastAnnounced ||= {};
  db.state.kickActiveMessages ||= {};
  db.state.twitchActiveMessages ||= {};
  db.state.kickHealth = { ...DEFAULT_DB.state.kickHealth, ...(db.state.kickHealth || {}) };
  db.state.twitchHealth = { ...DEFAULT_DB.state.twitchHealth, ...(db.state.twitchHealth || {}) };
  db.state.lastTickAt ||= 0;
  db.state.lastTickDurationMs ||= 0;

  return db;
}

async function readAndParse(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return mergeDb(JSON.parse(raw));
}

async function loadDb() {
  if (canonicalDb) return canonicalDb;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      canonicalDb = await readAndParse(DB_PATH);
      return canonicalDb;
    } catch (err) {
      if (err?.code !== "ENOENT") {
        const wrapped = new Error(`Failed to load ${DB_PATH}: ${err.message}`);
        wrapped.cause = err;
        throw wrapped;
      }

      await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
      canonicalDb = cloneDefault();
      await saveDb(canonicalDb, { createBackup: false });
      return canonicalDb;
    }
  })();

  try {
    return await loadPromise;
  } finally {
    loadPromise = null;
  }
}

function replaceCanonical(next) {
  if (!canonicalDb) {
    canonicalDb = next;
    return canonicalDb;
  }
  if (canonicalDb === next) return canonicalDb;
  for (const key of Object.keys(canonicalDb)) delete canonicalDb[key];
  Object.assign(canonicalDb, structuredClone(next));
  return canonicalDb;
}

async function writeAtomically(db, { createBackup = true } = {}) {
  await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
  const raw = `${JSON.stringify(db, null, 2)}\n`;
  const tmpPath = `${DB_PATH}.tmp-${process.pid}-${crypto.randomBytes(8).toString("hex")}`;
  let handle;
  try {
    handle = await fs.open(tmpPath, "wx", 0o600);
    await handle.writeFile(raw, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;

    if (createBackup) {
      try {
        await fs.copyFile(DB_PATH, BACKUP_PATH);
        const backup = await readAndParse(BACKUP_PATH);
        if (!backup || typeof backup !== "object") throw new Error("backup verification failed");
      } catch (err) {
        if (err?.code !== "ENOENT") throw err;
      }
    }

    await fs.rename(tmpPath, DB_PATH);
  } catch (err) {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
}

function startWriter() {
  if (writerPromise) return writerPromise;

  writerPromise = (async () => {
    while (pendingSnapshot) {
      const snapshot = pendingSnapshot;
      const createBackup = pendingBackupRequired;
      const deferred = pendingDeferred;

      pendingSnapshot = null;
      pendingBackupRequired = false;
      pendingDeferred = null;

      try {
        await writeAtomically(snapshot, { createBackup });
        lastWriteError = null;
        deferred.resolve();
      } catch (err) {
        lastWriteError = err;
        deferred.reject(err);
      }
    }
  })().finally(() => {
    writerPromise = null;
    if (pendingSnapshot) startWriter();
  });

  return writerPromise;
}

function saveDb(db, options = {}) {
  const target = replaceCanonical(db);
  const snapshot = structuredClone(target);
  const backupRequired = options.createBackup !== false;

  if (pendingSnapshot) {
    pendingSnapshot = snapshot;
    pendingBackupRequired = pendingBackupRequired || backupRequired;
    return pendingDeferred.promise;
  }

  pendingSnapshot = snapshot;
  pendingBackupRequired = backupRequired;
  pendingDeferred = createDeferred();
  const promise = pendingDeferred.promise;
  startWriter();
  return promise;
}

async function flushDb() {
  while (writerPromise) await writerPromise;
  if (lastWriteError) throw lastWriteError;
}

async function restoreBackup() {
  const restored = await readAndParse(BACKUP_PATH);
  replaceCanonical(restored);
  await saveDb(canonicalDb, { createBackup: false });
  return canonicalDb;
}

function setFsForTests(overrides = {}) {
  fs = { ...realFs, ...overrides };
}

function getQueueState() {
  return {
    writerRunning: Boolean(writerPromise),
    hasPendingSnapshot: Boolean(pendingSnapshot),
    hasPendingPromise: Boolean(pendingDeferred),
    lastWriteError: lastWriteError?.message || null,
  };
}

function resetForTests() {
  canonicalDb = null;
  loadPromise = null;
  writerPromise = null;
  pendingSnapshot = null;
  pendingBackupRequired = false;
  pendingDeferred = null;
  lastWriteError = null;
  fs = realFs;
}

module.exports = {
  loadDb,
  saveDb,
  flushDb,
  restoreBackup,
  DB_PATH,
  BACKUP_PATH,
  DEFAULT_DB,
  SCHEMA_VERSION,
  _mergeDb: mergeDb,
  _setFsForTests: setFsForTests,
  _getQueueState: getQueueState,
  _resetForTests: resetForTests,
};
