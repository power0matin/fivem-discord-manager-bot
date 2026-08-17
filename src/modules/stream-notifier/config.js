"use strict";

const dotenv = require("dotenv");
const { validateRegexPattern } = require("./validation");

dotenv.config();

const SNOWFLAKE_RE = /^\d{17,20}$/;
const PLACEHOLDER_RE = /^(YOUR_|CHANGEME|REPLACE_ME)/i;

function read(env, name) {
  const raw = env[name];
  if (raw == null) return undefined;
  const value = String(raw).trim();
  return value === "" ? undefined : value;
}

function required(env, name) {
  const value = read(env, name);
  if (!value) throw new Error(`Missing required env var: ${name}`);
  if (PLACEHOLDER_RE.test(value)) {
    throw new Error(`${name} still contains an example placeholder`);
  }
  return value;
}

function optional(env, name, fallback = undefined) {
  const value = read(env, name);
  if (value === undefined) return fallback;
  if (PLACEHOLDER_RE.test(value)) {
    throw new Error(`${name} still contains an example placeholder`);
  }
  return value;
}

function bool(env, name, fallback = false) {
  const value = read(env, name);
  if (value === undefined) return fallback;
  const normalized = value.toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  throw new Error(`${name} must be a boolean (true/false, on/off, 1/0)`);
}

function int(env, name, fallback, min, max) {
  const value = read(env, name);
  if (value === undefined) return fallback;
  if (!/^-?\d+$/.test(value)) throw new Error(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return parsed;
}

function snowflake(env, name, fallback = undefined) {
  const value = optional(env, name, fallback);
  if (value === undefined) return undefined;
  if (!SNOWFLAKE_RE.test(value)) {
    throw new Error(`${name} must be a valid Discord snowflake ID`);
  }
  return value;
}

function snowflakeList(env, name) {
  const raw = read(env, name);
  if (!raw) return [];
  const values = raw.split(",").map((x) => x.trim()).filter(Boolean);
  for (const value of values) {
    if (!SNOWFLAKE_RE.test(value)) {
      throw new Error(`${name} contains an invalid Discord snowflake: ${value}`);
    }
  }
  return [...new Set(values)];
}

function loadConfig(env = process.env) {
  const prefix = optional(env, "PREFIX", ".");
  if (!prefix || prefix.length > 5 || /\s/.test(prefix)) {
    throw new Error("PREFIX must be 1..5 non-whitespace characters");
  }

  const keywordRegex = optional(env, "KEYWORD_REGEX", "nox\\s*rp");
  const regexCheck = validateRegexPattern(keywordRegex);
  if (!regexCheck.ok) throw new Error(`KEYWORD_REGEX: ${regexCheck.error}`);

  return {
    discordToken: required(env, "DISCORD_TOKEN"),
    clientId: snowflake(env, "DISCORD_CLIENT_ID"),
    guildId: snowflake(env, "DISCORD_GUILD_ID"),
    notifyChannelId: snowflake(env, "DISCORD_NOTIFY_CHANNEL_ID"),
    prefix,
    streamerLiveRoleId: snowflake(env, "STREAMER_LIVE_ROLE_ID"),
    mentionHere: bool(env, "MENTION_HERE", true),
    keywordRegex,
    checkIntervalSeconds: int(env, "CHECK_INTERVAL_SECONDS", 60, 10, 3600),
    discoveryMode: bool(env, "DISCOVERY_MODE", false),
    discoveryTwitchPages: int(env, "DISCOVERY_TWITCH_PAGES", 5, 1, 50),
    discoveryKickLimit: int(env, "DISCOVERY_KICK_LIMIT", 100, 1, 100),
    envOverridesDb: bool(env, "ENV_OVERRIDES_DB", false),
    twitch: {
      clientId: optional(env, "TWITCH_CLIENT_ID"),
      clientSecret: optional(env, "TWITCH_CLIENT_SECRET"),
      gta5GameId: optional(env, "TWITCH_GTA5_GAME_ID", "32982"),
    },
    kick: {
      clientId: optional(env, "KICK_CLIENT_ID"),
      clientSecret: optional(env, "KICK_CLIENT_SECRET"),
      gtaCategoryName: optional(env, "KICK_GTA_CATEGORY_NAME", "Grand Theft Auto V"),
    },
    allowedRoleIds: snowflakeList(env, "ALLOWED_ROLE_IDS"),
  };
}

const config = loadConfig();

module.exports = {
  config,
  loadConfig,
  SNOWFLAKE_RE,
};
