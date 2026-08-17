"use strict";

const fs = require("node:fs");
const path = require("node:path");

const dataFile = path.resolve(process.env.DATA_FILE || path.join(process.env.DATA_DIR || process.cwd(), "data.json"));
const maxAgeSeconds = Number(process.env.HEALTH_MAX_TICK_AGE_SECONDS || 900);

try {
  const stat = fs.statSync(dataFile);
  if (!stat.isFile()) throw new Error("data path is not a regular file");
  const db = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  if (!db || typeof db !== "object") throw new Error("database root is invalid");
  const lastTickAt = Number(db.state?.lastTickAt || 0);
  if (!lastTickAt) throw new Error("Discord client has not completed a runtime tick yet");
  const ageSeconds = (Date.now() - lastTickAt) / 1000;
  if (!Number.isFinite(ageSeconds) || ageSeconds < 0 || ageSeconds > maxAgeSeconds) {
    throw new Error(`last runtime tick is stale (${Math.floor(ageSeconds)}s old)`);
  }
  process.stdout.write(`READY data=${dataFile} last_tick_age=${Math.floor(ageSeconds)}s\n`);
} catch (err) {
  process.stderr.write(`NOT_READY ${err.message}\n`);
  process.exit(1);
}
