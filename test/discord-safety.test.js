"use strict";

process.env.DISCORD_TOKEN ||= "test-token";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ChannelType, PermissionsBitField } = require("discord.js");
const tickets = require("../src/modules/tickets")._test;
const welcome = require("../src/modules/welcome")._test;
const fivem = require("../src/modules/fivem")._test;

function makeTicketFixture({ manageChannels = true, manageRoles = true, staffRoleIds = [], hierarchy = 1 } = {}) {
  const replies = [];
  const db = {
    tickets: {
      settings: {
        enabled: true,
        maxOpenPerUser: 1,
        ticketNamePrefix: "ticket",
        types: {
          support: {
            label: "Support",
            categoryId: "category-1",
            staffRoleIds,
            introMessage: "hello",
          },
        },
      },
      state: { byUser: {}, channels: {}, openByUserId: {}, openByChannelId: {} },
    },
  };
  const created = [];
  const channel = {
    id: "ticket-channel-1",
    permissionOverwrites: { set: async () => true },
    delete: async () => true,
  };
  const permissions = new Set();
  if (manageChannels) permissions.add(PermissionsBitField.Flags.ManageChannels);
  if (manageRoles) permissions.add(PermissionsBitField.Flags.ManageRoles);
  const roleCache = new Map(staffRoleIds.map((id) => [id, { id }]));
  const guild = {
    roles: { everyone: { id: "everyone" }, cache: roleCache },
    members: {
      me: {
        permissions: { has: (flag) => permissions.has(flag) },
        roles: { highest: { comparePositionTo: () => hierarchy } },
      },
    },
    channels: {
      fetch: async () => ({ id: "category-1", type: ChannelType.GuildCategory }),
      create: async (payload) => {
        created.push(payload);
        return channel;
      },
    },
  };
  const interaction = {
    guild,
    user: {
      id: "user-1",
      username: "user",
      tag: "user#0001",
      toString: () => "<@user-1>",
    },
    reply: async (payload) => { replies.push(payload); return payload; },
    followUp: async (payload) => { replies.push(payload); return payload; },
    deferred: false,
    replied: false,
  };
  const ctx = {
    client: { user: { id: "bot-1" } },
    getDb: () => db,
    persistDb: async () => undefined,
    makeEmbed: () => ({}),
  };
  return { db, replies, created, channel, guild, interaction, ctx };
}

function hasSuccessReply(replies) {
  return replies.some((reply) => String(reply?.content || "").includes("✅ Ticket created"));
}

test("ticket creation refuses missing Manage Channels before channel creation", async () => {
  const f = makeTicketFixture({ manageChannels: false });
  await tickets.createTicket(f.ctx, f.interaction, "support");
  assert.equal(f.created.length, 0);
  assert.equal(hasSuccessReply(f.replies), false);
  assert.equal(Object.keys(f.db.tickets.state.channels).length, 0);
});

test("ticket creation refuses missing Manage Roles before channel creation", async () => {
  const f = makeTicketFixture({ manageRoles: false });
  await tickets.createTicket(f.ctx, f.interaction, "support");
  assert.equal(f.created.length, 0);
  assert.equal(hasSuccessReply(f.replies), false);
});

test("ticket creation refuses staff roles above the bot hierarchy", async () => {
  const f = makeTicketFixture({ staffRoleIds: ["staff-high"], hierarchy: 0 });
  await tickets.createTicket(f.ctx, f.interaction, "support");
  assert.equal(f.created.length, 0);
  assert.equal(hasSuccessReply(f.replies), false);
  assert.match(String(f.replies.at(-1)?.content), /above configured staff role/i);
});

test("private deny overwrite is present atomically when Discord creates a ticket channel", async () => {
  const f = makeTicketFixture();
  f.channel.permissionOverwrites.set = async () => { throw new Error("role hierarchy changed"); };
  await tickets.createTicket(f.ctx, f.interaction, "support");
  assert.equal(f.created.length, 1);
  const everyone = f.created[0].permissionOverwrites.find((entry) => entry.id === "everyone");
  assert.ok(everyone);
  assert.ok(everyone.deny.includes(PermissionsBitField.Flags.ViewChannel));
  assert.equal(hasSuccessReply(f.replies), false);
  assert.equal(Object.keys(f.db.tickets.state.channels).length, 0);
});

test("channel creation rejection produces no state and no false success", async () => {
  const f = makeTicketFixture();
  f.guild.channels.create = async () => { throw new Error("Discord rejected create"); };
  await tickets.createTicket(f.ctx, f.interaction, "support");
  assert.equal(Object.keys(f.db.tickets.state.channels).length, 0);
  assert.equal(hasSuccessReply(f.replies), false);
});

test("overwrite failure deletes the incomplete channel before reporting failure", async () => {
  const f = makeTicketFixture();
  let deleted = false;
  f.channel.permissionOverwrites.set = async () => { throw new Error("overwrite rejected"); };
  f.channel.delete = async () => { deleted = true; return true; };
  await tickets.createTicket(f.ctx, f.interaction, "support");
  assert.equal(deleted, true);
  assert.equal(Object.keys(f.db.tickets.state.channels).length, 0);
  assert.equal(hasSuccessReply(f.replies), false);
});

test("cleanup failure quarantines the private channel for restart recovery", async () => {
  const f = makeTicketFixture();
  f.channel.permissionOverwrites.set = async () => { throw new Error("overwrite rejected"); };
  f.channel.delete = async () => { throw new Error("delete rejected"); };
  let persisted = 0;
  f.ctx.persistDb = async () => { persisted += 1; };
  await tickets.createTicket(f.ctx, f.interaction, "support");
  assert.equal(f.db.tickets.state.channels[f.channel.id].lifecycle, "recovery_required");
  assert.equal(f.db.tickets.state.byUser["user-1"].support, f.channel.id);
  assert.equal(persisted, 1);
  assert.equal(hasSuccessReply(f.replies), false);
});

test("persistence failure after private creation removes channel and in-memory mappings", async () => {
  const f = makeTicketFixture();
  let deleted = false;
  f.channel.delete = async () => { deleted = true; return true; };
  f.ctx.persistDb = async () => { throw new Error("disk full"); };
  await tickets.createTicket(f.ctx, f.interaction, "support");
  assert.equal(deleted, true);
  assert.equal(f.db.tickets.state.channels[f.channel.id], undefined);
  assert.equal(f.db.tickets.state.byUser["user-1"], undefined);
  assert.equal(hasSuccessReply(f.replies), false);
});

test("persistence plus cleanup failure retains a quarantined managed mapping", async () => {
  const f = makeTicketFixture();
  let persistCalls = 0;
  f.ctx.persistDb = async () => {
    persistCalls += 1;
    if (persistCalls === 1) throw new Error("initial persistence failed");
  };
  f.channel.delete = async () => { throw new Error("cleanup failed"); };
  await tickets.createTicket(f.ctx, f.interaction, "support");
  assert.equal(persistCalls, 2);
  assert.equal(f.db.tickets.state.channels[f.channel.id].lifecycle, "recovery_required");
  assert.equal(hasSuccessReply(f.replies), false);
});

test("ticket reconciliation deterministically reopens closing tickets when the Discord channel still exists", async () => {
  for (const phase of ["closing-before-transcript", "closing-after-transcript", "closing-after-log"]) {
    const state = {
      byUser: { owner: { support: "channel" } },
      channels: { channel: { ownerId: "owner", typeKey: "support", lifecycle: "closing", phase, closingAt: 1 } },
      openByUserId: { owner: "channel" },
      openByChannelId: { channel: "owner" },
    };
    let persisted = 0;
    const ctx = {
      getDb: () => ({ tickets: { state } }),
      client: { channels: { fetch: async () => ({ id: "channel" }) } },
      persistDb: async () => { persisted += 1; },
    };
    await tickets.reconcileTicketState(ctx);
    assert.equal(state.channels.channel.lifecycle, "open", phase);
    assert.equal(state.channels.channel.closingAt, undefined, phase);
    assert.equal(state.byUser.owner.support, "channel", phase);
    assert.equal(persisted, 1, phase);
  }
});

test("ticket reconciliation removes mappings after a channel was already deleted", async () => {
  const state = {
    byUser: { owner: { support: "channel" } },
    channels: { channel: { ownerId: "owner", typeKey: "support", lifecycle: "closing", closingAt: 1 } },
    openByUserId: { owner: "channel" },
    openByChannelId: { channel: "owner" },
  };
  const ctx = {
    getDb: () => ({ tickets: { state } }),
    client: { channels: { fetch: async () => { throw new Error("unknown channel"); } } },
    persistDb: async () => undefined,
  };
  await tickets.reconcileTicketState(ctx);
  assert.equal(state.channels.channel, undefined);
  assert.equal(state.byUser.owner, undefined);
  assert.equal(state.openByUserId.owner, undefined);
  assert.equal(state.openByChannelId.channel, undefined);
});

test("recovery-required channel is deleted on startup before mappings are cleared", async () => {
  let deleted = false;
  const state = {
    byUser: { owner: { support: "channel" } },
    channels: { channel: { ownerId: "owner", typeKey: "support", lifecycle: "recovery_required" } },
    openByUserId: { owner: "channel" },
    openByChannelId: { channel: "owner" },
  };
  const ctx = {
    getDb: () => ({ tickets: { state } }),
    client: { channels: { fetch: async () => ({ id: "channel", delete: async () => { deleted = true; } }) } },
    persistDb: async () => undefined,
  };
  await tickets.reconcileTicketState(ctx);
  assert.equal(deleted, true);
  assert.equal(state.channels.channel, undefined);
});

test("anti-raid never reports a successful kick when member is not kickable or API rejects", async () => {
  let kickCalls = 0;
  assert.equal(await welcome.kickMemberForAntiRaid({ id: "u", kickable: false, kick: async () => { kickCalls += 1; } }), false);
  assert.equal(kickCalls, 0);
  assert.equal(
    await welcome.kickMemberForAntiRaid({ id: "u", kickable: true, kick: async () => { throw new Error("Missing Kick Members"); } }),
    false
  );
  assert.equal(
    await welcome.kickMemberForAntiRaid({ id: "u", kickable: true, kick: async () => { kickCalls += 1; } }),
    true
  );
});

function nextRestartTimeString() {
  const d = new Date(Date.now() + 90_000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function makeFiveMEventFixture() {
  const db = {
    fivem: {
      settings: {
        enableScheduledEvents: true,
        restartTimes: [nextRestartTimeString()],
        statusChannelId: "status-channel",
        title: "Test Server",
        baseUrl: "http://127.0.0.1:30120",
      },
      state: {},
    },
  };
  let createCalls = 0;
  const guild = {
    scheduledEvents: {
      fetch: async () => ({ find: () => undefined }),
      create: async () => { createCalls += 1; return { id: "event" }; },
    },
  };
  const ctx = {
    getDb: () => db,
    client: { channels: { fetch: async () => ({ id: "status-channel", guild }) } },
    persistDb: async () => undefined,
  };
  return { db, guild, ctx, get createCalls() { return createCalls; } };
}

test("scheduled event does nothing for missing or invalid status channel", async () => {
  const f = makeFiveMEventFixture();
  f.db.fivem.settings.statusChannelId = null;
  await fivem.createRestartEvent(f.ctx);
  assert.equal(f.createCalls, 0);
  assert.equal(f.db.fivem.state.lastRestartEventAt, undefined);

  f.db.fivem.settings.statusChannelId = "missing";
  f.ctx.client.channels.fetch = async () => { throw new Error("missing"); };
  await fivem.createRestartEvent(f.ctx);
  assert.equal(f.createCalls, 0);
  assert.equal(f.db.fivem.state.lastRestartEventAt, undefined);
});

test("scheduled event rejection never records a success timestamp", async () => {
  const f = makeFiveMEventFixture();
  f.guild.scheduledEvents.create = async () => { throw new Error("Manage Events missing"); };
  await fivem.createRestartEvent(f.ctx);
  assert.equal(f.db.fivem.state.lastRestartEventAt, undefined);
});

test("scheduled event records timestamp only after create and persistence succeed", async () => {
  const f = makeFiveMEventFixture();
  await fivem.createRestartEvent(f.ctx);
  assert.equal(f.createCalls, 1);
  assert.equal(typeof f.db.fivem.state.lastRestartEventAt, "number");
});

test("scheduled event persistence failure reverts in-memory success timestamp", async () => {
  const f = makeFiveMEventFixture();
  f.ctx.persistDb = async () => { throw new Error("disk failure"); };
  await fivem.createRestartEvent(f.ctx);
  assert.equal(f.createCalls, 1);
  assert.equal(f.db.fivem.state.lastRestartEventAt, undefined);
});
