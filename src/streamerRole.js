"use strict";

/**
 * Manage a "live" role for streamers while they are live.
 * This is best-effort: failures should not crash the bot.
 */

const ROLE_CACHE_TTL_MS = 60_000;
const roleCache = new Map(); // key: `${guildId}:${roleId}` -> { role, fetchedAt }

function cacheKey(guildId, roleId) {
  return `${guildId}:${roleId}`;
}

async function resolveRole(guild, roleId) {
  if (!guild || !roleId) return null;

  const key = cacheKey(guild.id, roleId);
  const now = Date.now();

  const cached = roleCache.get(key);
  if (cached?.role && now - cached.fetchedAt < ROLE_CACHE_TTL_MS) {
    return cached.role;
  }

  let role = guild.roles.cache.get(roleId) || null;
  if (!role) role = await guild.roles.fetch(roleId).catch(() => null);

  roleCache.set(key, { role, fetchedAt: now });
  return role;
}

async function resolveMember(guild, userId) {
  if (!guild || !userId) return null;

  let member = guild.members.cache.get(userId) || null;
  if (!member) member = await guild.members.fetch(userId).catch(() => null);

  return member;
}

async function ensureRoleAdded({ guild, userId, roleId, reason }) {
  if (!guild || !userId || !roleId) return false;

  try {
    const role = await resolveRole(guild, roleId);
    if (!role) {
      console.error("[Role] STREAMER_LIVE_ROLE_ID not found in guild:", roleId);
      return false;
    }

    // Discord.js provides a helpful boolean for manageability
    if (!role.editable) {
      console.error(
        "[Role] Role is not editable by the bot (check role hierarchy / Manage Roles):",
        roleId
      );
      return false;
    }

    const member = await resolveMember(guild, userId);
    if (!member) {
      console.error("[Role] Member not found (cannot add live role):", userId);
      return false;
    }

    if (member.roles.cache.has(roleId)) return true;

    await member.roles
      .add(roleId, reason || "Streamer is live")
      .catch((err) => {
        console.error("[Role] Failed to add role:", err?.message ?? err);
        throw err;
      });

    return true;
  } catch {
    return false;
  }
}

async function ensureRoleRemoved({ guild, userId, roleId, reason }) {
  if (!guild || !userId || !roleId) return false;

  try {
    const role = await resolveRole(guild, roleId);
    if (!role) {
      // If role is missing, nothing to remove.
      return true;
    }

    // If not editable, we can't remove it either.
    if (!role.editable) {
      console.error(
        "[Role] Role is not editable by the bot (check role hierarchy / Manage Roles):",
        roleId
      );
      return false;
    }

    const member = await resolveMember(guild, userId);
    if (!member) return true; // user left guild => nothing to remove

    if (!member.roles.cache.has(roleId)) return true;

    await member.roles
      .remove(roleId, reason || "Streamer went offline")
      .catch((err) => {
        console.error("[Role] Failed to remove role:", err?.message ?? err);
        throw err;
      });

    return true;
  } catch {
    return false;
  }
}

module.exports = {
  ensureRoleAdded,
  ensureRoleRemoved,
};
