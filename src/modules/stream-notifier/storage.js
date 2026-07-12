const fs = require("node:fs/promises");
const path = require("node:path");

const DB_PATH = path.join(process.cwd(), "data.json");

const DEFAULT_DB = {
  settings: {
    notifyChannelId: null,
    mentionHere: true,
    keywordRegex: "nox\\s*rp",
    checkIntervalSeconds: 60,

    // Discovery settings (optional)
    discoveryMode: false,
    discoveryTwitchPages: 5,
    discoveryKickLimit: 100,

    twitchGta5GameId: "32982",
    kickGtaCategoryName: "Grand Theft Auto V",
    kickGtaCategoryId: null,
    kickGtaCategoryResolvedAt: 0,
  },

  // ---- (backward-compatible) ----
  fivem: {
    settings: {
      enabled: false,

      // Internal API endpoint for FiveM json endpoints (info.json/dynamic.json/players.json)
      baseUrl: "http://178.22.124.71:30120", // e.g. http://127.0.0.1:30120

      // Where to post/edit the single status message
      statusChannelId: null,
      statusMessageId: null, // edited in-place to avoid spam

      // Polling (recommended: every 5 minutes)
      checkIntervalSeconds: 300,
      timeoutMs: 5000,

      // UI/UX (matches your screenshot-style card)
      title: "Nox RP v3.1",
      description:
        "Welcome to Nox RP v3.1 — a next-generation FiveM roleplay experience. Build your story, connect with others, and enjoy a fully customized RP environment!",
      bannerImageUrl:
        "https://cdn.discordapp.com/attachments/1329051555688743043/1433115641900171365/AA1_copy.png?ex=6951f5b3&is=6950a433&hm=1d2edd9107d3229c6114ef62560e99d238a088da2b2d568b46d5a240aec88946&",

      // NEW: manual embed color (hex string). Example: "#ff7300ff" or null for auto tone.
      embedColor: "#ff8383",

      // Connect UX
      connectCommand: "connect sv.nox-rp.ir",
      connectLabel: "Connect",
      // Can be http(s) (Link button) OR fivem:// (custom button + ephemeral instructions)
      connectUrl: "fivem://connect/sv.nox-rp.ir",

      // Website button
      websiteLabel: "Website",
      websiteUrl: "https://nox-rp.ir/",

      // NEW: button emojis (optional)
      websiteEmoji: "🌐",
      connectEmoji: "🎮",

      showPlayers: true,
      maxPlayersShown: 10,

      restartTimes: ["05:00"],

      // Voice channel status (shows server online/offline in channel name)
      voiceStatusChannelId: null,

      // Auto-create Discord Scheduled Events for restarts
      enableScheduledEvents: false,
    },
    state: {
      consecutiveFailures: 0,
      nextAllowedAt: 0,
      lastError: null,
      lastErrorAt: 0,
      lastSuccessAt: 0,
      lastCheckedAt: 0,
      lastOnline: null,

      // For uptime calc (only set on *observed* offline->online)
      wentOnlineAt: 0,
    },
  },

  tickets: {
    settings: {
      enabled: false,

      // --- legacy (keep for backward compatibility) ---
      categoryId: null,
      staffRoleIds: [],
      panelChannelId: null,
      panelMessageId: null,

      // --- current ---
      logChannelId: null,
      ticketNamePrefix: "ticket",
      maxOpenPerUser: 1,
      allowUserClose: true,

      // Enable parsing "-pend @User" inside ticket channels (requires Message Content Intent)
      enableTextCommands: false,

      // Professional panel (stored in data.json)
      panel: {
        channelId: null,
        messageId: null,
        title: "Support Center",
        description:
          "Choose a category below to open a private ticket.\n\n" +
          "Please provide complete details (screenshots, IDs, timestamps) for faster resolution.",
        footer: "Abuse/spam may lead to penalties. One ticket per category.",
        buttonsPerRow: 2, // 1..5
      },

      // Ticket types: each button -> separate Discord category
      // key: stable identifier used in customId and state
      types: {
        support: {
          label: "Support",
          emoji: "🎫",
          categoryId: null,

          // Roles with access to channels (in addition to bot)
          staffRoleIds: [],

          // Roles to ping when ticket created/claimed (outside embed)
          mentionRoleIds: [],

          // Message posted in ticket on creation
          introMessage:
            "Hello {mention}.\n" +
            "Please describe your issue with full details.\n" +
            "If this is a report, include proof (clip/screenshot) and player IDs.",

          // Optional voice move action
          voiceMove: {
            enabled: false,
            targetVoiceChannelId: null,
            label: "Move to Staff Voice",
            emoji: "🔊",
          },
        },
      },
    },

    state: {
      // --- legacy (keep) ---
      openByUserId: {}, // userId -> channelId (old single-ticket mapping)
      openByChannelId: {}, // channelId -> userId (old)

      // --- new state ---
      // userId -> { [typeKey]: channelId }
      byUser: {},

      // channelId -> metadata
      channels: {
        // [channelId]: { ownerId, typeKey, createdAt, claimedById, assignedToId, openMessageId }
      },
    },
  },

  welcome: {
    settings: {
      enabled: false,
      channelId: null,

      // Keep for backward compatibility (older configs might still use it)
      messageTemplate: "Welcome {mention} to **{server}**!",

      // NEW: embed-specific templates (no mention inside embed)
      embedTitle: "NOX Community",
      embedDescriptionTemplate:
        "Welcome to the NOX Community! We are glad to have you.",

      // NEW: link buttons under embed
      buttons: {
        button1Label: "Rules",
        button1Url: null,
        button2Label: "Website",
        button2Url: null,
      },

      dmEnabled: false,
      dmTemplate: "Welcome to {server}!",
      autoRoleId: null,
      bannerImageUrl: null,

      // Anti-raid protection
      antiRaidEnabled: false,
      antiRaidThreshold: 5,

      // Goodbye message
      goodbyeEnabled: false,
      goodbyeChannelId: null,
      goodbyeTitle: "Goodbye!",
      goodbyeMessage: "See you next time, {user}!",
      goodbyeColor: null,

      // Server stats in voice channel
      statsVoiceChannelId: null,
      statsFormat: "Members: {total}",

      // Log channel (for anti-raid alerts)
      logChannelId: null,
    },
  },

  // ---- END NEW MODULES ----

  kick: {
    streamers: [], // { slug, discordId|null }
  },
  twitch: {
    streamers: [], // { login, discordId|null }
  },
  state: {
    // (legacy) kept for backward compatibility if you used it before:
    kickLastAnnounced: {},
    twitchLastAnnounced: {},

    // NEW: persistent message tracking
    // key -> streamer, value -> { messageId, sessionKey, createdAt }
    kickActiveMessages: {},
    twitchActiveMessages: {},

    // Health/backoff state (helps avoid rate-limit hammering)
    kickHealth: {
      consecutiveFailures: 0,
      nextAllowedAt: 0,
      lastError: null,
      lastErrorAt: 0,
      lastSuccessAt: 0,
      lastLoggedAt: 0,
    },
    twitchHealth: {
      consecutiveFailures: 0,
      nextAllowedAt: 0,
      lastError: null,
      lastErrorAt: 0,
      lastSuccessAt: 0,
      lastLoggedAt: 0,
    },

    // Tick metadata
    lastTickAt: 0,
    lastTickDurationMs: 0,
  },
};

async function loadDb() {
  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    const parsed = JSON.parse(raw);

    // Merge defaults (shallow + nested)
    const db = {
      ...DEFAULT_DB,
      ...parsed,
      settings: { ...DEFAULT_DB.settings, ...(parsed.settings ?? {}) },
      fivem: { ...DEFAULT_DB.fivem, ...(parsed.fivem ?? {}) },
      tickets: { ...DEFAULT_DB.tickets, ...(parsed.tickets ?? {}) },
      welcome: { ...DEFAULT_DB.welcome, ...(parsed.welcome ?? {}) },

      kick: { ...DEFAULT_DB.kick, ...(parsed.kick ?? {}) },
      twitch: { ...DEFAULT_DB.twitch, ...(parsed.twitch ?? {}) },
      state: { ...DEFAULT_DB.state, ...(parsed.state ?? {}) },
    };

    // Ensure nested objects exist (in case old db.json is missing these keys)
    db.kick.streamers ||= [];
    db.twitch.streamers ||= [];

    db.fivem ||= structuredClone(DEFAULT_DB.fivem);
    db.fivem.settings = {
      ...DEFAULT_DB.fivem.settings,
      ...(db.fivem.settings ?? {}),
    };
    db.fivem.state = { ...DEFAULT_DB.fivem.state, ...(db.fivem.state ?? {}) };

    db.tickets ||= structuredClone(DEFAULT_DB.tickets);

    // Merge settings (shallow)
    db.tickets.settings = {
      ...DEFAULT_DB.tickets.settings,
      ...(db.tickets.settings ?? {}),
    };

    // Merge nested settings objects
    db.tickets.settings.panel = {
      ...DEFAULT_DB.tickets.settings.panel,
      ...(db.tickets.settings.panel ?? {}),
    };
    db.tickets.settings.types = {
      ...DEFAULT_DB.tickets.settings.types,
      ...(db.tickets.settings.types ?? {}),
    };

    // Ensure legacy arrays exist
    db.tickets.settings.staffRoleIds ||= [];

    // Ensure state
    db.tickets.state = {
      ...DEFAULT_DB.tickets.state,
      ...(db.tickets.state ?? {}),
    };
    db.tickets.state.openByUserId ||= {};
    db.tickets.state.openByChannelId ||= {};
    db.tickets.state.byUser ||= {};
    db.tickets.state.channels ||= {};

    // ---- Migration (legacy -> new) ----

    // Panel legacy -> new
    if (!db.tickets.settings.panel.channelId && db.tickets.settings.panelChannelId) {
      db.tickets.settings.panel.channelId = db.tickets.settings.panelChannelId;
    }
    if (!db.tickets.settings.panel.messageId && db.tickets.settings.panelMessageId) {
      db.tickets.settings.panel.messageId = db.tickets.settings.panelMessageId;
    }

    // Ensure at least one type exists
    db.tickets.settings.types.support ||= structuredClone(
      DEFAULT_DB.tickets.settings.types.support
    );

    // Type support inherits old single-category settings if needed
    const supportType = db.tickets.settings.types.support;
    if (!supportType.categoryId && db.tickets.settings.categoryId) {
      supportType.categoryId = db.tickets.settings.categoryId;
    }
    if (
      Array.isArray(db.tickets.settings.staffRoleIds) &&
      db.tickets.settings.staffRoleIds.length > 0 &&
      (!Array.isArray(supportType.staffRoleIds) || supportType.staffRoleIds.length === 0)
    ) {
      supportType.staffRoleIds = [...db.tickets.settings.staffRoleIds];
    }

    // Legacy openByChannelId -> channels meta
    for (const [chId, ownerId] of Object.entries(db.tickets.state.openByChannelId)) {
      if (!db.tickets.state.channels[chId] && typeof ownerId === "string" && ownerId) {
        db.tickets.state.channels[chId] = {
          ownerId,
          typeKey: "support", 
          createdAt: 0,
          claimedById: null,
          assignedToId: null,
          openMessageId: null,
        };
      }
    }

    // Legacy openByUserId -> byUser
    for (const [userId, chId] of Object.entries(db.tickets.state.openByUserId)) {
      if (typeof chId === "string" && chId) {
        db.tickets.state.byUser[userId] ||= {};
        if (!db.tickets.state.byUser[userId].support) {
          db.tickets.state.byUser[userId].support = chId;
        }
      }
    }

    db.welcome ||= structuredClone(DEFAULT_DB.welcome);
    db.welcome.settings = {
      ...DEFAULT_DB.welcome.settings,
      ...(db.welcome.settings ?? {}),
    };

    // Ensure nested buttons object is merged and always exists
    db.welcome.settings.buttons = {
      ...DEFAULT_DB.welcome.settings.buttons,
      ...(db.welcome.settings.buttons ?? {}),
    };

    db.state.kickLastAnnounced ||= {};
    db.state.twitchLastAnnounced ||= {};
    db.state.kickActiveMessages ||= {};
    db.state.twitchActiveMessages ||= {};

    db.state.kickHealth = {
      ...DEFAULT_DB.state.kickHealth,
      ...(db.state.kickHealth ?? {}),
    };
    db.state.twitchHealth = {
      ...DEFAULT_DB.state.twitchHealth,
      ...(db.state.twitchHealth ?? {}),
    };
    db.state.lastTickAt ||= 0;
    db.state.lastTickDurationMs ||= 0;

    return db;
  } catch (err) {
    if (err && err.code === "ENOENT") {
      const db = structuredClone(DEFAULT_DB);
      await saveDb(db);
      return db;
    }
    throw err;
  }
}

async function saveDb(db) {
  const tmpPath = DB_PATH + ".tmp";
  const raw = JSON.stringify(db, null, 2);
  await fs.writeFile(tmpPath, raw, "utf8");
  await fs.rename(tmpPath, DB_PATH);
}

module.exports = { loadDb, saveDb, DB_PATH };
