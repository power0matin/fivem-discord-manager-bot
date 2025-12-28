"use strict";

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");

const fivem = new SlashCommandBuilder()
  .setName("fivem")
  .setDescription("FiveM server status & auto-updater.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

  .addSubcommand((sc) =>
    sc
      .setName("toggle")
      .setDescription("Enable/disable FiveM auto status.")
      .addBooleanOption((o) =>
        o
          .setName("enabled")
          .setDescription("true = enable, false = disable")
          .setRequired(true)
      )
  )

  .addSubcommand((sc) =>
    sc
      .setName("set-endpoint")
      .setDescription("Set server base URL (e.g. http://127.0.0.1:30120).")
      .addStringOption((o) =>
        o
          .setName("url")
          .setDescription("Base URL without trailing slash.")
          .setRequired(true)
      )
  )

  .addSubcommand((sc) =>
    sc
      .setName("set-channel")
      .setDescription("Set the status channel (for auto status message).")
      .addChannelOption((o) =>
        o
          .setName("channel")
          .setDescription("Channel to post/edit the status message in.")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true)
      )
  )

  .addSubcommand((sc) =>
    sc
      .setName("set-interval")
      .setDescription("Set auto update interval (seconds). Recommended: 300.")
      .addIntegerOption((o) =>
        o
          .setName("seconds")
          .setDescription("Min 60. Recommended: 300 (5 minutes).")
          .setMinValue(60)
          .setMaxValue(3600)
          .setRequired(true)
      )
  )

  // UI
  .addSubcommand((sc) =>
    sc
      .setName("set-title")
      .setDescription("Set the card title (e.g. Nox RP v3).")
      .addStringOption((o) =>
        o.setName("title").setDescription("Embed title").setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("set-description")
      .setDescription("Set the short description/tagline under the title.")
      .addStringOption((o) =>
        o
          .setName("text")
          .setDescription("Short tagline/description")
          .setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("set-banner")
      .setDescription("Set/clear banner image URL shown in the embed.")
      .addStringOption((o) =>
        o.setName("url").setDescription("http(s) image URL").setRequired(false)
      )
      .addBooleanOption((o) =>
        o
          .setName("clear")
          .setDescription("true to clear banner")
          .setRequired(false)
      )
  )

  // Buttons/Connect
  .addSubcommand((sc) =>
    sc
      .setName("set-website")
      .setDescription("Set website button (URL + optional label).")
      .addStringOption((o) =>
        o.setName("url").setDescription("http(s) URL").setRequired(true)
      )
      .addStringOption((o) =>
        o.setName("label").setDescription("Button label").setRequired(false)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("set-connect")
      .setDescription("Set connect button (URL + optional label).")
      .addStringOption((o) =>
        o.setName("url").setDescription("http(s) URL").setRequired(true)
      )
      .addStringOption((o) =>
        o.setName("label").setDescription("Button label").setRequired(false)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("set-connect-command")
      .setDescription("Set F8 connect command shown in the card.")
      .addStringOption((o) =>
        o
          .setName("command")
          .setDescription('Example: "connect sv.nox-rp.ir"')
          .setRequired(true)
      )
  )

  // Restart schedule
  .addSubcommand((sc) =>
    sc
      .setName("set-restart-times")
      .setDescription('Set daily restart times (e.g. "04:00,16:00") or clear.')
      .addStringOption((o) =>
        o
          .setName("times")
          .setDescription("Comma-separated HH:MM")
          .setRequired(false)
      )
      .addBooleanOption((o) =>
        o
          .setName("clear")
          .setDescription("true to clear restart times")
          .setRequired(false)
      )
  )

  .addSubcommand((sc) =>
    sc
      .setName("status")
      .setDescription(
        "Fetch and show current FiveM status (and update message if enabled)."
      )
  )
  .addSubcommand((sc) =>
    sc.setName("show").setDescription("Show current FiveM settings (safe).")
  );

module.exports = {
  commands: [fivem.toJSON()],
};
