"use strict";

const { flushDb } = require("../modules/stream-notifier/storage");

let shutdownPromise = null;

async function gracefulShutdown(signal, exitCode = 0) {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    try {
      await flushDb();
    } catch (err) {
      console.error(`[Shutdown] persistence flush failed on ${signal}:`, err?.message ?? err);
      exitCode = 1;
    }
    process.exitCode = exitCode;
  })();
  return shutdownPromise;
}

function installProcessGuards() {
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.once(signal, () => {
      gracefulShutdown(signal).finally(() => process.exit(process.exitCode || 0));
    });
  }

  process.prependListener("uncaughtException", (err) => {
    console.error("[Fatal:UncaughtException]", err);
    gracefulShutdown("uncaughtException", 1).finally(() => process.exit(1));
  });
}

function installDiscordGuards() {
  let discord;
  try {
    discord = require("discord.js");
  } catch {
    return;
  }

  const { GuildChannelManager, ChannelType, PermissionsBitField } = discord;
  if (!GuildChannelManager?.prototype?.create) return;
  if (GuildChannelManager.prototype.create.__ticketPrivacyGuard) return;

  const originalCreate = GuildChannelManager.prototype.create;
  async function guardedCreate(options = {}) {
    const isTicket =
      options?.type === ChannelType.GuildText &&
      typeof options?.reason === "string" &&
      options.reason.startsWith("Ticket created by ");

    if (!isTicket) return originalCreate.call(this, options);

    const guild = this.guild;
    const me = guild?.members?.me;
    if (!guild?.roles?.everyone?.id || !me) {
      throw new Error("Cannot verify ticket privacy permissions before channel creation");
    }

    if (!me.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
      throw new Error("Missing ManageChannels permission required for ticket creation");
    }
    if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      throw new Error("Missing ManageRoles permission required for private ticket overwrites");
    }

    const privacyOverwrite = {
      id: guild.roles.everyone.id,
      deny: [PermissionsBitField.Flags.ViewChannel],
    };

    const supplied = Array.isArray(options.permissionOverwrites)
      ? options.permissionOverwrites
      : [];

    return originalCreate.call(this, {
      ...options,
      permissionOverwrites: [privacyOverwrite, ...supplied],
    });
  }
  guardedCreate.__ticketPrivacyGuard = true;
  GuildChannelManager.prototype.create = guardedCreate;
}

function installRuntimeHardening() {
  installProcessGuards();
  installDiscordGuards();
}

module.exports = {
  installRuntimeHardening,
  installProcessGuards,
  installDiscordGuards,
  gracefulShutdown,
};
