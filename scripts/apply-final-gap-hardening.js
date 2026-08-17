"use strict";

const fs = require("node:fs");

function replace(file, from, to, label) {
  let text = fs.readFileSync(file, "utf8");
  if (!text.includes(from)) throw new Error(`${file}: missing patch target: ${label}`);
  text = text.replace(from, to);
  fs.writeFileSync(file, text);
}

// Persistence: bounded coalescing writer + injectable filesystem faults for stress/failure tests.
replace(
  "src/modules/stream-notifier/storage.js",
  'const fs = require("node:fs/promises");',
  'const realFs = require("node:fs/promises");\nlet fs = realFs;',
  "injectable filesystem"
);

replace(
  "src/modules/stream-notifier/storage.js",
  `let canonicalDb = null;
let loadPromise = null;
let writeTail = Promise.resolve();`,
  `let canonicalDb = null;
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
}`,
  "bounded writer state"
);

replace(
  "src/modules/stream-notifier/storage.js",
  `async function saveDb(db, options) {
  const target = replaceCanonical(db);
  const operation = writeTail.then(() => writeAtomically(target, options));
  writeTail = operation.catch(() => {});
  return operation;
}

async function flushDb() {
  await writeTail;
}`,
  `function startWriter() {
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
}`,
  "coalescing writer"
);

replace(
  "src/modules/stream-notifier/storage.js",
  `function resetForTests() {
  canonicalDb = null;
  loadPromise = null;
  writeTail = Promise.resolve();
}`,
  `function setFsForTests(overrides = {}) {
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
}`,
  "storage test hooks"
);

replace(
  "src/modules/stream-notifier/storage.js",
  `  _mergeDb: mergeDb,
  _resetForTests: resetForTests,`,
  `  _mergeDb: mergeDb,
  _setFsForTests: setFsForTests,
  _getQueueState: getQueueState,
  _resetForTests: resetForTests,`,
  "storage exports"
);

// Ticket creation: preflight role hierarchy, track failed cleanup, rollback state on persistence failure.
replace(
  "src/modules/tickets/index.js",
  `} = require("discord.js");

// --- Custom IDs ---`,
  `} = require("discord.js");
const {
  staffRoleIdsForType,
  validateTicketPermissionModel,
  setTicketMappings,
  clearTicketMappings,
  cleanupFailedTicketChannel,
  persistCreatedTicketOrRollback,
  reconcileTicketState,
} = require("./safety");

// --- Custom IDs ---`,
  "ticket safety import"
);

replace(
  "src/modules/tickets/index.js",
  `  const me = interaction.guild.members.me;
  if (
    !me?.permissions?.has(PermissionsBitField.Flags.ManageChannels) ||
    !me?.permissions?.has(PermissionsBitField.Flags.ManageRoles)
  ) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "❌ Bot needs Manage Channels and Manage Roles to create private tickets safely.",
    });
    return;
  }`,
  `  const staffRoleIds = staffRoleIdsForType(s, type);
  const permissionCheck = validateTicketPermissionModel(interaction.guild, staffRoleIds);
  if (!permissionCheck.ok) {
    await safeReply(interaction, {
      ephemeral: true,
      content: \`❌ Cannot create a private ticket safely: \${permissionCheck.reason}\`,
    });
    return;
  }`,
  "ticket permission preflight"
);

replace(
  "src/modules/tickets/index.js",
  `  const staffRoleIds = uniq([
    ...(Array.isArray(type.staffRoleIds) ? type.staffRoleIds : []),

    // legacy fallback
    ...(Array.isArray(s.staffRoleIds) ? s.staffRoleIds : []),
  ]);

  try {`,
  `  try {`,
  "remove duplicate staff role calculation"
);

replace(
  "src/modules/tickets/index.js",
  `  } catch (err) {
    console.error("[Tickets] Failed to apply private ticket permissions:", err?.message ?? err);
    await channel.delete("Ticket privacy setup failed").catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: "❌ Ticket privacy setup failed; the temporary channel was removed.",
    });
    return;
  }

  // store state
  st.byUser[userId][typeKey] = channel.id;
  st.channels[channel.id] = {
    ownerId: userId,
    typeKey,
    createdAt: Date.now(),
    claimedById: null,
    assignedToId: null,
    openMessageId: null,
    lifecycle: "open",
  };

  // legacy mirrors
  st.openByUserId[userId] = channel.id;
  st.openByChannelId[channel.id] = userId;

  await ctx.persistDb();`,
  `  } catch (err) {
    console.error("[Tickets] Failed to apply private ticket permissions:", err?.message ?? err);
    const cleanup = await cleanupFailedTicketChannel(ctx, st, channel, userId, typeKey);
    await safeReply(interaction, {
      ephemeral: true,
      content: cleanup.deleted
        ? "❌ Ticket privacy setup failed; the temporary channel was removed."
        : "❌ Ticket setup failed. The private channel is quarantined for automatic recovery.",
    });
    return;
  }

  const ticketMeta = {
    ownerId: userId,
    typeKey,
    createdAt: Date.now(),
    claimedById: null,
    assignedToId: null,
    openMessageId: null,
    lifecycle: "open",
  };

  const persisted = await persistCreatedTicketOrRollback(
    ctx,
    st,
    channel,
    userId,
    typeKey,
    ticketMeta
  );
  if (!persisted.ok) {
    await safeReply(interaction, {
      ephemeral: true,
      content: persisted.cleaned
        ? "❌ Ticket state could not be saved; the temporary channel was removed."
        : "❌ Ticket state could not be saved. The private channel is quarantined for automatic recovery.",
    });
    return;
  }`,
  "ticket persistence rollback"
);

replace(
  "src/modules/tickets/index.js",
  `  delete t.state.channels[channelId];
  if (t.state.byUser?.[ownerId]?.[typeKey] === channelId) {
    delete t.state.byUser[ownerId][typeKey];
  }
  delete t.state.openByChannelId[channelId];
  if (t.state.openByUserId[ownerId] === channelId) {
    delete t.state.openByUserId[ownerId];
  }
  await ctx.persistDb();`,
  `  clearTicketMappings(t.state, channelId, ownerId, typeKey);
  await ctx.persistDb();`,
  "ticket close mapping cleanup"
);

replace(
  "src/modules/tickets/index.js",
  `function register(ctx) {
  // Reconcile persistent ticket state with Discord after restart/crash.
  ctx.client.on(Events.ClientReady, async () => {
    const t = getTicketsDb(ctx);
    let changed = false;

    for (const [channelId, meta] of Object.entries(t.state.channels || {})) {
      const channel = await ctx.client.channels.fetch(channelId).catch(() => null);
      if (channel) {
        if (meta.lifecycle === "closing") {
          meta.lifecycle = "open";
          delete meta.closingAt;
          changed = true;
        }
        continue;
      }

      const ownerId = meta?.ownerId;
      const typeKey = meta?.typeKey;
      delete t.state.channels[channelId];
      delete t.state.openByChannelId[channelId];
      if (ownerId && t.state.openByUserId?.[ownerId] === channelId) {
        delete t.state.openByUserId[ownerId];
      }
      if (ownerId && typeKey && t.state.byUser?.[ownerId]?.[typeKey] === channelId) {
        delete t.state.byUser[ownerId][typeKey];
      }
      changed = true;
    }

    if (changed) await ctx.persistDb();
  });

  // Optional: "-pend @User" parsing inside ticket channels`,
  `function register(ctx) {
  // Reconcile persistent ticket state with Discord after restart/crash.
  ctx.client.on(Events.ClientReady, async () => {
    try {
      await reconcileTicketState(ctx);
    } catch (err) {
      console.error("[Tickets] Startup reconciliation failed:", err?.message ?? err);
    }
  });

  // Optional: "-pend @User" parsing inside ticket channels`,
  "ticket reconciliation helper"
);

replace(
  "src/modules/tickets/index.js",
  `module.exports = {
  register,
  handleInteraction,
};`,
  `module.exports = {
  register,
  handleInteraction,
  _test: {
    createTicket,
    createTicketUnlocked,
    closeTicket,
    ensureTicketPerms,
    reconcileTicketState,
    validateTicketPermissionModel,
    persistCreatedTicketOrRollback,
    cleanupFailedTicketChannel,
  },
};`,
  "ticket test exports"
);

// Welcome anti-raid: use one directly testable kick policy.
replace(
  "src/modules/welcome/index.js",
  `const ANTI_RAID_WINDOW_MS = 60_000; // 1 minute window

function toFlagsPayload(payload) {`,
  `const ANTI_RAID_WINDOW_MS = 60_000; // 1 minute window

async function kickMemberForAntiRaid(member) {
  if (!member?.kickable) {
    console.error(\`[Welcome] Anti-raid could not kick \${member?.id || "unknown"}: member is not kickable\`);
    return false;
  }
  try {
    await member.kick("Anti-raid: too many recent joins");
    return true;
  } catch (err) {
    console.error(\`[Welcome] Anti-raid kick failed for \${member.id}:\`, err?.message ?? err);
    return false;
  }
}

function toFlagsPayload(payload) {`,
  "anti raid helper"
);

replace(
  "src/modules/welcome/index.js",
  `        // Raid detected: only report success after Discord confirms the kick.
        if (!member.kickable) {
          console.error(\`[Welcome] Anti-raid could not kick \${member.id}: member is not kickable\`);
          return;
        }

        const kicked = await member
          .kick("Anti-raid: too many recent joins")
          .then(() => true)
          .catch((err) => {
            console.error(\`[Welcome] Anti-raid kick failed for \${member.id}:\`, err?.message ?? err);
            return false;
          });

        if (!kicked) return;`,
  `        // Raid detected: only report success after Discord confirms the kick.
        if (!(await kickMemberForAntiRaid(member))) return;`,
  "anti raid usage"
);

replace(
  "src/modules/welcome/index.js",
  `module.exports = {
  register,
  handleInteraction,
};`,
  `module.exports = {
  register,
  handleInteraction,
  _test: {
    kickMemberForAntiRaid,
    sendWelcome,
    updateServerStats,
  },
};`,
  "welcome test exports"
);

// FiveM scheduled event: timestamp is committed only if event creation and persistence both succeed.
replace(
  "src/modules/fivem/index.js",
  `    if (!createdEvent) return;
    st.lastRestartEventAt = now;
    await ctx.persistDb();`,
  `    if (!createdEvent) return;
    const previousRestartEventAt = st.lastRestartEventAt;
    st.lastRestartEventAt = now;
    try {
      await ctx.persistDb();
    } catch (err) {
      st.lastRestartEventAt = previousRestartEventAt;
      console.error("[FiveM] Failed to persist scheduled restart event state:", err?.message ?? err);
      return;
    }`,
  "scheduled event persistence rollback"
);

replace(
  "src/modules/fivem/index.js",
  `module.exports = {
  register,
  handleInteraction,
};`,
  `module.exports = {
  register,
  handleInteraction,
  _test: {
    createRestartEvent,
    computeNextRestartMs,
    getFiveMStatus,
  },
};`,
  "fivem test exports"
);

console.log("Final gap hardening source patch applied.");
