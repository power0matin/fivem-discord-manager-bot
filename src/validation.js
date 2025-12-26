"use strict";

/**
 * Shared validation + normalization helpers used by both
 * prefix commands (src/index.js) and slash setup (src/slash/setup.js).
 */

function normalizeName(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase();
}

function safeStr(v) {
  return String(v ?? "").trim();
}

function clampInt(n, min, max, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(x)));
}

function parseOnOff(value) {
  const v = String(value ?? "")
    .trim()
    .toLowerCase();
  if (["1", "true", "yes", "y", "on", "enable", "enabled"].includes(v))
    return true;
  if (["0", "false", "no", "n", "off", "disable", "disabled"].includes(v))
    return false;
  return null;
}

function compileRegexOrFallback(pattern, fallback = /nox\\s*rp/i) {
  const p = String(pattern ?? "").trim();
  if (!p) return fallback;
  if (p.length > 200) return fallback;
  try {
    return new RegExp(p, "i");
  } catch {
    return fallback;
  }
}

function compileRegexOrNull(pattern) {
  const p = String(pattern ?? "").trim();
  if (!p) return null;
  if (p.length > 200) return null;
  try {
    return new RegExp(p, "i");
  } catch {
    return null;
  }
}

function validateRegexPattern(pattern) {
  const p = String(pattern ?? "").trim();
  if (!p) return { ok: false, error: "Regex cannot be empty." };
  if (p.length > 200)
    return { ok: false, error: "Regex is too long (max 200 chars)." };
  try {
    // eslint-disable-next-line no-new
    new RegExp(p, "i");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Invalid regex: ${err?.message ?? err}` };
  }
}

module.exports = {
  normalizeName,
  safeStr,
  clampInt,
  parseOnOff,
  compileRegexOrFallback,
  compileRegexOrNull,
  validateRegexPattern,
};
