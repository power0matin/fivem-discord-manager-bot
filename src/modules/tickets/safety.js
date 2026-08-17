"use strict";

const { PermissionsBitField } = require("discord.js");

function uniq(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function staffRoleIdsForType(settings, type) {
  return uniq([
    ...(Array.isArray(type?.staffRoleIds) ? type.staffRoleIds : []),
    ...(Array.isArray(settings?.staffRoleIds) ? settings.staffRoleIds : []),
  ]);
}

function validateTicketPermissionModel(guild, staffRoleIds) {
  const me = guild?.members?.me;
  if (!me?.permissions?.has?.(PermissionsBitField.Flags.ManageChannels)) {
    return { ok: false, reason: "Bot is missing Manage Channels." };
  }
  if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    return { ok: false, reason: "Bot is missing Manage Roles." };
  }

  const highest = me.roles?.highest;
  const cache = guild?.roles?.cache;
  for (const roleId of uniq(staffRoleIds)) {
    const role = cache?.get?.(roleId);
    if (!role) {
      return { ok: false, reason: `Configured staff role is missing: ${roleId}` };
    }
    if (highest?.comparePositionTo && highest.comparePositionTo(role) <= 0) {
      return {
        ok: false,
        reason: `Bot role must be above configured staff role: ${roleId}`,
      };
    }
  }

  return { ok: true, reason: null };
}

function ensureTicketStateShape(state) {
  state.byUser ||= {};
  state.channels ||= {};
  state.openByUserId ||= {};
  state.openByChannelId ||= {};
}

function setTicketMappings(state, channelId, ownerId, typeKey, meta) {
  ensureTicketStateShape(state);
  state.byUser[ownerId] ||= {};
  state.byUser[ownerId][typeKey] = channelId;
  state.channels[channelId] = meta;
  state.openByUserId[ownerId] = channelId;
  state.openByChannelId[channelId] = ownerId;
}

function clearTicketMappings(state, channelId, ownerId, typeKey) {
  ensureTicketStateShape(state);
  delete state.channels[channelId];
  delete state.openByChannelId[channelId];
  if (ownerId && state.openByUserId[ownerId] === channelId) {
    delete state.openByUserId[ownerId];
  }
  if (ownerId && typeKey && state.byUser[ownerId]?.[typeKey] === channelId) {
    delete state.byUser[ownerId][typeKey];
    if (Object.keys(state.byUser[ownerId]).length === 0) delete state.byUser[ownerId];
  }
}

function recoveryMeta(ownerId, typeKey, existing = {}) {
  return {
    ownerId,
    typeKey,
    createdAt: existing.createdAt || Date.now(),
    claimedById: existing.claimedById ?? null,
    assignedToId: existing.assignedToId ?? null,
    openMessageId: existing.openMessageId ?? null,
    lifecycle: "recovery_required",
    recoveryRequiredAt: Date.now(),
  };
}

async function trackRecoveryRequired(ctx, state, channel, ownerId, typeKey, existingMeta) {
  const meta = recoveryMeta(ownerId, typeKey, existingMeta);
  setTicketMappings(state, channel.id, ownerId, typeKey, meta);
  try {
    await ctx.persistDb();
    return { tracked: true, persisted: true };
  } catch (err) {
    console.error(
      `[Tickets] CRITICAL: private recovery channel ${channel.id} could not be persisted:`,
      err?.message ?? err
    );
    return { tracked: true, persisted: false };
  }
}

async function cleanupFailedTicketChannel(ctx, state, channel, ownerId, typeKey, existingMeta) {
  const deleted = await channel
    .delete("Ticket setup did not complete safely")
    .then(() => true)
    .catch((err) => {
      console.error(`[Tickets] Failed to remove incomplete private channel ${channel.id}:`, err?.message ?? err);
      return false;
    });

  if (deleted) {
    clearTicketMappings(state, channel.id, ownerId, typeKey);
    return { deleted: true, recoveryTracked: false };
  }

  const recovery = await trackRecoveryRequired(
    ctx,
    state,
    channel,
    ownerId,
    typeKey,
    existingMeta
  );
  return { deleted: false, recoveryTracked: recovery.tracked, recoveryPersisted: recovery.persisted };
}

async function persistCreatedTicketOrRollback(ctx, state, channel, ownerId, typeKey, meta) {
  setTicketMappings(state, channel.id, ownerId, typeKey, meta);
  try {
    await ctx.persistDb();
    return { ok: true, cleaned: false, recoveryTracked: false };
  } catch (err) {
    console.error(`[Tickets] Failed to persist new ticket ${channel.id}:`, err?.message ?? err);
    clearTicketMappings(state, channel.id, ownerId, typeKey);
    const cleanup = await cleanupFailedTicketChannel(
      ctx,
      state,
      channel,
      ownerId,
      typeKey,
      meta
    );
    return {
      ok: false,
      cleaned: cleanup.deleted,
      recoveryTracked: cleanup.recoveryTracked,
      recoveryPersisted: cleanup.recoveryPersisted,
      error: err,
    };
  }
}

async function reconcileTicketState(ctx) {
  const db = ctx.getDb();
  db.tickets ||= {};
  db.tickets.state ||= {};
  const state = db.tickets.state;
  ensureTicketStateShape(state);
  let changed = false;

  for (const [channelId, meta] of Object.entries(state.channels)) {
    const channel = await ctx.client.channels.fetch(channelId).catch(() => null);
    const ownerId = meta?.ownerId;
    const typeKey = meta?.typeKey;

    if (!channel) {
      clearTicketMappings(state, channelId, ownerId, typeKey);
      changed = true;
      continue;
    }

    if (meta.lifecycle === "recovery_required") {
      const deleted = await channel
        .delete("Recovering incomplete ticket setup after restart")
        .then(() => true)
        .catch((err) => {
          console.error(`[Tickets] Recovery cleanup failed for ${channelId}:`, err?.message ?? err);
          return false;
        });
      if (deleted) {
        clearTicketMappings(state, channelId, ownerId, typeKey);
        changed = true;
      }
      continue;
    }

    if (meta.lifecycle === "closing") {
      meta.lifecycle = "open";
      delete meta.closingAt;
      changed = true;
    }
  }

  if (changed) await ctx.persistDb();
  return { changed };
}

module.exports = {
  staffRoleIdsForType,
  validateTicketPermissionModel,
  setTicketMappings,
  clearTicketMappings,
  cleanupFailedTicketChannel,
  persistCreatedTicketOrRollback,
  reconcileTicketState,
};
