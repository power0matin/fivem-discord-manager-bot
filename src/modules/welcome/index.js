"use strict";

const {
  Events,
  MessageFlagsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ComponentType,
  ChannelType,
} = require("discord.js");

// Discord API ephemeral flag is 1<<6 (=64). Prefer library constant if available.
const EPHEMERAL_FLAG = MessageFlagsBitField?.Flags?.Ephemeral ?? 1 << 6;

// Anti-raid: track recent joins per guild
const recentJoins = new Map(); // guildId -> [{ userId, joinedAt }]
const ANTI_RAID_WINDOW_MS = 60_000; // 1 minute window

function toFlagsPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;

  // If caller already uses flags, keep it (but remove deprecated ephemeral if present)
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

async function safeReply(interaction, payload) {
  // First try: flags-based (newer API style)
  const primary = toFlagsPayload(payload);

  try {
    if (interaction.deferred || interaction.replied)
      return await interaction.followUp(primary);
    return await interaction.reply(primary);
  } catch (err) {
    // Log once (do NOT leak secrets; payload has no secrets here)
    console.error(
      "[Welcome] Interaction reply failed (flags attempt):",
      err?.message ?? err
    );

    // Fallback: deprecated ephemeral boolean (older discord.js behavior)
    const fallback = { ...(payload || {}) };
    delete fallback.flags;

    try {
      if (interaction.deferred || interaction.replied)
        return await interaction.followUp(fallback);
      return await interaction.reply(fallback);
    } catch (err2) {
      console.error(
        "[Welcome] Interaction reply failed (ephemeral fallback):",
        err2?.message ?? err2
      );
      return null;
    }
  }
}

function applyTemplate(tpl, member) {
  const userTag = member.user?.tag || member.user?.username || "user";
  const server = member.guild?.name || "server";

  return (
    String(tpl || "")
      // NOTE: Keep {mention} available for content usage, but avoid using it in embed templates.
      .replaceAll("{mention}", `${member}`)
      .replaceAll("{user}", userTag)
      .replaceAll("{server}", server)
  );
}

// Strip discord mentions from a string (for embed safety).
function stripMentions(text) {
  return String(text || "")
    .replaceAll(/<@!?(\d+)>/g, "@user")
    .replaceAll(/<@&(\d+)>/g, "@role")
    .replaceAll(/<#(\d+)>/g, "#channel")
    .replaceAll(/@everyone/g, "everyone")
    .replaceAll(/@here/g, "here")
    .trim();
}

function buildWelcomeEmbed(ctx, member) {
  const db = ctx.getDb();
  const s = db.welcome?.settings || {};

  const title = String(s.embedTitle || "Welcome!").slice(0, 256);

  // No mention inside embed. We sanitize mentions defensively.
  const rawDesc = applyTemplate(
    s.embedDescriptionTemplate ||
      "Welcome to **{server}**!\nWe are glad to have you.",
    member
  );

  // Make description cleaner: trim + ensure line breaks render well.
  const description = stripMentions(rawDesc)
    .replaceAll("\\n", "\n")
    .slice(0, 4000);

  const avatarUrl =
    member.user?.displayAvatarURL?.({ size: 256, extension: "png" }) ||
    member.user?.displayAvatarURL?.({ size: 256 }) ||
    member.user?.avatarURL?.({ size: 256 }) ||
    null;

  // Important:
  // - use thumbnailUrl (your embed system expects thumbnailUrl, not thumbnail:{url})
  // - chrome:"minimal" removes the author line ("Stream Notifier") for cleaner UX
  const embed = ctx.makeEmbed(null, {
    tone: "SUCCESS",
    chrome: "minimal",
    footerMode: "none",
    title,
    description,
    thumbnailUrl: avatarUrl || undefined,
    imageUrl: s.bannerImageUrl || undefined,

    // Remove ✅ next to title for Welcome
    titleIcon: false,

    // 1) shows "Today at ..." next to footer text even in minimal chrome
    timestamp: "always",

    // 2) optional color override (accepts "#RRGGBB", "RRGGBB", "0xRRGGBB", or number)
    color: s.embedColor,

    footer: { text: `${member.guild?.name || "Server"} • Welcome` },
  });

  return embed;
}

function buildWelcomeButtonsRow(ctx) {
  const db = ctx.getDb();
  const s = db.welcome?.settings || {};
  const b = s.buttons || {};

  const row = new ActionRowBuilder();

  // Button 1
  if (b.button1Url && b.button1Label) {
    row.addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(String(b.button1Label).slice(0, 80))
        .setURL(String(b.button1Url))
    );
  }

  // Button 2
  if (b.button2Url && b.button2Label) {
    row.addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(String(b.button2Label).slice(0, 80))
        .setURL(String(b.button2Url))
    );
  }

  // If no buttons configured, return null (send without components)
  if (row.components.length === 0) return null;

  return row;
}

async function sendWelcome(ctx, member, opts = {}) {
  const db = ctx.getDb();
  const s = db.welcome?.settings;

  const force = Boolean(opts.force);
  if (!s?.enabled && !force) return;

  // Anti-raid: check if too many joins in short time
  if (s.antiRaidEnabled && !force) {
    const guildId = member.guild?.id;
    if (guildId) {
      const now = Date.now();
      if (!recentJoins.has(guildId)) recentJoins.set(guildId, []);

      const joins = recentJoins.get(guildId);
      // Clean old entries
      const filtered = joins.filter((j) => now - j.joinedAt < ANTI_RAID_WINDOW_MS);
      recentJoins.set(guildId, filtered);

      const threshold = s.antiRaidThreshold || 5;
      if (filtered.length >= threshold) {
        // Raid detected: only report success after Discord confirms the kick.
        if (!member.kickable) {
          console.error(`[Welcome] Anti-raid could not kick ${member.id}: member is not kickable`);
          return;
        }

        const kicked = await member
          .kick("Anti-raid: too many recent joins")
          .then(() => true)
          .catch((err) => {
            console.error(`[Welcome] Anti-raid kick failed for ${member.id}:`, err?.message ?? err);
            return false;
          });

        if (!kicked) return;

        if (s.logChannelId) {
          const logCh = await ctx.client.channels.fetch(s.logChannelId).catch(() => null);
          if (logCh && "send" in logCh) {
            await logCh.send({
              content: `🚨 **Anti-raid triggered**: <@${member.id}> kicked (${filtered.length} joins in ${ANTI_RAID_WINDOW_MS / 1000}s)`,
            }).catch(() => null);
          }
        }
        return;
      }

      filtered.push({ userId: member.id, joinedAt: now });
    }
  }

  // Auto-role
  if (s.autoRoleId) {
    try {
      const role = await member.guild.roles
        .fetch(s.autoRoleId)
        .catch(() => null);
      if (role) {
        await member.roles.add(role, "Welcome auto-role").catch((e) => {
          console.error("[Welcome] Failed to add auto-role:", e?.message ?? e);
          return null;
        });
      }
    } catch (_) {}
  }

  // Welcome channel message
  if (s.channelId) {
    const channel = await ctx.client.channels.fetch(s.channelId).catch((e) => {
      console.error(
        "[Welcome] Failed to fetch welcome channel:",
        e?.message ?? e
      );
      return null;
    });

    if (
      channel &&
      (channel.isTextBased?.() || typeof channel.send === "function")
    ) {
      const embed = buildWelcomeEmbed(ctx, member);
      const row = buildWelcomeButtonsRow(ctx);

      // Mention must be outside embed, as spoiler only
      const mentionLine = `||${member}||`;

      const payload = {
        content: mentionLine,
        embeds: [embed],
        components: row ? [row] : [],

        // Security/UX hardening:
        // - allow ping ONLY for the joining member
        // - block roles/everyone by default
        allowedMentions: {
          parse: [],
          users: [member.id],
          roles: [],
          repliedUser: false,
        },
      };

      await channel.send(payload).catch((e) => {
        console.error(
          "[Welcome] Failed to send welcome message:",
          e?.message ?? e
        );
        return null;
      });
    }
  }

  // Optional DM (unchanged)
  if (s.dmEnabled) {
    const dmText = applyTemplate(
      s.dmTemplate || "Welcome to {server}!",
      member
    );
    await member.send({ content: dmText }).catch((e) => {
      console.warn("[Welcome] DM failed (likely closed):", e?.message ?? e);
      return null;
    });
  }
}

async function handleInteraction(interaction, ctx) {
  if (!interaction.isChatInputCommand()) return false;
  if (interaction.commandName !== "welcome") return false;

  if (!hasBotAccess(interaction, ctx.config)) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "⛔ You do not have access to this command.",
    });
    return true;
  }

  const db = ctx.getDb();

  // Backward-compatible init (prevents crashes on older data.json)
  db.welcome ||= {};
  db.welcome.settings ||= {};
  db.welcome.settings.buttons ||= {};

  const s = db.welcome.settings;
  const sub = interaction.options.getSubcommand();

  if (sub === "toggle") {
    const enabled = interaction.options.getBoolean("enabled", true);
    s.enabled = Boolean(enabled);
    await ctx.persistDb();
    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ Welcome is now: **${s.enabled ? "ON" : "OFF"}**`,
    });
    return true;
  }

  if (sub === "set-channel") {
    const ch = interaction.options.getChannel("channel", true);
    s.channelId = ch.id;
    await ctx.persistDb();
    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ Welcome channel set to <#${ch.id}>`,
    });
    return true;
  }

  if (sub === "set-title") {
    const title = interaction.options.getString("title", true);
    s.embedTitle = String(title).slice(0, 256);
    await ctx.persistDb();
    await safeReply(interaction, {
      ephemeral: true,
      content: "✅ Welcome embed title updated.",
    });
    return true;
  }

  if (sub === "set-message") {
    const tpl = interaction.options.getString("template", true);
    s.embedDescriptionTemplate = String(tpl).slice(0, 1900);
    await ctx.persistDb();
    await safeReply(interaction, {
      ephemeral: true,
      content:
        "✅ Welcome embed message updated. Placeholders: {user}, {server} (mentions stripped).",
    });
    return true;
  }

  if (sub === "set-buttons") {
    const label1 = interaction.options.getString("label1", true);
    const url1 = interaction.options.getString("url1", true);
    const label2 = interaction.options.getString("label2", true);
    const url2 = interaction.options.getString("url2", true);

    s.buttons ||= {};
    s.buttons.button1Label = String(label1).slice(0, 80);
    s.buttons.button1Url = String(url1).slice(0, 2048);
    s.buttons.button2Label = String(label2).slice(0, 80);
    s.buttons.button2Url = String(url2).slice(0, 2048);

    await ctx.persistDb();
    await safeReply(interaction, {
      ephemeral: true,
      content: "✅ Welcome buttons updated.",
    });
    return true;
  }

  if (sub === "set-color") {
    const clear = interaction.options.getBoolean("clear", false) || false;
    const color = interaction.options.getString("color", false);

    if (clear) {
      s.embedColor = null;
      await ctx.persistDb();
      await safeReply(interaction, {
        ephemeral: true,
        content: "✅ Welcome embed color cleared (theme default).",
      });
      return true;
    }

    if (!color) {
      await safeReply(interaction, {
        ephemeral: true,
        content: "❌ Provide a color like #57F287 or set clear=true.",
      });
      return true;
    }

    const raw = String(color).trim();
    const cleaned = raw.replace(/^#/g, "").replace(/^0x/i, "").trim();

    if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) {
      await safeReply(interaction, {
        ephemeral: true,
        content: "❌ Invalid color. Use #RRGGBB (example: #57F287).",
      });
      return true;
    }

    s.embedColor = `#${cleaned.toUpperCase()}`;
    await ctx.persistDb();
    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ Welcome embed color set to \`${s.embedColor}\`.`,
    });
    return true;
  }

  if (sub === "set-banner") {
    const clear = interaction.options.getBoolean("clear", false) || false;
    const url = interaction.options.getString("url", false);

    if (clear) {
      s.bannerImageUrl = null;
      await ctx.persistDb();
      await safeReply(interaction, {
        ephemeral: true,
        content: "✅ Welcome banner image cleared.",
      });
      return true;
    }

    if (!url) {
      await safeReply(interaction, {
        ephemeral: true,
        content: "❌ Provide an image URL or set clear=true.",
      });
      return true;
    }

    const raw = String(url).trim();
    if (!/^https?:\/\/\S+$/i.test(raw)) {
      await safeReply(interaction, {
        ephemeral: true,
        content: "❌ Invalid URL. Must be http(s).",
      });
      return true;
    }

    s.bannerImageUrl = raw;
    await ctx.persistDb();
    await safeReply(interaction, {
      ephemeral: true,
      content: "✅ Welcome banner image updated.",
    });
    return true;
  }

  if (sub === "set-dm") {
    const enabled = interaction.options.getBoolean("enabled", true);
    const tpl = interaction.options.getString("template", false);

    s.dmEnabled = Boolean(enabled);
    if (tpl) s.dmTemplate = String(tpl).slice(0, 1900);

    await ctx.persistDb();
    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ Welcome DM is now: **${s.dmEnabled ? "ON" : "OFF"}**${
        tpl ? " (template updated)" : ""
      }`,
    });
    return true;
  }

  if (sub === "set-role") {
    const clear = interaction.options.getBoolean("clear", false) || false;
    const role = interaction.options.getRole("role", false);

    if (clear) {
      s.autoRoleId = null;
      await ctx.persistDb();
      await safeReply(interaction, {
        ephemeral: true,
        content: "✅ Auto-role cleared.",
      });
      return true;
    }

    if (!role) {
      await safeReply(interaction, {
        ephemeral: true,
        content: "❌ Provide a role or set clear=true.",
      });
      return true;
    }

    s.autoRoleId = role.id;
    await ctx.persistDb();
    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ Auto-role set to <@&${role.id}>`,
    });
    return true;
  }

  if (sub === "test") {
    if (!interaction.member) {
      await safeReply(interaction, {
        ephemeral: true,
        content: "❌ Unable to resolve member.",
      });
      return true;
    }

    await safeReply(interaction, {
      ephemeral: true,
      content: "⏳ Sending test welcome...",
    });

    const member = interaction.member;

    // Force send for test, even if module is disabled (better UX)
    await sendWelcome(ctx, member, { force: true }).catch((e) => {
      console.error("[Welcome] Test send failed:", e?.message ?? e);
      return null;
    });

    const note = s?.enabled
      ? ""
      : " (note: welcome is currently disabled; test forced send)";
    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ Test welcome sent (best-effort)${note}.`,
    });
    return true;
  }

  if (sub === "set-anti-raid") {
    const enabled = interaction.options.getBoolean("enabled", true);
    const threshold = interaction.options.getInteger("threshold", false);

    s.antiRaidEnabled = Boolean(enabled);
    if (threshold) s.antiRaidThreshold = threshold;

    await ctx.persistDb();
    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ Anti-raid is now: **${s.antiRaidEnabled ? "ON" : "OFF"}**${
        threshold ? ` (threshold: ${threshold})` : ""
      }`,
    });
    return true;
  }

  if (sub === "set-goodbye") {
    const enabled = interaction.options.getBoolean("enabled", true);
    const ch = interaction.options.getChannel("channel", false);

    s.goodbyeEnabled = Boolean(enabled);
    if (ch) s.goodbyeChannelId = ch.id;

    await ctx.persistDb();
    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ Goodbye message is now: **${s.goodbyeEnabled ? "ON" : "OFF"}**${
        ch ? ` in <#${ch.id}>` : ""
      }`,
    });
    return true;
  }

  if (sub === "set-goodbye-message") {
    const title = interaction.options.getString("title", false);
    const message = interaction.options.getString("message", false);
    const color = interaction.options.getString("color", false);

    if (title) s.goodbyeTitle = String(title).slice(0, 256);
    if (message) s.goodbyeMessage = String(message).slice(0, 1900);
    if (color) {
      const cleaned = String(color).trim().replace(/^#/g, "").replace(/^0x/i, "");
      if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
        s.goodbyeColor = `#${cleaned.toUpperCase()}`;
      }
    }

    await ctx.persistDb();
    await safeReply(interaction, {
      ephemeral: true,
      content: "✅ Goodbye message updated.",
    });
    return true;
  }

  if (sub === "set-stats") {
    const clear = interaction.options.getBoolean("clear", false) || false;
    const ch = interaction.options.getChannel("channel", false);
    const format = interaction.options.getString("format", false);

    if (clear) {
      s.statsVoiceChannelId = null;
      await ctx.persistDb();
      await safeReply(interaction, {
        ephemeral: true,
        content: "✅ Server stats display disabled.",
      });
      return true;
    }

    if (ch) s.statsVoiceChannelId = ch.id;
    if (format) s.statsFormat = String(format).slice(0, 100);

    await ctx.persistDb();
    await updateServerStats(ctx).catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ Server stats updated.${
        ch ? ` Voice channel: <#${ch.id}>` : ""
      }`,
    });
    return true;
  }

  if (sub === "set-log-channel") {
    const clear = interaction.options.getBoolean("clear", false) || false;
    const ch = interaction.options.getChannel("channel", false);

    if (clear) {
      s.logChannelId = null;
      await ctx.persistDb();
      await safeReply(interaction, {
        ephemeral: true,
        content: "✅ Log channel cleared.",
      });
      return true;
    }

    if (!ch) {
      await safeReply(interaction, {
        ephemeral: true,
        content: "❌ Provide a channel or set clear=true.",
      });
      return true;
    }

    s.logChannelId = ch.id;
    await ctx.persistDb();
    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ Log channel set to <#${ch.id}>`,
    });
    return true;
  }

  if (sub === "show") {
    const b = s.buttons || {};
    const btn1 = b.button1Url
      ? `[${b.button1Label || "Button 1"}](${b.button1Url})`
      : "_Not set_";
    const btn2 = b.button2Url
      ? `[${b.button2Label || "Button 2"}](${b.button2Url})`
      : "_Not set_";

    const embed = ctx.makeEmbed(null, {
      tone: "INFO",
      chrome: "minimal",
      footerMode: "none",
      title: "Welcome • Settings",
      fields: [
        { name: "Enabled", value: String(Boolean(s.enabled)), inline: true },
        {
          name: "Channel",
          value: s.channelId ? `<#${s.channelId}>` : "_Not set_",
          inline: false,
        },
        { name: "DM", value: String(Boolean(s.dmEnabled)), inline: true },
        {
          name: "Auto-role",
          value: s.autoRoleId ? `<@&${s.autoRoleId}>` : "_None_",
          inline: false,
        },
        {
          name: "Embed Title",
          value: s.embedTitle
            ? `\`${String(s.embedTitle).slice(0, 200)}\``
            : "_Not set_",
          inline: false,
        },
        {
          name: "Embed Color",
          value: s.embedColor
            ? `\`${String(s.embedColor)}\``
            : "_Default (theme)_",
          inline: true,
        },
        {
          name: "Embed Message",
          value: s.embedDescriptionTemplate
            ? `\`${String(s.embedDescriptionTemplate).slice(0, 200)}\``
            : "_Not set_",
          inline: false,
        },
        {
          name: "Banner",
          value: s.bannerImageUrl
            ? `[set](${s.bannerImageUrl})`
            : "_None_",
          inline: true,
        },
        {
          name: "Buttons",
          value: `1) ${btn1}\n2) ${btn2}`,
          inline: false,
        },
        {
          name: "Anti-Raid",
          value: s.antiRaidEnabled
            ? `ON (threshold: ${s.antiRaidThreshold || 5})`
            : "OFF",
          inline: true,
        },
        {
          name: "Goodbye",
          value: s.goodbyeEnabled
            ? `ON${s.goodbyeChannelId ? ` in <#${s.goodbyeChannelId}>` : ""}`
            : "OFF",
          inline: true,
        },
        {
          name: "Server Stats",
          value: s.statsVoiceChannelId
            ? `<#${s.statsVoiceChannelId}>`
            : "_None_",
          inline: true,
        },
      ],
    });

    await safeReply(interaction, { ephemeral: true, embeds: [embed] });
    return true;
  }
}

async function updateServerStats(ctx) {
  try {
    const db = ctx.getDb();
    const s = db.welcome?.settings || {};

    if (!s.statsVoiceChannelId) return;

    const guild = ctx.client.guilds.cache.first();
    if (!guild) return;

    const channel = await ctx.client.channels
      .fetch(s.statsVoiceChannelId)
      .catch(() => null);

    if (!channel) return;
    if (channel.type !== ChannelType.GuildVoice) return;

    const totalMembers = guild.memberCount;
    const onlineMembers = guild.members.cache.filter(
      (m) => m.presence?.status !== "offline"
    ).size;

    const format = s.statsFormat || "Members: {total}";
    const name = format
      .replaceAll("{total}", totalMembers)
      .replaceAll("{online}", onlineMembers)
      .slice(0, 100);

    await channel.setName(name).catch(() => null);
  } catch (_) {}
}

function register(ctx) {
  ctx.client.on(Events.GuildMemberAdd, async (member) => {
    await sendWelcome(ctx, member).catch(() => null);
    await updateServerStats(ctx).catch(() => null);
  });

  ctx.client.on(Events.GuildMemberRemove, async (member) => {
    // Goodbye message
    try {
      const db = ctx.getDb();
      const s = db.welcome?.settings || {};

      if (s.goodbyeEnabled && s.goodbyeChannelId) {
        const channel = await ctx.client.channels
          .fetch(s.goodbyeChannelId)
          .catch(() => null);

        if (channel && "send" in channel) {
          const title = s.goodbyeTitle || "Goodbye!";
          const desc = (s.goodbyeMessage || "See you next time, {user}!")
            .replaceAll("{user}", member.user?.tag || "someone")
            .replaceAll("{server}", member.guild?.name || "server");

          const embed = ctx.makeEmbed(null, {
            tone: "WARN",
            chrome: "minimal",
            footerMode: "none",
            titleIcon: false,
            title,
            description: desc.slice(0, 4000),
            color: s.goodbyeColor || null,
            footer: { text: `${member.guild?.name || "Server"} • Goodbye` },
            timestamp: "always",
          });

          await channel.send({ embeds: [embed] }).catch(() => null);
        }
      }
    } catch (_) {}

    await updateServerStats(ctx).catch(() => null);
  });

  // Update stats on ready
  ctx.client.on(Events.ClientReady, async () => {
    await updateServerStats(ctx).catch(() => null);
  });
}

module.exports = {
  register,
  handleInteraction,
};
