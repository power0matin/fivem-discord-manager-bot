const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');

const { config } = require('./config');
const { loadDb, saveDb } = require('./storage');
const { KickClient } = require('./kick');
const { TwitchClient } = require('./twitch');

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function normalizeName(s) {
  return String(s ?? '').trim().toLowerCase();
}

function tryCompileRegex(pattern) {
  try {
    return new RegExp(String(pattern), 'i');
  } catch {
    return /nox\s*rp/i;
  }
}

function hasManageGuild(member) {
  try {
    return member.permissions.has(PermissionsBitField.Flags.ManageGuild);
  } catch {
    return false;
  }
}

function formatStreamerLine(i, name, discordId) {
  if (discordId) return `${i}. ${name} ${discordId}`;
  return `${i}. ${name}`;
}

async function sendNotify(client, db, payload) {
  const channelId = db.settings.notifyChannelId;
  if (!channelId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const mentionHere = db.settings.mentionHere;
  const everyonePing = mentionHere ? '@here ' : '';
  const userPing = payload.discordId ? `<@${payload.discordId}> ` : '';

  const msg = `${everyonePing}${userPing}🔴 **${payload.username}** الان لایو شد روی **${payload.platform}**\n` +
    `🎮 **${payload.gameName}**\n` +
    `📝 ${payload.title}\n` +
    `${payload.url}`;

  await channel.send({
    content: msg,
    allowedMentions: {
      parse: [ ...(mentionHere ? ['everyone'] : []), ...(payload.discordId ? ['users'] : []) ]
    }
  }).catch(() => null);
}

async function main() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  });

  const kick = new KickClient({
    clientId: config.kick.clientId,
    clientSecret: config.kick.clientSecret
  });

  const twitch = new TwitchClient({
    clientId: config.twitch.clientId,
    clientSecret: config.twitch.clientSecret
  });

  let db = await loadDb();

  // Sync env config into DB (so you can change without editing data.json)
  db.settings.notifyChannelId = config.notifyChannelId;
  db.settings.mentionHere = config.mentionHere;
  db.settings.keywordRegex = config.keywordRegex;
  db.settings.twitchGta5GameId = config.twitch.gta5GameId;
  db.settings.kickGtaCategoryName = config.kick.gtaCategoryName;
  await saveDb(db);

  const getKeywordRegex = () => tryCompileRegex(db.settings.keywordRegex);

  let tickRunning = false;

  async function checkKick() {
    if (!kick.enabled) return;

    // Lazy-load GTA V category id for Kick
    if (!db.settings.kickGtaCategoryId) {
      try {
        db.settings.kickGtaCategoryId = await kick.findCategoryIdByName(db.settings.kickGtaCategoryName);
        await saveDb(db);
      } catch (err) {
        console.error('[Kick] Failed to resolve GTA category id:', err?.message ?? err);
        return;
      }
    }

    const gtaCategoryId = db.settings.kickGtaCategoryId;
    const keyword = getKeywordRegex();

    const slugs = db.kick.streamers.map(s => normalizeName(s.slug)).filter(Boolean);
    if (slugs.length === 0) return;

    for (const group of chunkArray(slugs, 50)) {
      let channels = [];
      try {
        channels = await kick.getChannelsBySlugs(group);
      } catch (err) {
        console.error('[Kick] API error:', err?.message ?? err);
        continue;
      }

      for (const ch of channels) {
        const slug = normalizeName(ch.slug);
        const isLive = Boolean(ch.stream?.is_live);
        const title = String(ch.stream_title ?? '');
        const categoryId = ch.category?.id ?? null;
        const categoryName = String(ch.category?.name ?? '');
        const startTime = String(ch.stream?.start_time ?? '');

        if (!isLive) continue;
        if (gtaCategoryId && categoryId != gtaCategoryId) continue; // ensure GTA V
        if (!keyword.test(title)) continue; // ensure NOX RP in title

        const sessionKey = startTime && startTime !== '0001-01-01T00:00:00Z' ? startTime : `live:${title}`;
        const prev = db.state.kickLastAnnounced[slug];
        if (prev && prev.sessionKey === sessionKey) continue;

        const streamerMeta = db.kick.streamers.find(s => normalizeName(s.slug) === slug);
        const discordId = streamerMeta?.discordId ?? null;

        const url = `https://kick.com/${slug}`;

        await sendNotify(client, db, {
          platform: 'Kick',
          username: slug,
          discordId,
          title,
          gameName: categoryName || 'Grand Theft Auto V',
          url
        });

        db.state.kickLastAnnounced[slug] = {
          sessionKey,
          announcedAt: Date.now()
        };
        await saveDb(db);
      }
    }
  }

  // Optional: discovery scan (NOT based on your saved list)
  // Kick limitation: API returns up to 100 livestreams (no pagination).
  async function discoverKick() {
    if (!kick.enabled) return;
    if (!config.discoveryMode) return;

    // Ensure GTA category id
    if (!db.settings.kickGtaCategoryId) {
      try {
        db.settings.kickGtaCategoryId = await kick.findCategoryIdByName(db.settings.kickGtaCategoryName);
        await saveDb(db);
      } catch (err) {
        console.error('[Kick][Discover] Failed to resolve GTA category id:', err?.message ?? err);
        return;
      }
    }

    const gtaCategoryId = db.settings.kickGtaCategoryId;
    const keyword = getKeywordRegex();

    let lives = [];
    try {
      lives = await kick.getLivestreamsByCategoryId(gtaCategoryId, Math.min(100, config.discoveryKickLimit || 100), 'started_at');
    } catch (err) {
      console.error('[Kick][Discover] API error:', err?.message ?? err);
      return;
    }

    for (const lv of lives) {
      const slug = normalizeName(lv.slug);
      const title = String(lv.stream_title ?? '');
      const startedAt = String(lv.started_at ?? '');
      const gameName = String(lv.category?.name ?? db.settings.kickGtaCategoryName);
      if (!slug) continue;
      if (!keyword.test(title)) continue;

      const sessionKey = startedAt && startedAt !== '0001-01-01T00:00:00Z' ? startedAt : `live:${title}`;
      const prev = db.state.kickLastAnnounced[slug];
      if (prev && prev.sessionKey === sessionKey) continue;

      const streamerMeta = db.kick.streamers.find(s => normalizeName(s.slug) === slug);
      const discordId = streamerMeta?.discordId ?? null;

      await sendNotify(client, db, {
        platform: 'Kick',
        username: slug,
        discordId,
        title,
        gameName,
        url: `https://kick.com/${slug}`
      });

      db.state.kickLastAnnounced[slug] = { sessionKey, announcedAt: Date.now() };
      await saveDb(db);
    }
  }

  async function checkTwitch() {
    if (!twitch.enabled) return;

    const keyword = getKeywordRegex();
    const gameId = String(db.settings.twitchGta5GameId ?? '32982');

    const logins = db.twitch.streamers.map(s => normalizeName(s.login)).filter(Boolean);
    if (logins.length === 0) return;

    for (const group of chunkArray(logins, 100)) {
      let streams = [];
      try {
        streams = await twitch.getStreamsByUserLogins(group, { gameId });
      } catch (err) {
        console.error('[Twitch] API error:', err?.message ?? err);
        continue;
      }

      for (const st of streams) {
        const login = normalizeName(st.user_login);
        const title = String(st.title ?? '');
        const streamId = String(st.id ?? '');
        const gameName = String(st.game_name ?? 'Grand Theft Auto V');

        if (!streamId) continue;
        if (!keyword.test(title)) continue;

        const prev = db.state.twitchLastAnnounced[login];
        if (prev && prev.sessionKey === streamId) continue;

        const streamerMeta = db.twitch.streamers.find(s => normalizeName(s.login) === login);
        const discordId = streamerMeta?.discordId ?? null;

        const url = `https://twitch.tv/${login}`;

        await sendNotify(client, db, {
          platform: 'Twitch',
          username: login,
          discordId,
          title,
          gameName,
          url
        });

        db.state.twitchLastAnnounced[login] = {
          sessionKey: streamId,
          announcedAt: Date.now()
        };
        await saveDb(db);
      }
    }
  }

  // Optional: discovery scan (NOT based on your saved list)
  async function discoverTwitch() {
    if (!twitch.enabled) return;
    if (!config.discoveryMode) return;

    const keyword = getKeywordRegex();
    const gameId = String(db.settings.twitchGta5GameId ?? '32982');

    let cursor = null;
    const pages = Math.max(1, Math.min(50, config.discoveryTwitchPages || 5));

    for (let page = 0; page < pages; page++) {
      let streams = [];
      try {
        const res = await twitch.getStreamsByGameId(gameId, 100, cursor || undefined);
        streams = res.streams;
        cursor = res.cursor;
      } catch (err) {
        console.error('[Twitch][Discover] API error:', err?.message ?? err);
        return;
      }

      for (const st of streams) {
        const login = normalizeName(st.user_login);
        const title = String(st.title ?? '');
        const streamId = String(st.id ?? '');
        const gameName = String(st.game_name ?? 'Grand Theft Auto V');
        if (!login || !streamId) continue;
        if (!keyword.test(title)) continue;

        const prev = db.state.twitchLastAnnounced[login];
        if (prev && prev.sessionKey === streamId) continue;

        const streamerMeta = db.twitch.streamers.find(s => normalizeName(s.login) === login);
        const discordId = streamerMeta?.discordId ?? null;

        await sendNotify(client, db, {
          platform: 'Twitch',
          username: login,
          discordId,
          title,
          gameName,
          url: `https://twitch.tv/${login}`
        });

        db.state.twitchLastAnnounced[login] = { sessionKey: streamId, announcedAt: Date.now() };
        await saveDb(db);
      }

      if (!cursor) break;
    }
  }

  async function tick() {
    if (tickRunning) return;
    tickRunning = true;
    try {
      await checkKick();
      await checkTwitch();

      // Discovery (optional)
      await discoverKick();
      await discoverTwitch();
    } finally {
      tickRunning = false;
    }
  }

  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.guild) return;

    const prefix = config.prefix;
    if (!message.content.startsWith(prefix)) return;

    const raw = message.content.slice(prefix.length).trim();
    if (!raw) return;

    const [cmd, ...args] = raw.split(/\s+/g);
    const cmdLower = String(cmd).toLowerCase();

    // Helper command
    if (cmdLower === 'help') {
      const helpText = [
        '**Nox RP Bot Commands**',
        `\`${prefix}k list\``,
        `\`${prefix}k add <kickSlug> [@discordUser]\`  (یا: \`${prefix}k <kickSlug> [@user]\`)`,
        `\`${prefix}k remove <kickSlug>\``,
        '',
        `\`${prefix}t list\``,
        `\`${prefix}t add <twitchLogin> [@discordUser]\`  (یا: \`${prefix}t <twitchLogin> [@user]\`)`,
        `\`${prefix}t remove <twitchLogin>\``,
        '',
        `\`${prefix}tick\` (دستی چک کن)`
      ].join('\n');
      await message.reply(helpText);
      return;
    }

    if (cmdLower === 'tick') {
      if (!hasManageGuild(message.member)) {
        await message.reply('❌ | شما دسترسی Manage Server ندارید.');
        return;
      }
      await message.reply('⏳ | در حال چک کردن Kick/Twitch ...');
      await tick();
      await message.channel.send('✅ | چک تموم شد.');
      return;
    }

    // .k ...
    if (cmdLower === 'k') {
      if (!hasManageGuild(message.member)) {
        await message.reply('❌ | شما دسترسی Manage Server ندارید.');
        return;
      }

      const sub = String(args[0] ?? '').toLowerCase();

      if (sub === 'list') {
        if (db.kick.streamers.length === 0) {
          await message.reply('🎥 | Kick Streamers List: (خالیه)');
          return;
        }
        const lines = db.kick.streamers
          .map((s, i) => formatStreamerLine(i + 1, s.slug, s.discordId))
          .join('\n');
        await message.reply(`🎥 | Kick Streamers List:\n${lines}`);
        return;
      }

      if (sub === 'remove') {
        const slug = normalizeName(args[1]);
        if (!slug) {
          await message.reply(`⚠️ | استفاده درست: \`${prefix}k remove <kickSlug>\``);
          return;
        }
        const before = db.kick.streamers.length;
        db.kick.streamers = db.kick.streamers.filter(s => normalizeName(s.slug) !== slug);
        const after = db.kick.streamers.length;
        await saveDb(db);
        if (after === before) {
          await message.reply(`⚠️ | Streamer ${slug} توی لیست Kick نبود.`);
        } else {
          await message.reply(`🗑️ | Streamer ${slug} az Kick list hazf shod.`);
        }
        return;
      }

      // add mode: `.k add <slug> [@user]` OR `.k <slug> [@user]`
      let slug = null;
      let mentionIndex = 1;
      if (sub === 'add') {
        slug = normalizeName(args[1]);
        mentionIndex = 2;
      } else {
        slug = normalizeName(args[0]);
        mentionIndex = 1;
      }

      if (!slug || slug === 'list' || slug === 'remove' || slug === 'add') {
        await message.reply(`⚠️ | استفاده درست: \`${prefix}k add <kickSlug> [@user]\``);
        return;
      }

      const mentionedUser = message.mentions.users.first() ?? null;
      const discordId = mentionedUser?.id ?? null;

      const exists = db.kick.streamers.some(s => normalizeName(s.slug) === slug);
      if (exists) {
        await message.reply(`⚠️ | Streamer ${slug} ghablan dar list Kick vojod dasht.`);
        return;
      }

      db.kick.streamers.push({ slug, discordId });
      await saveDb(db);

      if (discordId) {
        await message.reply(`✅ | Streamer ${slug} be Kick list ezafe shod. (ID: ${discordId})`);
      } else {
        await message.reply(`✅ | Streamer ${slug} be Kick list ezafe shod.`);
      }
      return;
    }

    // .t ...
    if (cmdLower === 't') {
      if (!hasManageGuild(message.member)) {
        await message.reply('❌ | شما دسترسی Manage Server ندارید.');
        return;
      }

      const sub = String(args[0] ?? '').toLowerCase();

      if (sub === 'list') {
        if (db.twitch.streamers.length === 0) {
          await message.reply('🎥 | Twitch Streamers List: (خالیه)');
          return;
        }
        const lines = db.twitch.streamers
          .map((s, i) => formatStreamerLine(i + 1, s.login, s.discordId))
          .join('\n');
        await message.reply(`🎥 | Twitch Streamers List:\n${lines}`);
        return;
      }

      if (sub === 'remove') {
        const login = normalizeName(args[1]);
        if (!login) {
          await message.reply(`⚠️ | استفاده درست: \`${prefix}t remove <twitchLogin>\``);
          return;
        }
        const before = db.twitch.streamers.length;
        db.twitch.streamers = db.twitch.streamers.filter(s => normalizeName(s.login) !== login);
        const after = db.twitch.streamers.length;
        await saveDb(db);
        if (after === before) {
          await message.reply(`⚠️ | Streamer ${login} توی لیست Twitch نبود.`);
        } else {
          await message.reply(`🗑️ | Streamer ${login} az Twitch list hazf shod.`);
        }
        return;
      }

      let login = null;
      if (sub === 'add') {
        login = normalizeName(args[1]);
      } else {
        login = normalizeName(args[0]);
      }

      if (!login || login === 'list' || login === 'remove' || login === 'add') {
        await message.reply(`⚠️ | استفاده درست: \`${prefix}t add <twitchLogin> [@user]\``);
        return;
      }

      const mentionedUser = message.mentions.users.first() ?? null;
      const discordId = mentionedUser?.id ?? null;

      const exists = db.twitch.streamers.some(s => normalizeName(s.login) === login);
      if (exists) {
        await message.reply(`⚠️ | Streamer ${login} ghablan dar list Twitch vojod dasht.`);
        return;
      }

      db.twitch.streamers.push({ login, discordId });
      await saveDb(db);

      if (discordId) {
        await message.reply(`✅ | Streamer ${login} be Twitch list ezafe shod. (ID: ${discordId})`);
      } else {
        await message.reply(`✅ | Streamer ${login} be Twitch list ezafe shod.`);
      }
      return;
    }
  });

  client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    // Start polling
    await tick();
    setInterval(() => tick(), Math.max(10, config.checkIntervalSeconds) * 1000);
  });

  await client.login(config.discordToken);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
