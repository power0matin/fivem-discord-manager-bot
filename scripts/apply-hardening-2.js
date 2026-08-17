"use strict";

const fs = require("node:fs");

function patch(file, from, to, label) {
  let text = fs.readFileSync(file, "utf8");
  if (!text.includes(from)) throw new Error(`${file}: missing target: ${label}`);
  text = text.replace(from, to);
  fs.writeFileSync(file, text);
}

patch(
  "src/modules/tickets/index.js",
  "async function createTicket(ctx, interaction, typeKey) {",
  "async function createTicketUnlocked(ctx, interaction, typeKey) {",
  "rename ticket creator"
);

patch(
  "src/modules/tickets/index.js",
  "async function claimTicket(ctx, interaction) {",
  `const ticketCreateLocks = new Set();

async function createTicket(ctx, interaction, typeKey) {
  const userId = interaction?.user?.id;
  const key = userId ? \`${"${userId}:${typeKey}"}\` : null;
  if (!key) return createTicketUnlocked(ctx, interaction, typeKey);

  if (ticketCreateLocks.has(key)) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "⏳ A ticket creation request is already in progress for this category.",
    });
    return;
  }

  ticketCreateLocks.add(key);
  try {
    return await createTicketUnlocked(ctx, interaction, typeKey);
  } finally {
    ticketCreateLocks.delete(key);
  }
}

async function claimTicket(ctx, interaction) {`,
  "serialize ticket creation"
);

patch(
  "src/modules/tickets/index.js",
  "function register(ctx) {\n  // Optional: \"-pend @User\" parsing inside ticket channels",
  `function register(ctx) {
  // Reconcile persistent ticket state with Discord after restart/crash.
  ctx.client.on(Events.ClientReady, async () => {
    const t = getTicketsDb(ctx);
    let changed = false;

    for (const [channelId, meta] of Object.entries(t.state.channels || {})) {
      const channel = await ctx.client.channels.fetch(channelId).catch(() => null);
      if (channel) {
        if (meta.lifecycle === "closing") {
          meta.lifecycle = "open";
          delete meta.closingAt;
          changed = true;
        }
        continue;
      }

      const ownerId = meta?.ownerId;
      const typeKey = meta?.typeKey;
      delete t.state.channels[channelId];
      delete t.state.openByChannelId[channelId];
      if (ownerId && t.state.openByUserId?.[ownerId] === channelId) {
        delete t.state.openByUserId[ownerId];
      }
      if (ownerId && typeKey && t.state.byUser?.[ownerId]?.[typeKey] === channelId) {
        delete t.state.byUser[ownerId][typeKey];
      }
      changed = true;
    }

    if (changed) await ctx.persistDb();
  });

  // Optional: "-pend @User" parsing inside ticket channels`,
  "ticket restart reconciliation"
);

patch(
  "src/modules/welcome/index.js",
  `    s.buttons ||= {};
    s.buttons.button1Label = String(label1).slice(0, 80);
    s.buttons.button1Url = String(url1).slice(0, 2048);
    s.buttons.button2Label = String(label2).slice(0, 80);
    s.buttons.button2Url = String(url2).slice(0, 2048);`,
  `    const isHttpUrl = (value) => {
      try {
        const parsed = new URL(String(value));
        return parsed.protocol === "https:" || parsed.protocol === "http:";
      } catch {
        return false;
      }
    };

    if (!isHttpUrl(url1) || !isHttpUrl(url2)) {
      await safeReply(interaction, {
        ephemeral: true,
        content: "❌ Button URLs must use http:// or https://.",
      });
      return true;
    }

    s.buttons ||= {};
    s.buttons.button1Label = String(label1).slice(0, 80);
    s.buttons.button1Url = String(url1).slice(0, 2048);
    s.buttons.button2Label = String(label2).slice(0, 80);
    s.buttons.button2Url = String(url2).slice(0, 2048);`,
  "welcome button URL validation"
);

patch(
  "src/modules/welcome/index.js",
  `    const guild = ctx.client.guilds.cache.first();
    if (!guild) return;

    const channel = await ctx.client.channels
      .fetch(s.statsVoiceChannelId)
      .catch(() => null);

    if (!channel) return;
    if (channel.type !== ChannelType.GuildVoice) return;`,
  `    const channel = await ctx.client.channels
      .fetch(s.statsVoiceChannelId)
      .catch(() => null);

    if (!channel) return;
    if (channel.type !== ChannelType.GuildVoice) return;
    const guild = channel.guild;
    if (!guild) return;`,
  "stats correct guild"
);

patch(
  "src/modules/fivem/index.js",
  `  const online = (dyn.ok || inf.ok || ply.ok) && !blocked;

  return {
    online,`,
  `  const dynamicValid = Boolean(
    dyn.ok &&
      dyn.data &&
      typeof dyn.data === "object" &&
      ("clients" in dyn.data || "sv_maxclients" in dyn.data || "hostname" in dyn.data || "vars" in dyn.data)
  );
  const infoValid = Boolean(
    inf.ok && inf.data && typeof inf.data === "object" && inf.data.vars && typeof inf.data.vars === "object"
  );
  const playersValid = Boolean(ply.ok && Array.isArray(ply.data));
  const online = (dynamicValid || infoValid || playersValid) && !blocked;

  return {
    online,`,
  "validate FiveM response shape"
);

console.log("Second hardening patch set applied.");
