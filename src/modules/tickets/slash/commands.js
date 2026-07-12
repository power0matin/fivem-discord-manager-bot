// src/modules/tickets/slash/commands.js
"use strict";

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");

const tickets = new SlashCommandBuilder()
  .setName("tickets")
  .setDescription("Ticket system: panel + multi-type + moderation workflow.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

  // Core
  .addSubcommand((sc) =>
    sc
      .setName("toggle")
      .setDescription("Enable/disable tickets module.")
      .addBooleanOption((o) =>
        o.setName("enabled").setDescription("true=enable").setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("set-log-channel")
      .setDescription("Set log channel for ticket events (optional).")
      .addChannelOption((o) =>
        o
          .setName("channel")
          .setDescription("Text/Announcement channel for logs")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc.setName("clear-log-channel").setDescription("Clear log channel.")
  )

  // Panel
  .addSubcommand((sc) =>
    sc
      .setName("panel")
      .setDescription(
        "Create/update the ticket panel message (professional multi-button panel)."
      )
      .addChannelOption((o) =>
        o
          .setName("channel")
          .setDescription("Where panel should be posted/edited")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true)
      )
      .addStringOption((o) =>
        o.setName("title").setDescription("Panel title").setRequired(false)
      )
      .addStringOption((o) =>
        o
          .setName("description")
          .setDescription("Panel description")
          .setRequired(false)
      )
      .addStringOption((o) =>
        o.setName("footer").setDescription("Panel footer").setRequired(false)
      )
      .addIntegerOption((o) =>
        o
          .setName("buttons_per_row")
          .setDescription("1..5 (default from data.json)")
          .setMinValue(1)
          .setMaxValue(5)
          .setRequired(false)
      )
  )

  // Types (each type => separate category + button)
  .addSubcommand((sc) =>
    sc
      .setName("type-add")
      .setDescription("Add a ticket type (creates a new button on panel).")
      .addStringOption((o) =>
        o
          .setName("key")
          .setDescription("Stable key (e.g. support, report, donate)")
          .setRequired(true)
      )
      .addStringOption((o) =>
        o.setName("label").setDescription("Button label").setRequired(true)
      )
      .addChannelOption((o) =>
        o
          .setName("category")
          .setDescription("Discord category where channels will be created")
          .addChannelTypes(ChannelType.GuildCategory)
          .setRequired(true)
      )
      .addStringOption((o) =>
        o.setName("emoji").setDescription("Optional emoji").setRequired(false)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("type-remove")
      .setDescription("Remove a ticket type (button disappears from panel).")
      .addStringOption((o) =>
        o.setName("key").setDescription("Type key").setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc.setName("type-list").setDescription("List configured ticket types.")
  )
  .addSubcommand((sc) =>
    sc
      .setName("type-set-category")
      .setDescription("Change category for an existing type.")
      .addStringOption((o) =>
        o.setName("key").setDescription("Type key").setRequired(true)
      )
      .addChannelOption((o) =>
        o
          .setName("category")
          .setDescription("New Discord category")
          .addChannelTypes(ChannelType.GuildCategory)
          .setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("type-staff-role")
      .setDescription("Add/remove staff role access for a type.")
      .addStringOption((o) =>
        o.setName("key").setDescription("Type key").setRequired(true)
      )
      .addStringOption((o) =>
        o
          .setName("action")
          .setDescription("add/remove/clear")
          .setRequired(true)
          .addChoices(
            { name: "add", value: "add" },
            { name: "remove", value: "remove" },
            { name: "clear", value: "clear" }
          )
      )
      .addRoleOption((o) =>
        o
          .setName("role")
          .setDescription("Role (required for add/remove)")
          .setRequired(false)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("type-mention-role")
      .setDescription(
        "Add/remove roles to ping when ticket is created/claimed."
      )
      .addStringOption((o) =>
        o.setName("key").setDescription("Type key").setRequired(true)
      )
      .addStringOption((o) =>
        o
          .setName("action")
          .setDescription("add/remove/clear")
          .setRequired(true)
          .addChoices(
            { name: "add", value: "add" },
            { name: "remove", value: "remove" },
            { name: "clear", value: "clear" }
          )
      )
      .addRoleOption((o) =>
        o
          .setName("role")
          .setDescription("Role (required for add/remove)")
          .setRequired(false)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("type-set-voice")
      .setDescription(
        "Enable/disable Move-to-Voice button for a type + set target voice channel."
      )
      .addStringOption((o) =>
        o.setName("key").setDescription("Type key").setRequired(true)
      )
      .addBooleanOption((o) =>
        o
          .setName("enabled")
          .setDescription("Enable voice move action")
          .setRequired(true)
      )
      .addChannelOption((o) =>
        o
          .setName("voice")
          .setDescription("Target voice channel")
          .addChannelTypes(ChannelType.GuildVoice)
          .setRequired(false)
      )
  )

  // Workflow inside ticket
  .addSubcommand((sc) =>
    sc
      .setName("claim")
      .setDescription("Claim current ticket (use inside a ticket channel).")
  )
  .addSubcommand((sc) =>
    sc
      .setName("assign")
      .setDescription(
        "Assign/pend ticket to a staff member (use inside a ticket channel)."
      )
      .addUserOption((o) =>
        o.setName("user").setDescription("Staff member").setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("unassign")
      .setDescription(
        "Clear assignment on current ticket (use inside a ticket channel)."
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("close")
      .setDescription("Close the current ticket (use inside a ticket channel).")
      .addStringOption((o) =>
        o
          .setName("reason")
          .setDescription("Optional close reason")
          .setRequired(false)
      )
  )

  // Show
  .addSubcommand((sc) =>
    sc.setName("show").setDescription("Show current ticket settings (safe).")
  );

module.exports = {
  commands: [tickets.toJSON()],
};
