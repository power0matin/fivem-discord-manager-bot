// src/modules/tickets/index.js
"use strict";

const {
  Events,
  ChannelType,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
  MessageFlagsBitField,
} = require("discord.js");

// --- Custom IDs ---
const CREATE_PREFIX = "tickets:create:"; // tickets:create:<typeKey>
const CLAIM_ID = "tickets:claim";
const CLOSE_ID = "tickets:close";
const CLOSE_CONFIRM_ID = "tickets:close_confirm";
const CLOSE_CANCEL_ID = "tickets:close_cancel";
const MOVE_VOICE_ID = "tickets:move_voice";
const CLOSE_MODAL_ID = "tickets:close_modal";

// Discord API ephemeral flag is 1<<6 (=64). Prefer library constant if available.
const EPHEMERAL_FLAG = MessageFlagsBitField?.Flags?.Ephemeral ?? 1 << 6;

function toFlagsPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;

  if (payload.flags != null) {
    if ("ephemeral" in payload) {
      const { ephemeral: _e, ...rest } = payload;
      return rest;
    }
    return payload;
  }

  if (payload.ephemeral === true) {
    const { ephemeral: _e, ...rest } = payload;
    return { ...rest, flags: EPHEMERAL_FLAG };
  }

  return payload;
}

async function safeReply(interaction, payload) {
  const primary = toFlagsPayload(payload);

  try {
    if (interaction.deferred || interaction.replied)
      return await interaction.followUp(primary);
    return await interaction.reply(primary);
  } catch {
    // fallback: remove flags
    const fallback = { ...(payload || {}) };
    delete fallback.flags;
    try {
      if (interaction.deferred || interaction.replied)
        return await interaction.followUp(fallback);
      return await interaction.reply(fallback);
    } catch {
      return null;
    }
  }
}

function uniq(arr) {
  return Array.from(new Set((arr || []).filter(Boolean)));
}

function hasBotAccess(interaction, config) {
  try {
    const allowed = Array.isArray(config.allowedRoleIds)
      ? config.allowedRoleIds
      : [];
    if (allowed.length === 0) {
      return interaction.memberPermissions?.has?.("ManageGuild") ?? false;
    }
    const roles = interaction.member?.roles?.cache;
    if (!roles) return false;
    return allowed.some((id) => roles.has(id));
  } catch {
    return false;
  }
}

function sanitizeChannelName(input) {
  const s = String(input || "user").toLowerCase();
  return (
    s
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "ticket"
  );
}

function applyVars(tpl, vars) {
  const s = String(tpl || "");
  return s
    .replaceAll("{mention}", vars.mention ?? "@user")
    .replaceAll("{user}", vars.user ?? "user")
    .replaceAll("{type}", vars.type ?? "ticket");
}

function getTicketsDb(ctx) {
  const db = ctx.getDb();
  db.tickets ||= {};
  db.tickets.settings ||= {};
  db.tickets.state ||= {};
  db.tickets.state.byUser ||= {};
  db.tickets.state.channels ||= {};
  return db.tickets;
}

function getType(settings, typeKey) {
  const types = settings.types || {};
  return types[typeKey] || null;
}

function isTicketChannel(ctx, channelId) {
  const t = getTicketsDb(ctx);
  return Boolean(t.state.channels?.[channelId]);
}

function getTicketMeta(ctx, channelId) {
  const t = getTicketsDb(ctx);
  return t.state.channels?.[channelId] || null;
}

async function logToChannel(ctx, payload) {
  const db = ctx.getDb();
  const logId = db.tickets?.settings?.logChannelId;
  if (!logId) return;

  const ch = await ctx.client.channels.fetch(logId).catch(() => null);
  if (!ch || !("send" in ch)) return;

  await ch.send(payload).catch(() => null);
}

function buildPanelComponents(settings) {
  const types = settings.types || {};
  const entries = Object.entries(types)
    .filter(([k, v]) => k && v && v.label)
    .slice(0, 25); // safety

  const perRow = Math.max(
    1,
    Math.min(5, Number(settings.panel?.buttonsPerRow || 2))
  );

  const rows = [];
  let row = new ActionRowBuilder();

  for (const [typeKey, t] of entries) {
    const btn = new ButtonBuilder()
      .setCustomId(`${CREATE_PREFIX}${typeKey}`.slice(0, 100))
      .setLabel(String(t.label).slice(0, 80))
      .setStyle(ButtonStyle.Primary);

    if (t.emoji) btn.setEmoji(String(t.emoji).slice(0, 32));

    if (row.components.length >= perRow) {
      rows.push(row);
      row = new ActionRowBuilder();
    }
    row.addComponents(btn);
  }

  if (row.components.length) rows.push(row);

  return rows.slice(0, 5); // Discord max rows
}

async function createOrUpdatePanel(ctx, channel, overrides) {
  const t = getTicketsDb(ctx);
  const s = t.settings;

  s.panel ||= {};
  if (overrides.title != null) s.panel.title = overrides.title;
  if (overrides.description != null)
    s.panel.description = overrides.description;
  if (overrides.footer != null) s.panel.footer = overrides.footer;
  if (overrides.buttonsPerRow != null)
    s.panel.buttonsPerRow = overrides.buttonsPerRow;

  const title = String(s.panel.title || "Support Center").slice(0, 256);
  const desc = String(s.panel.description || "").slice(0, 3500);
  const footer = String(s.panel.footer || "").slice(0, 2048);

  const embed = ctx.makeEmbed(null, {
    tone: "INFO",
    title,
    description: desc,
    footer: footer ? { text: footer } : undefined,
    fields: [
      {
        name: "Available Categories",
        value:
          Object.entries(s.types || {})
            .map(
              ([k, v]) =>
                `• ${v?.emoji ? `${v.emoji} ` : ""}**${v?.label || k}**`
            )
            .join("\n")
            .slice(0, 1024) || "_No types configured_",
      },
    ],
  });

  const components = buildPanelComponents(s);

  // Edit existing panel if possible
  const panelChannelId = s.panel.channelId;
  const panelMessageId = s.panel.messageId;

  if (
    panelChannelId === channel.id &&
    panelMessageId &&
    "messages" in channel
  ) {
    const msg = await channel.messages.fetch(panelMessageId).catch(() => null);
    if (msg) {
      await msg.edit({ embeds: [embed], components }).catch(() => null);
      return { mode: "edited", messageId: msg.id };
    }
    s.panel.messageId = null;
  }

  const sent = await channel
    .send({ embeds: [embed], components })
    .catch(() => null);
  if (!sent) return { mode: "failed", messageId: null };

  s.panel.channelId = channel.id;
  s.panel.messageId = sent.id;

  // keep legacy mirrors (optional)
  s.panelChannelId = channel.id;
  s.panelMessageId = sent.id;

  await ctx.persistDb().catch(() => null);

  return { mode: "sent", messageId: sent.id };
}

async function ensureTicketPerms(ctx, guild, channel, ownerId, staffRoleIds) {
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionsBitField.Flags.ViewChannel],
    },
    {
      id: ownerId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.AttachFiles,
        PermissionsBitField.Flags.EmbedLinks,
      ],
    },
    {
      id: ctx.client.user.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageChannels,
        PermissionsBitField.Flags.ManageMessages,
      ],
    },
  ];

  for (const rid of uniq(staffRoleIds)) {
    overwrites.push({
      id: rid,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageMessages,
      ],
    });
  }

  await channel.permissionOverwrites.set(overwrites).catch(() => null);
}

function countOpenTicketsForUser(state, userId) {
  const m = state.byUser?.[userId];
  if (!m || typeof m !== "object") return 0;
  return Object.values(m).filter(Boolean).length;
}

async function createTicket(ctx, interaction, typeKey) {
  const t = getTicketsDb(ctx);
  const s = t.settings;
  const st = t.state;

  if (!s.enabled) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "❌ Tickets are disabled.",
    });
    return;
  }
  if (!interaction.guild) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "❌ Tickets only work in a server.",
    });
    return;
  }

  const type = getType(s, typeKey);
  if (!type) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "❌ Unknown ticket category/type.",
    });
    return;
  }

  const categoryId = type.categoryId || null;
  if (!categoryId) {
    await safeReply(interaction, {
      ephemeral: true,
      content: `❌ Category for **${type.label}** is not set. Admin: /tickets type-set-category key:${typeKey} category:<...>`,
    });
    return;
  }

  const maxOpen = Math.max(1, Math.min(10, Number(s.maxOpenPerUser || 1)));
  const userId = interaction.user.id;

  // enforce max open tickets per user
  if (countOpenTicketsForUser(st, userId) >= maxOpen) {
    await safeReply(interaction, {
      ephemeral: true,
      content: `⛔ You already have the maximum number of open tickets (${maxOpen}). Please close existing tickets first.`,
    });
    return;
  }

  // prevent duplicate per same type
  st.byUser[userId] ||= {};
  const existingForType = st.byUser[userId][typeKey];
  if (existingForType) {
    await safeReply(interaction, {
      ephemeral: true,
      content: `⛔ You already have an open **${type.label}** ticket: <#${existingForType}>`,
    });
    return;
  }

  const category = await interaction.guild.channels
    .fetch(categoryId)
    .catch(() => null);
  if (!category || category.type !== ChannelType.GuildCategory) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "❌ Ticket category is invalid/missing.",
    });
    return;
  }

  const basePrefix = sanitizeChannelName(s.ticketNamePrefix || "ticket");
  const userPart = sanitizeChannelName(interaction.user.username || "user");
  const typePart = sanitizeChannelName(typeKey);
  const name = `${basePrefix}-${typePart}-${userPart}`.slice(0, 90);

  const channel = await interaction.guild.channels
    .create({
      name,
      type: ChannelType.GuildText,
      parent: category.id,
      reason: `Ticket created by ${interaction.user.tag} (${typeKey})`,
    })
    .catch(() => null);

  if (!channel) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "❌ Failed to create ticket channel. Check bot permissions.",
    });
    return;
  }

  const staffRoleIds = uniq([
    ...(Array.isArray(type.staffRoleIds) ? type.staffRoleIds : []),

    // legacy fallback
    ...(Array.isArray(s.staffRoleIds) ? s.staffRoleIds : []),
  ]);

  await ensureTicketPerms(
    ctx,
    interaction.guild,
    channel,
    userId,
    staffRoleIds
  );

  // store state
  st.byUser[userId][typeKey] = channel.id;
  st.channels[channel.id] = {
    ownerId: userId,
    typeKey,
    createdAt: Date.now(),
    claimedById: null,
    assignedToId: null,
    openMessageId: null,
  };

  // legacy mirrors
  st.openByUserId[userId] = channel.id;
  st.openByChannelId[channel.id] = userId;

  await ctx.persistDb().catch(() => null);

  // Ticket intro embed
  const intro = applyVars(type.introMessage, {
    mention: `${interaction.user}`,
    user: interaction.user.tag || interaction.user.username,
    type: type.label,
  });

  const embed = ctx.makeEmbed(null, {
    tone: "SUCCESS",
    title: `${type.emoji ? `${type.emoji} ` : ""}${type.label} Ticket`,
    description: [
      intro,
      "",
      `**Owner:** ${interaction.user}`,
      `**Created:** <t:${Math.floor(Date.now() / 1000)}:R>`,
      "",
      "Staff actions: **Claim**, **Assign/Pend**, **Close**.",
    ].join("\n"),
  });

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CLAIM_ID)
      .setLabel("Claim")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(CLOSE_ID)
      .setLabel("Close")
      .setStyle(ButtonStyle.Danger)
  );

  const voiceEnabled = Boolean(
    type.voiceMove?.enabled && type.voiceMove?.targetVoiceChannelId
  );
  const rows = [actionRow];

  if (voiceEnabled) {
    const vr = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(MOVE_VOICE_ID)
        .setLabel(String(type.voiceMove.label || "Move to Voice").slice(0, 80))
        .setStyle(ButtonStyle.Primary)
    );
    if (type.voiceMove.emoji)
      vr.components[0].setEmoji(String(type.voiceMove.emoji).slice(0, 32));
    rows.push(vr);
  }

  const mentionRoles = uniq(
    Array.isArray(type.mentionRoleIds) ? type.mentionRoleIds : []
  );
  const mentionContent = mentionRoles.length
    ? mentionRoles.map((id) => `<@&${id}>`).join(" ")
    : "";

  const msg = await channel
    .send({
      content: mentionContent
        ? `${mentionContent}\n${interaction.user}`
        : `${interaction.user}`,
      embeds: [embed],
      components: rows,
    })
    .catch(() => null);

  if (msg) {
    st.channels[channel.id].openMessageId = msg.id;
    await ctx.persistDb().catch(() => null);
  }

  await safeReply(interaction, {
    ephemeral: true,
    content: `✅ Ticket created: <#${channel.id}>`,
  });

  await logToChannel(ctx, {
    content: `🎫 Ticket created: **${type.label}** by <@${userId}> in <#${channel.id}>`,
  });
}

async function claimTicket(ctx, interaction) {
  if (!interaction.guild || !interaction.channel) return;

  const channelId = interaction.channel.id;
  if (!isTicketChannel(ctx, channelId)) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "❌ This channel is not a managed ticket.",
    });
    return;
  }

  // staff only
  if (!hasBotAccess(interaction, ctx.config)) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "⛔ You are not allowed to claim tickets.",
    });
    return;
  }

  const t = getTicketsDb(ctx);
  const meta = t.state.channels[channelId];

  if (meta.claimedById) {
    await safeReply(interaction, {
      ephemeral: true,
      content: `ℹ️ Already claimed by <@${meta.claimedById}>.`,
    });
    return;
  }

  meta.claimedById = interaction.user.id;
  await ctx.persistDb().catch(() => null);

  // Update channel topic (best-effort)
  try {
    const owner = `<@${meta.ownerId}>`;
    const claimer = `<@${meta.claimedById}>`;
    await interaction.channel
      .setTopic(`Owner: ${owner} | Claimed by: ${claimer}`)
      .catch(() => null);
  } catch {}

  await safeReply(interaction, {
    ephemeral: true,
    content: "✅ Ticket claimed.",
  });

  // Ping configured mention roles (optional)
  const type = getType(t.settings, meta.typeKey) || {};
  const mentionRoles = uniq(
    Array.isArray(type.mentionRoleIds) ? type.mentionRoleIds : []
  );
  const mentionContent = mentionRoles.length
    ? mentionRoles.map((id) => `<@&${id}>`).join(" ")
    : "";

  await interaction.channel
    .send({
      content: mentionContent
        ? `${mentionContent}\n✅ Ticket claimed by ${interaction.user}`
        : `✅ Ticket claimed by ${interaction.user}`,
    })
    .catch(() => null);

  await logToChannel(ctx, {
    content: `🧷 Ticket claimed: <#${channelId}> by <@${interaction.user.id}> (owner: <@${meta.ownerId}>)`,
  });
}

async function assignTicket(ctx, interaction, targetUserId) {
  if (!interaction.guild || !interaction.channel) return;

  const channelId = interaction.channel.id;
  if (!isTicketChannel(ctx, channelId)) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "❌ This channel is not a managed ticket.",
    });
    return;
  }
  if (!hasBotAccess(interaction, ctx.config)) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "⛔ You are not allowed to assign tickets.",
    });
    return;
  }

  const t = getTicketsDb(ctx);
  const meta = t.state.channels[channelId];

  meta.assignedToId = targetUserId || null;
  await ctx.persistDb().catch(() => null);

  if (!targetUserId) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "✅ Assignment cleared.",
    });
    await interaction.channel.send("✅ Assignment cleared.").catch(() => null);
    return;
  }

  await safeReply(interaction, {
    ephemeral: true,
    content: "✅ Ticket assigned.",
  });

  await interaction.channel
    .send(`⏳ Ticket pended/assigned to <@${targetUserId}>`)
    .catch(() => null);

  await logToChannel(ctx, {
    content: `⏳ Ticket assigned: <#${channelId}> to <@${targetUserId}> by <@${interaction.user.id}>`,
  });
}

async function requestClose(ctx, interaction) {
  if (!interaction.guild || !interaction.channel) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "❌ This can only be used in a server channel.",
    });
    return;
  }

  const channelId = interaction.channel.id;
  if (!isTicketChannel(ctx, channelId)) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "❌ This channel is not a managed ticket.",
    });
    return;
  }

  const t = getTicketsDb(ctx);
  const meta = t.state.channels[channelId];
  const db = ctx.getDb();
  const allowUserClose = Boolean(db.tickets?.settings?.allowUserClose);

  const isOwner = meta.ownerId === interaction.user.id;
  const isStaff = hasBotAccess(interaction, ctx.config);

  if (!isStaff && !(allowUserClose && isOwner)) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "⛔ You are not allowed to close this ticket.",
    });
    return;
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CLOSE_CONFIRM_ID)
      .setLabel("Confirm Close")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(CLOSE_CANCEL_ID)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary)
  );

  await safeReply(interaction, {
    ephemeral: true,
    content: "Are you sure you want to close this ticket?",
    components: [row],
  });
}

async function showCloseModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId(CLOSE_MODAL_ID)
    .setTitle("Close Ticket");

  const reason = new TextInputBuilder()
    .setCustomId("reason")
    .setLabel("Close reason (optional)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(800);

  modal.addComponents(new ActionRowBuilder().addComponents(reason));
  await interaction.showModal(modal).catch(() => null);
}

async function buildTranscript(channel, limit = 100) {
  if (!channel || !("messages" in channel)) return null;

  const msgs = await channel.messages.fetch({ limit }).catch(() => null);
  if (!msgs) return null;

  const arr = Array.from(msgs.values()).sort(
    (a, b) => a.createdTimestamp - b.createdTimestamp
  );

  let text = arr
    .map((m) => {
      const ts = new Date(m.createdTimestamp).toISOString();
      const author = m.author?.tag
        ? `${m.author.tag} (${m.author.id})`
        : "unknown";
      const content = (m.cleanContent || "").replaceAll("\n", "\\n");
      return `[${ts}] ${author}: ${content}`;
    })
    .join("\n");

  // keep file reasonably sized
  if (text.length > 1_800_000) text = text.slice(text.length - 1_800_000);

  return new AttachmentBuilder(Buffer.from(text, "utf8"), {
    name: `ticket-${channel.id}.txt`,
  });
}

async function closeTicket(ctx, interaction, reasonText) {
  if (!interaction.guild || !interaction.channel) return;

  const channelId = interaction.channel.id;
  const t = getTicketsDb(ctx);

  const meta = t.state.channels[channelId];
  if (!meta) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "❌ Ticket state not found (already closed?).",
    });
    return;
  }

  const allowUserClose = Boolean(ctx.getDb().tickets?.settings?.allowUserClose);
  const isOwner = meta.ownerId === interaction.user.id;
  const isStaff = hasBotAccess(interaction, ctx.config);

  if (!isStaff && !(allowUserClose && isOwner)) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "⛔ You are not allowed to close this ticket.",
    });
    return;
  }

  // Remove mappings
  const ownerId = meta.ownerId;
  const typeKey = meta.typeKey;

  delete t.state.channels[channelId];

  if (t.state.byUser?.[ownerId]?.[typeKey] === channelId) {
    delete t.state.byUser[ownerId][typeKey];
  }

  // legacy mirrors best-effort
  delete t.state.openByChannelId[channelId];
  if (t.state.openByUserId[ownerId] === channelId)
    delete t.state.openByUserId[ownerId];

  await ctx.persistDb().catch(() => null);

  await safeReply(interaction, {
    ephemeral: true,
    content: "✅ Closing ticket...",
  });

  const type = getType(t.settings, typeKey) || {};
  const transcript = await buildTranscript(interaction.channel, 100).catch(
    () => null
  );

  // Log embed + transcript
  const logEmbed = ctx.makeEmbed(null, {
    tone: "INFO",
    title: "Ticket Closed",
    fields: [
      { name: "Channel", value: `<#${channelId}>`, inline: false },
      { name: "Type", value: `${type?.label || typeKey}`, inline: true },
      { name: "Owner", value: `<@${ownerId}>`, inline: true },
      { name: "Closed By", value: `<@${interaction.user.id}>`, inline: true },
      {
        name: "Claimed By",
        value: meta.claimedById ? `<@${meta.claimedById}>` : "_Not claimed_",
        inline: true,
      },
      {
        name: "Assigned To",
        value: meta.assignedToId ? `<@${meta.assignedToId}>` : "_Not assigned_",
        inline: true,
      },
      {
        name: "Reason",
        value: String(reasonText || "_No reason provided_").slice(0, 1024),
        inline: false,
      },
    ],
  });

  await logToChannel(ctx, {
    embeds: [logEmbed],
    files: transcript ? [transcript] : [],
  });

  // Final message and delete channel
  await interaction.channel
    .send("🔒 Ticket closed. This channel will be deleted.")
    .catch(() => null);
  setTimeout(() => {
    interaction.channel
      .delete(`Ticket closed by ${interaction.user.tag}`)
      .catch(() => null);
  }, 1500);
}

async function moveTicketOwnerToVoice(ctx, interaction) {
  if (!interaction.guild || !interaction.channel) return;

  const channelId = interaction.channel.id;
  if (!isTicketChannel(ctx, channelId)) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "❌ This channel is not a managed ticket.",
    });
    return;
  }

  if (!hasBotAccess(interaction, ctx.config)) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "⛔ You are not allowed to use this action.",
    });
    return;
  }

  const t = getTicketsDb(ctx);
  const meta = t.state.channels[channelId];
  const type = getType(t.settings, meta.typeKey) || {};
  const targetVoiceId = type.voiceMove?.targetVoiceChannelId;

  if (!type.voiceMove?.enabled || !targetVoiceId) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "❌ Voice move is not enabled for this ticket type.",
    });
    return;
  }

  const ownerMember = await interaction.guild.members
    .fetch(meta.ownerId)
    .catch(() => null);
  if (!ownerMember) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "❌ Ticket owner not found in guild.",
    });
    return;
  }

  const vs = ownerMember.voice;
  if (!vs || !vs.channelId) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "ℹ️ Owner is not connected to a voice channel.",
    });
    return;
  }

  await ownerMember.voice
    .setChannel(targetVoiceId, "Ticket voice move")
    .catch(async () => {
      await safeReply(interaction, {
        ephemeral: true,
        content:
          "❌ Failed to move user. Check bot permissions (Move Members) and role hierarchy.",
      });
    });

  await safeReply(interaction, {
    ephemeral: true,
    content: "✅ Move request sent.",
  });
}

async function handleChatCommand(interaction, ctx) {
  const sub = interaction.options.getSubcommand();
  const t = getTicketsDb(ctx);
  const s = t.settings;

  if (sub === "toggle") {
    s.enabled = Boolean(interaction.options.getBoolean("enabled", true));
    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ Tickets are now: **${s.enabled ? "ON" : "OFF"}**`,
    });
    return true;
  }

  if (sub === "set-log-channel") {
    const ch = interaction.options.getChannel("channel", true);
    s.logChannelId = ch.id;
    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ Log channel set to <#${ch.id}>`,
    });
    return true;
  }

  if (sub === "clear-log-channel") {
    s.logChannelId = null;
    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: "✅ Log channel cleared.",
    });
    return true;
  }

  if (sub === "panel") {
    const ch = interaction.options.getChannel("channel", true);
    const title = interaction.options.getString("title", false);
    const description = interaction.options.getString("description", false);
    const footer = interaction.options.getString("footer", false);
    const buttonsPerRow = interaction.options.getInteger(
      "buttons_per_row",
      false
    );

    if (!("send" in ch)) {
      await safeReply(interaction, {
        ephemeral: true,
        content: "❌ Invalid channel type for panel.",
      });
      return true;
    }

    const res = await createOrUpdatePanel(ctx, ch, {
      title,
      description,
      footer,
      buttonsPerRow,
    });
    if (res.mode === "failed") {
      await safeReply(interaction, {
        ephemeral: true,
        content: "❌ Failed to post panel. Check bot permissions.",
      });
      return true;
    }

    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ Panel ${res.mode}. MessageId: \`${res.messageId}\``,
    });
    return true;
  }

  if (sub === "type-add") {
    const key = String(interaction.options.getString("key", true))
      .trim()
      .toLowerCase();
    const label = String(interaction.options.getString("label", true)).trim();
    const category = interaction.options.getChannel("category", true);
    const emoji = interaction.options.getString("emoji", false);

    if (!/^[a-z0-9_-]{2,24}$/.test(key)) {
      await safeReply(interaction, {
        ephemeral: true,
        content: "❌ Invalid key. Use 2..24 chars: a-z 0-9 _ -",
      });
      return true;
    }

    s.types ||= {};
    if (s.types[key]) {
      await safeReply(interaction, {
        ephemeral: true,
        content: "❌ Type key already exists.",
      });
      return true;
    }

    s.types[key] = {
      label: label.slice(0, 80),
      emoji: emoji ? String(emoji).slice(0, 32) : null,
      categoryId: category.id,
      staffRoleIds: [],
      mentionRoleIds: [],
      introMessage:
        "Hello {mention}.\nPlease describe your request with full details.\nIf needed, attach proof/screenshots.",
      voiceMove: {
        enabled: false,
        targetVoiceChannelId: null,
        label: "Move to Staff Voice",
        emoji: "🔊",
      },
    };

    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ Added type: **${label}** (key: \`${key}\`)`,
    });
    return true;
  }

  if (sub === "type-remove") {
    const key = String(interaction.options.getString("key", true))
      .trim()
      .toLowerCase();
    if (!s.types?.[key]) {
      await safeReply(interaction, {
        ephemeral: true,
        content: "❌ Unknown type key.",
      });
      return true;
    }

    delete s.types[key];
    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ Removed type: \`${key}\``,
    });
    return true;
  }

  if (sub === "type-list") {
    const lines = Object.entries(s.types || {}).map(([k, v]) => {
      const cat = v.categoryId ? `<#${v.categoryId}>` : "_no category_";
      return `• \`${k}\` → ${v.emoji ? `${v.emoji} ` : ""}**${
        v.label || k
      }** | ${cat}`;
    });

    const embed = ctx.makeEmbed(null, {
      tone: "INFO",
      title: "Tickets • Types",
      description: lines.length
        ? lines.join("\n").slice(0, 3900)
        : "_No types configured._",
    });

    await safeReply(interaction, { ephemeral: true, embeds: [embed] });
    return true;
  }

  if (sub === "type-set-category") {
    const key = String(interaction.options.getString("key", true))
      .trim()
      .toLowerCase();
    const category = interaction.options.getChannel("category", true);

    if (!s.types?.[key]) {
      await safeReply(interaction, {
        ephemeral: true,
        content: "❌ Unknown type key.",
      });
      return true;
    }

    s.types[key].categoryId = category.id;
    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ Updated category for \`${key}\` to <#${category.id}>`,
    });
    return true;
  }

  if (sub === "type-staff-role") {
    const key = String(interaction.options.getString("key", true))
      .trim()
      .toLowerCase();
    const action = interaction.options.getString("action", true);
    const role = interaction.options.getRole("role", false);

    if (!s.types?.[key]) {
      await safeReply(interaction, {
        ephemeral: true,
        content: "❌ Unknown type key.",
      });
      return true;
    }

    const arr = Array.isArray(s.types[key].staffRoleIds)
      ? s.types[key].staffRoleIds
      : [];
    if (action === "clear") {
      s.types[key].staffRoleIds = [];
    } else {
      if (!role) {
        await safeReply(interaction, {
          ephemeral: true,
          content: "❌ role is required for add/remove.",
        });
        return true;
      }
      if (action === "add") s.types[key].staffRoleIds = uniq([...arr, role.id]);
      if (action === "remove")
        s.types[key].staffRoleIds = uniq(arr.filter((id) => id !== role.id));
    }

    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: "✅ Updated staff roles.",
    });
    return true;
  }

  if (sub === "type-mention-role") {
    const key = String(interaction.options.getString("key", true))
      .trim()
      .toLowerCase();
    const action = interaction.options.getString("action", true);
    const role = interaction.options.getRole("role", false);

    if (!s.types?.[key]) {
      await safeReply(interaction, {
        ephemeral: true,
        content: "❌ Unknown type key.",
      });
      return true;
    }

    const arr = Array.isArray(s.types[key].mentionRoleIds)
      ? s.types[key].mentionRoleIds
      : [];
    if (action === "clear") {
      s.types[key].mentionRoleIds = [];
    } else {
      if (!role) {
        await safeReply(interaction, {
          ephemeral: true,
          content: "❌ role is required for add/remove.",
        });
        return true;
      }
      if (action === "add")
        s.types[key].mentionRoleIds = uniq([...arr, role.id]);
      if (action === "remove")
        s.types[key].mentionRoleIds = uniq(arr.filter((id) => id !== role.id));
    }

    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: "✅ Updated mention roles.",
    });
    return true;
  }

  if (sub === "type-set-voice") {
    const key = String(interaction.options.getString("key", true))
      .trim()
      .toLowerCase();
    const enabled = Boolean(interaction.options.getBoolean("enabled", true));
    const voice = interaction.options.getChannel("voice", false);

    if (!s.types?.[key]) {
      await safeReply(interaction, {
        ephemeral: true,
        content: "❌ Unknown type key.",
      });
      return true;
    }

    s.types[key].voiceMove ||= {
      enabled: false,
      targetVoiceChannelId: null,
      label: "Move to Staff Voice",
      emoji: "🔊",
    };
    s.types[key].voiceMove.enabled = enabled;
    if (voice) s.types[key].voiceMove.targetVoiceChannelId = voice.id;

    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: "✅ Updated voice move settings.",
    });
    return true;
  }

  // workflow (must be used inside ticket channel)
  if (sub === "claim") {
    await claimTicket(ctx, interaction);
    return true;
  }

  if (sub === "assign") {
    const u = interaction.options.getUser("user", true);
    await assignTicket(ctx, interaction, u.id);
    return true;
  }

  if (sub === "unassign") {
    await assignTicket(ctx, interaction, null);
    return true;
  }

  if (sub === "close") {
    const reason = interaction.options.getString("reason", false);
    await closeTicket(ctx, interaction, reason || null);
    return true;
  }

  if (sub === "show") {
    const lines = Object.entries(s.types || {}).map(([k, v]) => {
      const cat = v.categoryId ? `<#${v.categoryId}>` : "_not set_";
      return `• \`${k}\` → ${v.emoji ? `${v.emoji} ` : ""}${
        v.label || k
      } | ${cat}`;
    });

    const embed = ctx.makeEmbed(null, {
      tone: "INFO",
      title: "Tickets • Settings",
      fields: [
        { name: "Enabled", value: String(Boolean(s.enabled)), inline: true },
        {
          name: "Max Open/User",
          value: String(s.maxOpenPerUser ?? 1),
          inline: true,
        },
        {
          name: "Allow User Close",
          value: String(Boolean(s.allowUserClose)),
          inline: true,
        },
        {
          name: "Panel Channel",
          value: s.panel?.channelId ? `<#${s.panel.channelId}>` : "_Not set_",
          inline: false,
        },
        {
          name: "Log Channel",
          value: s.logChannelId ? `<#${s.logChannelId}>` : "_None_",
          inline: false,
        },
        {
          name: "Types",
          value: lines.length ? lines.join("\n").slice(0, 1024) : "_None_",
          inline: false,
        },
      ],
    });

    await safeReply(interaction, { ephemeral: true, embeds: [embed] });
    return true;
  }

  return false;
}

async function handleInteraction(interaction, ctx) {
  // Slash command
  if (
    interaction.isChatInputCommand() &&
    interaction.commandName === "tickets"
  ) {
    if (!hasBotAccess(interaction, ctx.config)) {
      await safeReply(interaction, {
        ephemeral: true,
        content: "⛔ You do not have access to this command.",
      });
      return true;
    }
    return await handleChatCommand(interaction, ctx);
  }

  // Panel / ticket buttons
  if (interaction.isButton()) {
    const id = interaction.customId || "";

    if (id.startsWith(CREATE_PREFIX)) {
      const typeKey = id.slice(CREATE_PREFIX.length).trim().toLowerCase();
      await createTicket(ctx, interaction, typeKey);
      return true;
    }

    if (id === CLAIM_ID) {
      await claimTicket(ctx, interaction);
      return true;
    }

    if (id === MOVE_VOICE_ID) {
      await moveTicketOwnerToVoice(ctx, interaction);
      return true;
    }

    if (id === CLOSE_ID) {
      await requestClose(ctx, interaction);
      return true;
    }

    if (id === CLOSE_CONFIRM_ID) {
      await showCloseModal(interaction);
      return true;
    }

    if (id === CLOSE_CANCEL_ID) {
      await safeReply(interaction, {
        ephemeral: true,
        content: "✅ Cancelled.",
        components: [],
      });
      return true;
    }
  }

  // Close modal
  if (interaction.isModalSubmit() && interaction.customId === CLOSE_MODAL_ID) {
    const reason = interaction.fields.getTextInputValue("reason") || null;
    await closeTicket(ctx, interaction, reason);
    return true;
  }

  return false;
}

function register(ctx) {
  // Optional: "-pend @User" parsing inside ticket channels
  ctx.client.on(Events.MessageCreate, async (message) => {
    try {
      if (!message || message.author?.bot) return;
      if (!message.guild || !message.channel) return;

      const t = getTicketsDb(ctx);
      if (!t.settings.enableTextCommands) return;

      if (!isTicketChannel(ctx, message.channel.id)) return;

      // staff only (based on global allowed roles / manage guild)
      const member = message.member;
      const fakeInteraction = {
        member,
        memberPermissions: member?.permissions,
        guild: message.guild,
      };
      if (!hasBotAccess(fakeInteraction, ctx.config)) return;

      const raw = String(message.content || "").trim();
      if (!raw.toLowerCase().startsWith("-pend")) return;

      const u = message.mentions.users.first();
      if (!u) {
        await message.reply("Usage: `-pend @User`").catch(() => null);
        return;
      }

      // simulate an interaction-like object for reuse
      const pseudo = {
        guild: message.guild,
        channel: message.channel,
        user: message.author,
        deferred: true,
        replied: true,
        followUp: (p) => message.reply(p).catch(() => null),
      };

      await assignTicket(ctx, pseudo, u.id);
    } catch {
      // ignore
    }
  });
}

module.exports = {
  register,
  handleInteraction,
};
