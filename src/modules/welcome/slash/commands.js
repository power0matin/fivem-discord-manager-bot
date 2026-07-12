"use strict";

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");

const welcome = new SlashCommandBuilder()
  .setName("welcome")
  .setDescription(
    "Welcome system: channel message, optional DM, optional auto-role."
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sc) =>
    sc
      .setName("toggle")
      .setDescription("Enable/disable welcome messages.")
      .addBooleanOption((o) =>
        o
          .setName("enabled")
          .setDescription("true = enable, false = disable")
          .setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("set-channel")
      .setDescription("Set welcome channel.")
      .addChannelOption((o) =>
        o
          .setName("channel")
          .setDescription("Channel to send welcome messages to")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("set-title")
      .setDescription("Set welcome embed title.")
      .addStringOption((o) =>
        o.setName("title").setDescription("Embed title").setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("set-message")
      .setDescription("Set welcome embed description template (no mention).")
      .addStringOption((o) =>
        o
          .setName("template")
          .setDescription("Use {user}, {server}. Mentions will be stripped.")
          .setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("set-buttons")
      .setDescription("Configure two link buttons under the welcome embed.")
      .addStringOption((o) =>
        o.setName("label1").setDescription("Button 1 label").setRequired(true)
      )
      .addStringOption((o) =>
        o.setName("url1").setDescription("Button 1 URL").setRequired(true)
      )
      .addStringOption((o) =>
        o.setName("label2").setDescription("Button 2 label").setRequired(true)
      )
      .addStringOption((o) =>
        o.setName("url2").setDescription("Button 2 URL").setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("set-color")
      .setDescription("Set/clear welcome embed color.")
      .addStringOption((o) =>
        o
          .setName("color")
          .setDescription("Hex color: #RRGGBB (example: #57F287)")
          .setRequired(false)
      )
      .addBooleanOption((o) =>
        o
          .setName("clear")
          .setDescription("true to clear custom color and use theme default")
          .setRequired(false)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("set-banner")
      .setDescription("Set/clear welcome embed banner image.")
      .addStringOption((o) =>
        o
          .setName("url")
          .setDescription("http(s) image URL for banner")
          .setRequired(false)
      )
      .addBooleanOption((o) =>
        o
          .setName("clear")
          .setDescription("true to clear banner image")
          .setRequired(false)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("set-dm")
      .setDescription("Enable/disable welcome DM and set template.")
      .addBooleanOption((o) =>
        o
          .setName("enabled")
          .setDescription("Send DM to new members")
          .setRequired(true)
      )
      .addStringOption((o) =>
        o
          .setName("template")
          .setDescription("Optional DM template (use {user}, {server})")
          .setRequired(false)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("set-role")
      .setDescription("Set auto-role for new members (or clear).")
      .addRoleOption((o) =>
        o
          .setName("role")
          .setDescription("Role to assign (optional)")
          .setRequired(false)
      )
      .addBooleanOption((o) =>
        o
          .setName("clear")
          .setDescription("true to clear auto-role")
          .setRequired(false)
      )
  )
  .addSubcommand((sc) =>
    sc.setName("test").setDescription("Send a test welcome message.")
  )
  .addSubcommand((sc) =>
    sc.setName("show").setDescription("Show current welcome settings (safe).")
  )

  // Anti-raid
  .addSubcommand((sc) =>
    sc
      .setName("set-anti-raid")
      .setDescription("Configure anti-raid protection.")
      .addBooleanOption((o) =>
        o
          .setName("enabled")
          .setDescription("Enable/disable anti-raid")
          .setRequired(true)
      )
      .addIntegerOption((o) =>
        o
          .setName("threshold")
          .setDescription("Max joins per 60 seconds before raid alert (default: 5)")
          .setMinValue(2)
          .setMaxValue(50)
          .setRequired(false)
      )
  )

  // Goodbye message
  .addSubcommand((sc) =>
    sc
      .setName("set-goodbye")
      .setDescription("Configure goodbye message when members leave.")
      .addBooleanOption((o) =>
        o
          .setName("enabled")
          .setDescription("Enable/disable goodbye message")
          .setRequired(true)
      )
      .addChannelOption((o) =>
        o
          .setName("channel")
          .setDescription("Channel for goodbye messages")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(false)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("set-goodbye-message")
      .setDescription("Set goodbye embed title and message.")
      .addStringOption((o) =>
        o.setName("title").setDescription("Goodbye embed title").setRequired(false)
      )
      .addStringOption((o) =>
        o
          .setName("message")
          .setDescription("Goodbye message (use {user}, {server})")
          .setRequired(false)
      )
      .addStringOption((o) =>
        o
          .setName("color")
          .setDescription("Hex color: #RRGGBB")
          .setRequired(false)
      )
  )

  // Server stats
  .addSubcommand((sc) =>
    sc
      .setName("set-stats")
      .setDescription("Show member count in a voice channel name.")
      .addChannelOption((o) =>
        o
          .setName("channel")
          .setDescription("Voice channel for stats display")
          .addChannelTypes(ChannelType.GuildVoice)
          .setRequired(false)
      )
      .addStringOption((o) =>
        o
          .setName("format")
          .setDescription("Format: use {total} and {online} (e.g. 'Members: {total}')")
          .setRequired(false)
      )
      .addBooleanOption((o) =>
        o
          .setName("clear")
          .setDescription("true to disable stats display")
          .setRequired(false)
      )
  )

  // Log channel (for anti-raid alerts)
  .addSubcommand((sc) =>
    sc
      .setName("set-log-channel")
      .setDescription("Set log channel for anti-raid alerts.")
      .addChannelOption((o) =>
        o
          .setName("channel")
          .setDescription("Text channel for logs")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(false)
      )
      .addBooleanOption((o) =>
        o
          .setName("clear")
          .setDescription("true to clear log channel")
          .setRequired(false)
      )
  );

module.exports = {
  commands: [welcome.toJSON()],
};
