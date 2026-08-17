"use strict";

function normalizeName(s) {
  return String(s ?? "").trim().toLowerCase();
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
  const v = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "y", "on", "enable", "enabled"].includes(v)) return true;
  if (["0", "false", "no", "n", "off", "disable", "disabled"].includes(v)) return false;
  return null;
}

function unsafeRegexReason(pattern) {
  const p = String(pattern ?? "").trim();
  if (p.length > 200) return "Regex is too long (max 200 chars).";

  // Reject common catastrophic-backtracking shapes such as (a+)+, (.*)* and (x{1,3})+.
  // This deliberately favors predictable event-loop latency over accepting every JS regex.
  const nestedQuantifier = /\((?:\\.|[^()])*?(?:\+|\*|\{\d+(?:,\d*)?\})(?:\\.|[^()])*?\)\s*(?:\+|\*|\{\d+(?:,\d*)?\})/;
  if (nestedQuantifier.test(p)) {
    return "Regex contains nested quantifiers that can block the event loop.";
  }

  // Backreferences combined with unbounded repetition are another high-risk construct.
  if (/\\[1-9]/.test(p) && /[+*]/.test(p)) {
    return "Regex combines backreferences with unbounded repetition.";
  }

  return null;
}

function compileRegexOrFallback(pattern, fallback = /nox\s*rp/i) {
  const p = String(pattern ?? "").trim();
  if (!p || unsafeRegexReason(p)) return fallback;
  try {
    return new RegExp(p, "i");
  } catch {
    return fallback;
  }
}

function compileRegexOrNull(pattern) {
  const p = String(pattern ?? "").trim();
  if (!p || unsafeRegexReason(p)) return null;
  try {
    return new RegExp(p, "i");
  } catch {
    return null;
  }
}

function validateRegexPattern(pattern) {
  const p = String(pattern ?? "").trim();
  if (!p) return { ok: false, error: "Regex cannot be empty." };

  const unsafe = unsafeRegexReason(p);
  if (unsafe) return { ok: false, error: unsafe };

  try {
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
  unsafeRegexReason,
};
