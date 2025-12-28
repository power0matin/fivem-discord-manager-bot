"use strict";

const axios = require("axios");
const {
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

const EPHEMERAL_FLAG = MessageFlags?.Ephemeral ?? 1 << 6;

function normalizeBaseUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;

  // Basic sanity: must look like http(s)://host:port
  if (!/^https?:\/\/[^/\s]+(:\d+)?$/i.test(raw)) return null;

  return raw.replace(/\/+$/g, "");
}

function normalizeHttpUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  if (!/^https?:\/\/\S+$/i.test(raw)) return null;
  return raw;
}

function isHttpUrl(input) {
  return Boolean(normalizeHttpUrl(input));
}

function normalizeFivemUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  // Example: fivem://connect/sv.nox-rp.ir
  if (!/^fivem:\/\/\S+$/i.test(raw)) return null;
  return raw;
}

function normalizeConnectUrl(input) {
  // Accept http(s) or fivem://
  return normalizeHttpUrl(input) || normalizeFivemUrl(input);
}

function isConnectUrlLinkable(input) {
  // Discord Link buttons only support http/https
  return isHttpUrl(input);
}

function parseHumanUptimeToMs(input) {
  if (input == null) return null;

  // numeric input
  if (typeof input === "number" && Number.isFinite(input) && input > 0) {
    // Heuristic:
    // - if it's "big", treat as ms
    // - otherwise treat as seconds
    // (FiveM custom vars usually expose seconds; some scripts expose ms)
    if (input >= 1e9) return Math.floor(input); // ms
    return Math.floor(input * 1000); // s -> ms
  }

  const s = String(input).trim();
  if (!s) return null;

  // Numeric string (FiveM convars are often strings)
  // Heuristic mirrors numeric branch:
  // - big => ms
  // - small => seconds
  if (/^\d+(?:\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (n >= 1e9) return Math.floor(n); // ms
    return Math.floor(n * 1000); // s -> ms
  }

  // "10:37:12" (hh:mm:ss) or "37:12" (mm:ss)
  const colon = /^(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (colon) {
    const a = Number(colon[1]);
    const b = Number(colon[2]);
    const c = colon[3] != null ? Number(colon[3]) : null;

    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

    let totalSec = 0;
    if (c == null) {
      // mm:ss
      totalSec = a * 60 + b;
    } else {
      // hh:mm:ss
      if (!Number.isFinite(c)) return null;
      totalSec = a * 3600 + b * 60 + c;
    }
    if (totalSec <= 0) return null;
    return totalSec * 1000;
  }

  // "10h 37m", "10 hrs, 37 mins", "10h37m", "1d 2h 3m 4s"
  // We accept days/hours/minutes/seconds in flexible formats
  const re =
    /(\d+(?:\.\d+)?)\s*(d|day|days|h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds|ms|millisecond|milliseconds)\b/gi;

  let match;
  let found = false;
  let totalMs = 0;

  while ((match = re.exec(s)) !== null) {
    found = true;
    const num = Number(match[1]);
    const unit = String(match[2]).toLowerCase();

    if (!Number.isFinite(num) || num <= 0) continue;

    if (unit === "d" || unit === "day" || unit === "days")
      totalMs += num * 86400000;
    else if (
      unit === "h" ||
      unit === "hr" ||
      unit === "hrs" ||
      unit === "hour" ||
      unit === "hours"
    )
      totalMs += num * 3600000;
    else if (
      unit === "m" ||
      unit === "min" ||
      unit === "mins" ||
      unit === "minute" ||
      unit === "minutes"
    )
      totalMs += num * 60000;
    else if (
      unit === "s" ||
      unit === "sec" ||
      unit === "secs" ||
      unit === "second" ||
      unit === "seconds"
    )
      totalMs += num * 1000;
    else if (unit === "ms" || unit === "millisecond" || unit === "milliseconds")
      totalMs += num;
  }

  if (found && totalMs > 0) return Math.floor(totalMs);

  // "12345ms" or "12345s" (no space)
  const compact = /^(\d+(?:\.\d+)?)(ms|s|sec|secs|m|min|h|hr|d)$/i.exec(s);
  if (compact) {
    const n = Number(compact[1]);
    const u = compact[2].toLowerCase();
    if (!Number.isFinite(n) || n <= 0) return null;

    if (u === "ms") return Math.floor(n);
    if (u === "s" || u === "sec" || u === "secs") return Math.floor(n * 1000);
    if (u === "m" || u === "min") return Math.floor(n * 60000);
    if (u === "h" || u === "hr") return Math.floor(n * 3600000);
    if (u === "d") return Math.floor(n * 86400000);
  }

  return null;
}

function pickUptimeFromVars(varsObj) {
  if (!varsObj || typeof varsObj !== "object") return null;

  // Prefer explicit keys first (common conventions)
  const preferredKeys = [
    "uptimeMs",
    "uptime_ms",
    "uptimeMilliseconds",
    "uptimeSeconds",
    "uptime_sec",
    "uptime",
    "serverUptime",
    "server_uptime",
    "sv_uptime",
  ];

  for (const k of preferredKeys) {
    if (!(k in varsObj)) continue;
    const ms = parseHumanUptimeToMs(varsObj[k]);
    if (ms != null && ms > 0) return ms;
  }

  // Fallback: scan any key containing "uptime"
  for (const [k, v] of Object.entries(varsObj)) {
    if (!/uptime/i.test(k)) continue;
    const ms = parseHumanUptimeToMs(v);
    if (ms != null && ms > 0) return ms;
  }

  return null;
}

function extractServerUptimeMs(status) {
  // IMPORTANT:
  // We only accept uptime that is explicitly published by the FiveM server (dynamic/info/vars).
  // If server doesn't expose it, return null (do NOT fallback to bot-observed timestamps).
  const dyn = status?.dynamic || {};
  const inf = status?.info || {};

  // Direct candidates on dynamic/info root
  const directCandidates = [
    dyn.uptimeMs,
    dyn.uptime_ms,
    dyn.uptimeSeconds,
    dyn.uptime_sec,
    dyn.uptime,

    inf.uptimeMs,
    inf.uptime_ms,
    inf.uptimeSeconds,
    inf.uptime_sec,
    inf.uptime,
  ];

  for (const v of directCandidates) {
    const ms = parseHumanUptimeToMs(v);
    if (ms != null && ms > 0) return ms;
  }

  // Vars candidates (most likely place for custom uptime)
  const msFromDynVars = pickUptimeFromVars(dyn.vars);
  if (msFromDynVars != null) return msFromDynVars;

  const msFromInfVars = pickUptimeFromVars(inf.vars);
  if (msFromInfVars != null) return msFromInfVars;

  return null;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function parseRestartTimes(input) {
  // Accept "04:00,16:00" or ["04:00","16:00"]
  const parts = Array.isArray(input)
    ? input
    : String(input || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

  const ok = [];
  for (const p of parts) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(p);
    if (!m) continue;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (Number.isNaN(hh) || Number.isNaN(mm)) continue;
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) continue;
    ok.push(`${pad2(hh)}:${pad2(mm)}`);
  }

  // unique + sort
  return [...new Set(ok)].sort();
}

function nextDailyTimeMs(nowMs, hh, mm) {
  const d = new Date(nowMs);
  const cand = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    hh,
    mm,
    0,
    0
  ).getTime();
  if (cand > nowMs) return cand;
  return cand + 24 * 60 * 60 * 1000;
}

function computeNextRestartMs(nowMs, times) {
  const parsed = parseRestartTimes(times);
  if (!parsed.length) return null;

  let best = null;
  for (const t of parsed) {
    const [hh, mm] = t.split(":").map(Number);
    const cand = nextDailyTimeMs(nowMs, hh, mm);
    if (best == null || cand < best) best = cand;
  }
  return best;
}

function fmtDurationParts(ms) {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin - days * 24 * 60) / 60);
  const mins = totalMin - days * 24 * 60 - hours * 60;

  const parts = [];
  if (days) parts.push(`${days} days`);
  if (hours) parts.push(`${hours} hrs`);
  parts.push(`${mins} mins`);
  return parts.join(", ");
}

function fmtLocalDateTime(ms) {
  const d = new Date(Number(ms || 0) || Date.now());
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const MM = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  return `${yyyy}-${MM}-${dd} ${hh}:${mm}`;
}

function guessConnectCommand(baseUrl, explicit) {
  if (explicit && String(explicit).trim()) return String(explicit).trim();
  const b = normalizeBaseUrl(baseUrl);
  if (!b) return null;

  // http://host:30120 => connect host
  const hostPort = b.replace(/^https?:\/\//i, "");
  const host = hostPort.split(":")[0] || hostPort;
  return host ? `connect ${host}` : null;
}

function fmtBool(v) {
  return v ? "ON" : "OFF";
}

function nowMs() {
  return Date.now();
}

function nextBackoffMs(consecutiveFailures) {
  const base = 5_000; // 5s
  const cap = 120_000; // 2min
  const exp = Math.min(
    cap,
    base * Math.pow(2, Math.min(consecutiveFailures, 6))
  );
  const jitter = Math.floor(Math.random() * 750);
  return exp + jitter;
}

function withEphemeralFlags(payload) {
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
  const p = withEphemeralFlags(payload);
  try {
    if (interaction.deferred || interaction.replied)
      return await interaction.followUp(p);
    return await interaction.reply(p);
  } catch (_) {
    return null;
  }
}

async function fetchJson(url, timeoutMs) {
  let res;
  try {
    res = await axios.get(url, {
      timeout: timeoutMs,
      validateStatus: () => true,
      headers: { "User-Agent": "fivem-discord-manager-bot/1.0" },
    });
  } catch (e) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: e?.message ? String(e.message) : String(e),
    };
  }

  const ct = String(res.headers?.["content-type"] || "").toLowerCase();
  const isJson = ct.includes("application/json") || ct.includes("text/json");

  // Treat "Nope." as blocked even if HTTP 200
  if (typeof res.data === "string" && res.data.toLowerCase().includes("nope")) {
    return { ok: false, status: res.status, data: res.data, blocked: true };
  }

  if (res.status >= 200 && res.status < 300) {
    if (isJson && typeof res.data === "object" && res.data != null) {
      return { ok: true, status: res.status, data: res.data };
    }
    return { ok: true, status: res.status, data: res.data };
  }

  return { ok: false, status: res.status, data: res.data };
}

async function getFiveMStatus(baseUrl, timeoutMs) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) {
    return {
      online: false,
      blocked: false,
      reason: "Invalid endpoint URL.",
      info: null,
      dynamic: null,
      players: null,
    };
  }

  const infoUrl = `${base}/info.json`;
  const dynamicUrl = `${base}/dynamic.json`;
  const playersUrl = `${base}/players.json`;

  // Use dynamic.json as primary signal (contains clients/hostname in most cases)
  const [dynamic, info, players] = await Promise.allSettled([
    fetchJson(dynamicUrl, timeoutMs),
    fetchJson(infoUrl, timeoutMs),
    fetchJson(playersUrl, timeoutMs),
  ]);

  const dyn =
    dynamic.status === "fulfilled" ? dynamic.value : { ok: false, data: null };
  const inf =
    info.status === "fulfilled" ? info.value : { ok: false, data: null };
  const ply =
    players.status === "fulfilled" ? players.value : { ok: false, data: null };

  const textNope = (x) => {
    const d = x?.data;
    if (typeof d === "string" && d.toLowerCase().includes("nope")) return true;
    return false;
  };

  const blocked =
    Boolean(dyn.blocked) ||
    Boolean(inf.blocked) ||
    Boolean(ply.blocked) ||
    textNope(dyn) ||
    textNope(inf) ||
    textNope(ply);

  const online = (dyn.ok || inf.ok || ply.ok) && !blocked;

  return {
    online,
    blocked,
    reason: blocked ? "Server blocks info endpoints (Nope)." : null,
    info: inf.ok ? inf.data : null,
    dynamic: dyn.ok ? dyn.data : null,
    players: ply.ok ? ply.data : null,
  };
}

function buildStatusEmbed(ctx, status) {
  const db = ctx.getDb();
  const s = db.fivem?.settings || {};
  const st = db.fivem?.state || {};
  const base = s.baseUrl;

  const dynamic = status.dynamic || {};
  const info = status.info || {};
  const players = Array.isArray(status.players) ? status.players : [];

  const detectedHostname =
    (typeof dynamic.hostname === "string" && dynamic.hostname) ||
    (typeof info.vars?.sv_projectName === "string" &&
      info.vars.sv_projectName) ||
    (typeof info.vars?.sv_hostname === "string" && info.vars.sv_hostname) ||
    (typeof info.server === "string" && info.server) ||
    "FiveM Server";

  const title = String(s.title || detectedHostname).slice(0, 256);

  const maxClients =
    Number(
      dynamic.sv_maxclients ||
        dynamic.vars?.sv_maxclients ||
        info.vars?.sv_maxclients ||
        0
    ) || null;

  const clients = Number(dynamic.clients || dynamic.players || 0) || 0;

  const statusBox = status.online
    ? "```diff\n+ Online\n```"
    : "```diff\n- Offline\n```";

  const playersBox = status.online
    ? `\`\`\`\n${
        maxClients ? `${clients}/${maxClients}` : `${clients}`
      }\n\`\`\``
    : "```--\n--\n```";

  const connectCmd = guessConnectCommand(base, s.connectCommand);
  const connectBox = connectCmd
    ? `\`\`\`\n${connectCmd}\n\`\`\``
    : "```--\n--\n```";

  const now = Date.now();

  const nextRestartMs = computeNextRestartMs(now, s.restartTimes);
  const nextRestartBox =
    nextRestartMs != null
      ? `\`\`\`\nin ${fmtDurationParts(nextRestartMs - now)}\n\`\`\``
      : "```--\n--\n```";

  const upstreamUptimeMs = status.online ? extractServerUptimeMs(status) : null;

  // STRICT MODE:
  // Only show uptime if the FiveM server explicitly provides it.
  // If not provided, show "--" (never show bot-observed uptime).
  const uptimeBox =
    status.online && upstreamUptimeMs != null
      ? `\`\`\`\n${fmtDurationParts(upstreamUptimeMs)}\n\`\`\``
      : "```--\n--\n```";

  const fields = [
    { name: "STATUS", value: statusBox, inline: true },
    { name: "PLAYERS", value: playersBox, inline: true },

    { name: "F8 CONNECT COMMAND", value: connectBox, inline: false },

    { name: "NEXT RESTART", value: nextRestartBox, inline: true },
    { name: "UPTIME", value: uptimeBox, inline: true },
  ];

  // Optional: show players list below (safe/truncated)
  if (status.online && s.showPlayers && players.length > 0) {
    const maxShown = Math.max(0, Math.min(Number(s.maxPlayersShown || 10), 25));
    const names = players
      .slice(0, maxShown)
      .map((p, i) => {
        const n = String(p?.name || "unknown")
          .replace(/\s+/g, " ")
          .trim();
        return `${i + 1}. ${n || "unknown"}`;
      })
      .join("\n");

    fields.push({
      name: `PLAYERS LIST (top ${Math.min(players.length, maxShown)}/${
        players.length
      })`,
      value: names.length ? `\`\`\`\n${names}\n\`\`\`` : "```--\n--\n```",
      inline: false,
    });
  }

  const intervalSec = Math.max(
    60,
    Math.min(Number(s.checkIntervalSeconds || 300), 3600)
  );

  const everyText =
    intervalSec < 120
      ? "Every minute"
      : `Every ${Math.round(intervalSec / 60)} min`;

  // Footer: remove Endpoint/Visibility as requested
  const footerText = `${everyText} • ${fmtLocalDateTime(Date.now())}`;

  // Manual color if set (hex string), otherwise ctx.makeEmbed tone decides
  const embed = ctx.makeEmbed(null, {
    // "DANGER" is not a supported tone in src/ui/embeds.js; use "ERROR" for red fallback.
    tone: status.online ? "SUCCESS" : "ERROR",

    // Pass raw value and let src/ui/embeds.js parse it.
    // Supported examples:
    // - "#ff8383"
    // - "ff8383"
    // - "0xff8383"
    // - "#ff8383ff" (alpha ignored)
    color: s.embedColor ?? "#ff8383",

    chrome: "minimal",
    footerMode: "none",
    titleIcon: false,
    title,
    description: s.description ? String(s.description).slice(0, 512) : "",
    fields,
    imageUrl: s.bannerImageUrl || null,
    footerText,
    timestamp: false,
  });

  return embed;
}

async function ensureStatusMessage(ctx, embed) {
  const db = ctx.getDb();
  const s = db.fivem.settings;

  if (!s.enabled) return { ok: false, reason: "disabled" };
  if (!s.statusChannelId) return { ok: false, reason: "no_channel" };

  const channel = await ctx.client.channels
    .fetch(s.statusChannelId)
    .catch(() => null);

  if (!channel || !("send" in channel)) {
    return { ok: false, reason: "invalid_channel" };
  }

  const row = new ActionRowBuilder();

  // Website button (http/https only)
  if (s.websiteUrl && isHttpUrl(s.websiteUrl)) {
    row.addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(String(s.websiteLabel || "Website").slice(0, 80))
        .setEmoji(String(s.websiteEmoji || "🌐"))
        .setURL(String(s.websiteUrl))
    );
  }

  // Connect button:
  // - If http/https: Link button
  // - If fivem:// (or other non-linkable): Custom button that replies ephemeral with instructions
  if (s.connectUrl) {
    const normalized = normalizeConnectUrl(s.connectUrl);

    if (normalized && isConnectUrlLinkable(normalized)) {
      row.addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel(String(s.connectLabel || "Connect").slice(0, 80))
          .setEmoji(String(s.connectEmoji || "🎮"))
          .setURL(String(normalized))
      );
    } else if (normalized) {
      row.addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Primary)
          .setCustomId("fivem:connect")
          .setLabel(String(s.connectLabel || "Connect").slice(0, 80))
          .setEmoji(String(s.connectEmoji || "🎮"))
      );
    }
  }

  const components = row.components.length ? [row] : [];

  // Edit existing message if possible
  if (s.statusMessageId && "messages" in channel) {
    const msg = await channel.messages
      .fetch(s.statusMessageId)
      .catch(() => null);
    if (msg) {
      try {
        await msg.edit({ embeds: [embed], components });
        return { ok: true, mode: "edited" };
      } catch (e) {
        return {
          ok: false,
          reason: "edit_failed",
          error: e?.message ? String(e.message) : String(e),
        };
      }
    }
    s.statusMessageId = null;
  }

  try {
    const sent = await channel.send({ embeds: [embed], components });
    s.statusMessageId = sent.id;
    await ctx.persistDb().catch(() => null);
    return { ok: true, mode: "sent" };
  } catch (e) {
    return {
      ok: false,
      reason: "send_failed",
      error: e?.message ? String(e.message) : String(e),
    };
  }
}

async function doPoll(ctx, opts = {}) {
  const { force = false, updateMessage = true } = opts;

  const db = ctx.getDb();

  // Backward-compatible init for auto polling
  db.fivem ||= {};
  db.fivem.settings ||= {};
  db.fivem.state ||= {};

  const s = db.fivem.settings;
  const st = db.fivem.state;

  const now = nowMs();

  if (!s.enabled && !force) return { ok: false, reason: "disabled" };

  if (!force && st.nextAllowedAt && now < st.nextAllowedAt) {
    return { ok: false, reason: "backoff", nextAllowedAt: st.nextAllowedAt };
  }

  if (!s.baseUrl) {
    // Make it explicit; otherwise you get "offline" ambiguity
    return { ok: false, reason: "no_endpoint" };
  }

  const status = await getFiveMStatus(s.baseUrl, Number(s.timeoutMs || 5000));

  const prevOnline = st.lastOnline;

  st.lastCheckedAt = now;
  st.lastOnline = Boolean(status.online);

  if (status.online) {
    // IMPORTANT:
    // - Do NOT set wentOnlineAt on "unknown -> online" (prevOnline === null)
    //   because that typically equals "bot just started", which shows bot uptime.
    // - Only set on a real observed offline -> online transition.
    if (prevOnline === false) st.wentOnlineAt = now;

    st.consecutiveFailures = 0;
    st.nextAllowedAt = 0;
    st.lastError = null;
    st.lastErrorAt = 0;
    st.lastSuccessAt = now;
  } else {
    // If we observed online -> offline, uptime is no longer meaningful
    if (prevOnline === true) {
      st.wentOnlineAt = 0;
    }

    st.consecutiveFailures = Number(st.consecutiveFailures || 0) + 1;
    st.lastError = status.reason || "Fetch failed/offline.";
    st.lastErrorAt = now;

    // Only apply backoff when not forced (manual status should not lock you out)
    if (!force) st.nextAllowedAt = now + nextBackoffMs(st.consecutiveFailures);
  }

  await ctx.persistDb().catch(() => null);

  const embed = buildStatusEmbed(ctx, status);

  let message = null;

  // Only update the channel message if requested + enabled
  if (updateMessage && s.enabled) {
    message = await ensureStatusMessage(ctx, embed);
  }

  return { ok: true, status, message };
}

function hasBotAccess(interaction, config) {
  try {
    const allowed = Array.isArray(config.allowedRoleIds)
      ? config.allowedRoleIds
      : [];
    if (allowed.length === 0) {
      return interaction.memberPermissions?.has?.("ManageGuild") ?? false;
    }

    const member = interaction.member;
    const roles = member?.roles;
    const cache = roles?.cache;
    if (!cache) return false;

    return allowed.some((id) => cache.has(id));
  } catch {
    return false;
  }
}

async function handleInteraction(interaction, ctx) {
  // Handle button clicks for Connect (when connectUrl is fivem://...)
  if (interaction.isButton && interaction.isButton()) {
    if (interaction.customId !== "fivem:connect") return false;

    const db = ctx.getDb();
    const s = db.fivem?.settings || {};

    const connectUrl = normalizeConnectUrl(s.connectUrl);
    const connectCmd = String(s.connectCommand || "").trim();

    const lines = [];
    lines.push("**How to connect:**");
    if (connectCmd)
      lines.push(`- Open FiveM console (F8) and run:\n\`${connectCmd}\``);
    if (connectUrl) lines.push(`- Or copy this link:\n\`${connectUrl}\``);

    await safeReply(interaction, {
      ephemeral: true,
      content: lines.join("\n"),
    });

    return true;
  }

  // Slash commands
  if (!interaction.isChatInputCommand()) return false;
  if (interaction.commandName !== "fivem") return false;

  if (!hasBotAccess(interaction, ctx.config)) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "⛔ You do not have access to this command.",
    });
    return true;
  }

  const db = ctx.getDb();

  // Backward-compatible init (prevents crashes on older data.json)
  db.fivem ||= {};
  db.fivem.settings ||= {};
  db.fivem.state ||= {};

  const s = db.fivem.settings;
  const sub = interaction.options.getSubcommand();

  if (sub === "set-endpoint") {
    const url = interaction.options.getString("url", true);
    const normalized = normalizeBaseUrl(url);
    if (!normalized) {
      await safeReply(interaction, {
        ephemeral: true,
        content: "❌ Invalid URL. Example: http://127.0.0.1:30120",
      });
      return true;
    }
    s.baseUrl = normalized;
    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ Endpoint set to \`${normalized}\`.`,
    });
    return true;
  }

  if (sub === "set-channel") {
    const ch = interaction.options.getChannel("channel", true);
    s.statusChannelId = ch.id;
    // reset message id so we don't try editing a message in old channel
    s.statusMessageId = null;
    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ Status channel set to <#${ch.id}>.`,
    });
    return true;
  }

  if (sub === "set-interval") {
    const seconds = interaction.options.getInteger("seconds", true);
    const clamped = Math.max(60, Math.min(Number(seconds || 300), 3600));
    s.checkIntervalSeconds = clamped;

    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ Interval set to ${clamped}s (recommended: 300s).`,
    });

    // Optional: force an immediate refresh when operator changes interval
    if (s.enabled) await doPoll(ctx).catch(() => null);

    return true;
  }

  if (sub === "toggle") {
    const enabled = interaction.options.getBoolean("enabled", true);
    s.enabled = Boolean(enabled);
    await ctx.persistDb().catch(() => null);

    if (s.enabled) {
      const res = await doPoll(ctx, { force: true, updateMessage: true }).catch(
        (e) => ({ ok: false, err: e })
      );

      if (!res?.ok) {
        const reason =
          res?.reason ||
          (res?.err && (res.err.message || String(res.err))) ||
          "unknown_error";

        await safeReply(interaction, {
          ephemeral: true,
          content: `⚠️ Enabled, but first refresh failed. Reason: \`${reason}\``,
        });
      } else if (res?.message && res.message.ok === false) {
        const detail = res.message.error ? ` • ${res.message.error}` : "";
        await safeReply(interaction, {
          ephemeral: true,
          content: `⚠️ Enabled, but message send/edit failed: \`${res.message.reason}\`${detail}`,
        });
      }
    }

    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ FiveM auto status is now: **${fmtBool(s.enabled)}**.`,
    });
    return true;
  }

  if (sub === "show") {
    const embed = ctx.makeEmbed(null, {
      tone: "INFO",
      title: "FiveM • Settings",
      fields: [
        { name: "Enabled", value: String(Boolean(s.enabled)), inline: true },
        {
          name: "Endpoint",
          value: s.baseUrl ? `\`${s.baseUrl}\`` : "_Not set_",
          inline: false,
        },
        {
          name: "Status Channel",
          value: s.statusChannelId ? `<#${s.statusChannelId}>` : "_Not set_",
          inline: false,
        },
        {
          name: "Interval",
          value: `${Number(s.checkIntervalSeconds || 300)}s`,
          inline: true,
        },
        {
          name: "Title",
          value: s.title ? `\`${s.title}\`` : "_Auto_",
          inline: false,
        },
        {
          name: "Description",
          value: s.description
            ? `\`${String(s.description).slice(0, 120)}\``
            : "_None_",
          inline: false,
        },
        {
          name: "Banner",
          value: s.bannerImageUrl ? `[set](${s.bannerImageUrl})` : "_None_",
          inline: true,
        },
        {
          name: "Website",
          value: s.websiteUrl
            ? `[${s.websiteLabel || "Website"}](${s.websiteUrl})`
            : "_None_",
          inline: true,
        },
        {
          name: "Connect Button",
          value: s.connectUrl
            ? `[${s.connectLabel || "Connect"}](${s.connectUrl})`
            : "_None_",
          inline: true,
        },
        {
          name: "Connect Command",
          value: s.connectCommand
            ? `\`${s.connectCommand}\``
            : "_Auto (from endpoint host)_",
          inline: false,
        },
        {
          name: "Restart Times",
          value:
            Array.isArray(s.restartTimes) && s.restartTimes.length
              ? `\`${s.restartTimes.join(", ")}\``
              : "_None_",
          inline: false,
        },
        {
          name: "Show Players",
          value: String(Boolean(s.showPlayers)),
          inline: true,
        },
      ],
    });

    await safeReply(interaction, { ephemeral: true, embeds: [embed] });
    return true;
  }
  if (sub === "set-title") {
    const title = interaction.options.getString("title", true);
    s.title = String(title).slice(0, 256);
    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: "✅ Title updated.",
    });
    return true;
  }

  if (sub === "set-description") {
    const text = interaction.options.getString("text", true);
    s.description = String(text).slice(0, 512);
    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: "✅ Description updated.",
    });
    return true;
  }

  if (sub === "set-banner") {
    const clear = interaction.options.getBoolean("clear", false) || false;
    const url = interaction.options.getString("url", false);

    if (clear) {
      s.bannerImageUrl = null;
    } else {
      const normalized = normalizeHttpUrl(url);
      if (!normalized) {
        await safeReply(interaction, {
          ephemeral: true,
          content: "❌ Invalid banner URL (must be http/https).",
        });
        return true;
      }
      s.bannerImageUrl = normalized;
    }

    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: "✅ Banner updated.",
    });
    return true;
  }

  if (sub === "set-website") {
    const url = interaction.options.getString("url", true);
    const label = interaction.options.getString("label", false);

    const normalized = normalizeHttpUrl(url);
    if (!normalized) {
      await safeReply(interaction, {
        ephemeral: true,
        content: "❌ Invalid website URL (must be http/https).",
      });
      return true;
    }

    s.websiteUrl = normalized;
    if (label) s.websiteLabel = String(label).slice(0, 80);

    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: "✅ Website set.",
    });
    return true;
  }

  if (sub === "set-connect") {
    const url = interaction.options.getString("url", true);
    const label = interaction.options.getString("label", false);

    const normalized = normalizeConnectUrl(url);
    if (!normalized) {
      await safeReply(interaction, {
        ephemeral: true,
        content:
          "❌ Invalid connect URL. Use http/https or fivem://connect/...",
      });
      return true;
    }

    s.connectUrl = normalized;
    if (label) s.connectLabel = String(label).slice(0, 80);

    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: "✅ Connect set.",
    });
    return true;
  }

  if (sub === "set-connect-command") {
    const cmd = interaction.options.getString("command", true);
    s.connectCommand = String(cmd).slice(0, 200);
    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: "✅ Connect command updated.",
    });
    return true;
  }

  if (sub === "set-restart-times") {
    const clear = interaction.options.getBoolean("clear", false) || false;
    const times = interaction.options.getString("times", false);

    if (clear) {
      s.restartTimes = [];
    } else {
      const parsed = parseRestartTimes(times);
      if (!parsed.length) {
        await safeReply(interaction, {
          ephemeral: true,
          content: '❌ Invalid times. Example: "04:00,16:00"',
        });
        return true;
      }
      s.restartTimes = parsed;
    }

    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: "✅ Restart times updated.",
    });
    return true;
  }

  if (sub === "status") {
    await safeReply(interaction, {
      ephemeral: true,
      content: "⏳ Fetching FiveM status...",
    });

    const res = await doPoll(ctx, {
      force: true,
      updateMessage: Boolean(s.enabled),
    }).catch((e) => ({ ok: false, err: e }));

    if (!res?.ok) {
      const reason =
        res?.reason ||
        (res?.err && (res.err.message || String(res.err))) ||
        "unknown_error";

      await safeReply(interaction, {
        ephemeral: true,
        content: `❌ Failed to fetch status. Reason: \`${reason}\``,
      });
      return true;
    }

    // If message update failed, show it explicitly (common: invalid button URL / missing perms)
    if (res.message && res.message.ok === false) {
      const detail = res.message.error ? ` • ${res.message.error}` : "";
      await safeReply(interaction, {
        ephemeral: true,
        content: `⚠️ Status fetched, but message update failed: \`${res.message.reason}\`${detail}`,
      });
    }

    const embed = buildStatusEmbed(ctx, res.status);
    await safeReply(interaction, { ephemeral: true, embeds: [embed] });
    return true;
  }

  return true;
}

function register(ctx) {
  let timer = null;
  let lastScheduledAt = 0;

  const scheduleNext = () => {
    if (timer) clearTimeout(timer);

    const db = ctx.getDb();
    const s = db.fivem?.settings || {};
    const intervalSec = Math.max(
      60,
      Math.min(Number(s.checkIntervalSeconds || 300), 3600)
    );

    const now = Date.now();

    // Keep cadence steady: next tick = lastScheduledAt + interval
    const base = lastScheduledAt ? lastScheduledAt : now;
    const target = base + intervalSec * 1000;
    const delay = Math.max(0, target - now);

    timer = setTimeout(async () => {
      lastScheduledAt = target;

      const latest = ctx.getDb();
      if (latest.fivem?.settings?.enabled) {
        await doPoll(ctx).catch(() => null);
      }

      scheduleNext();
    }, delay);
  };

  ctx.client.on(Events.ClientReady, async () => {
    lastScheduledAt = 0;
    scheduleNext();

    // First run (best-effort) if enabled
    const db = ctx.getDb();
    if (db.fivem?.settings?.enabled) {
      await doPoll(ctx).catch(() => null);
    }
  });
}

module.exports = {
  register,
  handleInteraction,
};
