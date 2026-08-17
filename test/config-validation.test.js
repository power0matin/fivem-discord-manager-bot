"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.DISCORD_TOKEN ||= "test-token";
const { loadConfig } = require("../src/modules/stream-notifier/config");
const {
  validateRegexPattern,
  compileRegexOrNull,
} = require("../src/modules/stream-notifier/validation");

function baseEnv(extra = {}) {
  return { DISCORD_TOKEN: "test-token", ...extra };
}

test("configuration accepts minimal valid environment", () => {
  const cfg = loadConfig(baseEnv());
  assert.equal(cfg.prefix, ".");
  assert.equal(cfg.checkIntervalSeconds, 60);
  assert.deepEqual(cfg.allowedRoleIds, []);
});

test("configuration rejects placeholders and malformed snowflakes", () => {
  assert.throws(() => loadConfig(baseEnv({ DISCORD_CLIENT_ID: "YOUR_APPLICATION_CLIENT_ID" })), /placeholder/);
  assert.throws(() => loadConfig(baseEnv({ DISCORD_GUILD_ID: "abc" })), /snowflake/);
});

test("configuration rejects invalid booleans and integers", () => {
  assert.throws(() => loadConfig(baseEnv({ MENTION_HERE: "maybe" })), /boolean/);
  assert.throws(() => loadConfig(baseEnv({ CHECK_INTERVAL_SECONDS: "abc" })), /integer/);
  assert.throws(() => loadConfig(baseEnv({ CHECK_INTERVAL_SECONDS: "2" })), /between 10 and 3600/);
});

test("allowed role IDs are validated and deduplicated", () => {
  const cfg = loadConfig(baseEnv({ ALLOWED_ROLE_IDS: "123456789012345678,123456789012345678" }));
  assert.deepEqual(cfg.allowedRoleIds, ["123456789012345678"]);
});

test("pathological nested-quantifier regex is rejected", () => {
  const result = validateRegexPattern("(a+)+$");
  assert.equal(result.ok, false);
  assert.equal(compileRegexOrNull("(a+)+$"), null);
});

test("normal stream-title regex remains supported", () => {
  const pattern = "nox\\s*[-_]*\\s*rp";
  assert.equal(validateRegexPattern(pattern).ok, true);
  assert.equal(compileRegexOrNull(pattern).test("NOX - RP"), true);
});
