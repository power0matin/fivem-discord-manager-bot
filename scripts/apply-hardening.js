"use strict";

const fs = require("node:fs");

function patchFile(file, edits) {
  let text = fs.readFileSync(file, "utf8");
  for (const [from, to, label] of edits) {
    if (!text.includes(from)) {
      throw new Error(`${file}: expected patch target not found: ${label}`);
    }
    text = text.replace(from, to);
  }
  fs.writeFileSync(file, text);
}

patchFile("src/modules/welcome/index.js", [
  [
    '  ComponentType,\n} = require("discord.js");',
    '  ComponentType,\n  ChannelType,\n} = require("discord.js");',
    "import ChannelType",
  ],
  [
    '        // Raid detected: kick the user and log\n        await member\n          .kick("Anti-raid: too many recent joins")\n          .catch(() => null);\n\n        // Log to log channel if configured\n        if (s.logChannelId) {\n          const logCh = await ctx.client.channels.fetch(s.logChannelId).catch(() => null);\n          if (logCh && "send" in logCh) {\n            await logCh.send({\n              content: `🚨 **Anti-raid triggered**: <@${member.id}> kicked (${filtered.length} joins in ${ANTI_RAID_WINDOW_MS / 1000}s)`,\n            }).catch(() => null);\n          }\n        }\n        return;',
    '        // Raid detected: only report success after Discord confirms the kick.\n        if (!member.kickable) {\n          console.error(`[Welcome] Anti-raid could not kick ${member.id}: member is not kickable`);\n          return;\n        }\n\n        const kicked = await member\n          .kick("Anti-raid: too many recent joins")\n          .then(() => true)\n          .catch((err) => {\n            console.error(`[Welcome] Anti-raid kick failed for ${member.id}:`, err?.message ?? err);\n            return false;\n          });\n\n        if (!kicked) return;\n\n        if (s.logChannelId) {\n          const logCh = await ctx.client.channels.fetch(s.logChannelId).catch(() => null);\n          if (logCh && "send" in logCh) {\n            await logCh.send({\n              content: `🚨 **Anti-raid triggered**: <@${member.id}> kicked (${filtered.length} joins in ${ANTI_RAID_WINDOW_MS / 1000}s)`,\n            }).catch(() => null);\n          }\n        }\n        return;',
    "anti-raid kick result",
  ],
  [
    '    if (!channel) return;\n    if (channel.type !== 4) return; // GuildVoice',
    '    if (!channel) return;\n    if (channel.type !== ChannelType.GuildVoice) return;',
    "welcome voice channel type",
  ],
]);

patchFile("src/modules/fivem/index.js", [
  [
    '  if (cand > nowMs) return cand;\n  return cand + 24 * 60 * 60 * 1000;',
    '  if (cand > nowMs) return cand;\n  const next = new Date(cand);\n  next.setDate(next.getDate() + 1);\n  return next.getTime();',
    "DST-safe next day",
  ],
  [
    '  if (res.status >= 200 && res.status < 300) {\n    if (isJson && typeof res.data === "object" && res.data != null) {\n      return { ok: true, status: res.status, data: res.data };\n    }\n    return { ok: true, status: res.status, data: res.data };\n  }',
    '  if (res.status >= 200 && res.status < 300) {\n    if (isJson && typeof res.data === "object" && res.data != null) {\n      return { ok: true, status: res.status, data: res.data };\n    }\n    return {\n      ok: false,\n      status: res.status,\n      data: res.data,\n      error: "Expected a JSON object from FiveM endpoint",\n    };\n  }',
    "reject non-json 2xx",
  ],
  [
    '    // Check if there\'s already an upcoming event\n    const guild = await ctx.client.guilds.fetch(s.statusGuildId || s.statusChannelId).catch(() => null);\n    if (!guild) return;',
    '    // Resolve the guild from the configured status channel; a channel ID is not a guild ID.\n    if (!s.statusChannelId) return;\n    const statusChannel = await ctx.client.channels.fetch(s.statusChannelId).catch(() => null);\n    const guild = statusChannel?.guild || null;\n    if (!guild) return;',
    "scheduled event guild resolution",
  ],
  [
    '    const title = s.title || "FiveM Server";\n    await guild.scheduledEvents\n      .create({',
    '    const title = s.title || "FiveM Server";\n    const createdEvent = await guild.scheduledEvents\n      .create({',
    "capture scheduled event result",
  ],
  [
    '      })\n      .catch(() => null);\n\n    st.lastRestartEventAt = now;\n    await ctx.persistDb().catch(() => null);',
    '      })\n      .catch((err) => {\n        console.error("[FiveM] Failed to create scheduled restart event:", err?.message ?? err);\n        return null;\n      });\n\n    if (!createdEvent) return;\n    st.lastRestartEventAt = now;\n    await ctx.persistDb();',
    "scheduled event persistence",
  ],
]);

patchFile("src/modules/tickets/index.js", [
  [
    '  await channel.permissionOverwrites.set(overwrites).catch(() => null);\n}',
    '  await channel.permissionOverwrites.set(overwrites);\n  return true;\n}',
    "ticket overwrite failure propagation",
  ],
  [
    '  const channel = await interaction.guild.channels\n    .create({\n      name,\n      type: ChannelType.GuildText,\n      parent: category.id,\n      reason: `Ticket created by ${interaction.user.tag} (${typeKey})`,\n    })\n    .catch(() => null);',
    '  const me = interaction.guild.members.me;\n  if (\n    !me?.permissions?.has(PermissionsBitField.Flags.ManageChannels) ||\n    !me?.permissions?.has(PermissionsBitField.Flags.ManageRoles)\n  ) {\n    await safeReply(interaction, {\n      ephemeral: true,\n      content: "❌ Bot needs Manage Channels and Manage Roles to create private tickets safely.",\n    });\n    return;\n  }\n\n  const channel = await interaction.guild.channels\n    .create({\n      name,\n      type: ChannelType.GuildText,\n      parent: category.id,\n      permissionOverwrites: [\n        { id: interaction.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },\n        { id: userId, allow: [PermissionsBitField.Flags.ViewChannel] },\n        { id: ctx.client.user.id, allow: [PermissionsBitField.Flags.ViewChannel] },\n      ],\n      reason: `Ticket created by ${interaction.user.tag} (${typeKey})`,\n    })\n    .catch((err) => {\n      console.error("[Tickets] Failed to create private ticket channel:", err?.message ?? err);\n      return null;\n    });',
    "atomic ticket privacy",
  ],
  [
    '  await ensureTicketPerms(\n    ctx,\n    interaction.guild,\n    channel,\n    userId,\n    staffRoleIds\n  );',
    '  try {\n    await ensureTicketPerms(\n      ctx,\n      interaction.guild,\n      channel,\n      userId,\n      staffRoleIds\n    );\n  } catch (err) {\n    console.error("[Tickets] Failed to apply private ticket permissions:", err?.message ?? err);\n    await channel.delete("Ticket privacy setup failed").catch(() => null);\n    await safeReply(interaction, {\n      ephemeral: true,\n      content: "❌ Ticket privacy setup failed; the temporary channel was removed.",\n    });\n    return;\n  }',
    "ticket privacy rollback",
  ],
  [
    '    openMessageId: null,\n  };',
    '    openMessageId: null,\n    lifecycle: "open",\n  };',
    "ticket lifecycle state",
  ],
  [
    '  // Remove mappings\n  const ownerId = meta.ownerId;\n  const typeKey = meta.typeKey;\n\n  delete t.state.channels[channelId];\n\n  if (t.state.byUser?.[ownerId]?.[typeKey] === channelId) {\n    delete t.state.byUser[ownerId][typeKey];\n  }\n\n  // legacy mirrors best-effort\n  delete t.state.openByChannelId[channelId];\n  if (t.state.openByUserId[ownerId] === channelId)\n    delete t.state.openByUserId[ownerId];\n\n  await ctx.persistDb().catch(() => null);',
    '  const ownerId = meta.ownerId;\n  const typeKey = meta.typeKey;\n\n  // Persist the closing state first. Mappings are kept until Discord confirms deletion.\n  meta.lifecycle = "closing";\n  meta.closingAt = Date.now();\n  await ctx.persistDb();',
    "ticket close phase one",
  ],
  [
    '  // Final message and delete channel\n  await interaction.channel\n    .send("🔒 Ticket closed. This channel will be deleted.")\n    .catch(() => null);\n  setTimeout(() => {\n    interaction.channel\n      .delete(`Ticket closed by ${interaction.user.tag}`)\n      .catch(() => null);\n  }, 1500);\n}',
    '  // Final message and delete channel. Remove persistent mappings only after deletion succeeds.\n  await interaction.channel\n    .send("🔒 Ticket closed. This channel will be deleted.")\n    .catch(() => null);\n  await new Promise((resolve) => setTimeout(resolve, 1500));\n  const deleted = await interaction.channel\n    .delete(`Ticket closed by ${interaction.user.tag}`)\n    .then(() => true)\n    .catch((err) => {\n      console.error("[Tickets] Channel deletion failed:", err?.message ?? err);\n      return false;\n    });\n\n  if (!deleted) {\n    meta.lifecycle = "open";\n    delete meta.closingAt;\n    await ctx.persistDb();\n    return;\n  }\n\n  delete t.state.channels[channelId];\n  if (t.state.byUser?.[ownerId]?.[typeKey] === channelId) {\n    delete t.state.byUser[ownerId][typeKey];\n  }\n  delete t.state.openByChannelId[channelId];\n  if (t.state.openByUserId[ownerId] === channelId) {\n    delete t.state.openByUserId[ownerId];\n  }\n  await ctx.persistDb();\n}',
    "ticket close phase two",
  ],
  [
    '  await ownerMember.voice\n    .setChannel(targetVoiceId, "Ticket voice move")\n    .catch(async () => {\n      await safeReply(interaction, {\n        ephemeral: true,\n        content:\n          "❌ Failed to move user. Check bot permissions (Move Members) and role hierarchy.",\n      });\n    });\n\n  await safeReply(interaction, {',
    '  const moved = await ownerMember.voice\n    .setChannel(targetVoiceId, "Ticket voice move")\n    .then(() => true)\n    .catch(async () => {\n      await safeReply(interaction, {\n        ephemeral: true,\n        content:\n          "❌ Failed to move user. Check bot permissions (Move Members) and role hierarchy.",\n      });\n      return false;\n    });\n\n  if (!moved) return;\n\n  await safeReply(interaction, {',
    "voice move false success",
  ],
]);

patchFile("src/modules/stream-notifier/index.js", [
  [
    '      // Needed to reliably fetch members for role add/remove\n      GatewayIntentBits.GuildMembers,',
    '      // Needed to reliably fetch members for role add/remove and online stats.\n      GatewayIntentBits.GuildMembers,\n      GatewayIntentBits.GuildPresences,',
    "presence intent",
  ],
  [
    '  process.on("unhandledRejection", (reason) => {\n    console.error("[UnhandledRejection]", reason);\n  });\n\n  process.on("uncaughtException", (err) => {\n    console.error("[UncaughtException]", err);\n  });\n\n',
    '',
    "remove duplicate non-fatal process handlers",
  ],
  [
    'main().catch((err) => {\n  // Keep process alive for transient network conditions.\n  console.error("[Fatal]", err);\n});',
    'main().catch((err) => {\n  console.error("[Fatal]", err);\n  process.exitCode = 1;\n});',
    "fatal startup exit code",
  ],
]);

for (const file of [
  "src/modules/fivem/index.js",
  "src/modules/tickets/index.js",
  "src/modules/welcome/index.js",
]) {
  let text = fs.readFileSync(file, "utf8");
  text = text.replaceAll("await ctx.persistDb().catch(() => null);", "await ctx.persistDb();");
  fs.writeFileSync(file, text);
}

let stream = fs.readFileSync("src/modules/stream-notifier/index.js", "utf8");
stream = stream.replaceAll("await saveDb(db).catch(() => null);", "await saveDb(db);");
fs.writeFileSync("src/modules/stream-notifier/index.js", stream);

let setup = fs.readFileSync("src/modules/stream-notifier/slash/setup.js", "utf8");
setup = setup.replaceAll("await saveDb(db).catch(() => null);", "await saveDb(db);");
fs.writeFileSync("src/modules/stream-notifier/slash/setup.js", setup);

console.log("Hardening patches applied successfully.");
