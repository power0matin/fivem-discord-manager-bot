"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const unitPath = path.resolve(__dirname, "../deploy/fivem-discord-manager-bot.service");
const unit = fs.readFileSync(unitPath, "utf8");

function has(line) {
  assert.match(unit, new RegExp(`^${line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
}

test("systemd unit pins production identity, paths and lifecycle", () => {
  has("After=network-online.target");
  has("Wants=network-online.target");
  has("User=fivembot");
  has("Group=fivembot");
  has("WorkingDirectory=/opt/fivem-discord-manager-bot/current");
  has("EnvironmentFile=/etc/fivem-discord-manager-bot/bot.env");
  has("Environment=DATA_FILE=/var/lib/fivem-discord-manager-bot/data.json");
  has("Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin");
  has("ExecStart=/usr/bin/env node src/index.js");
  has("Restart=on-failure");
  has("RestartSec=5s");
  has("TimeoutStopSec=30s");
  has("KillSignal=SIGTERM");
  has("UMask=0077");
});

test("systemd sandbox preserves only the runtime write path", () => {
  has("StateDirectory=fivem-discord-manager-bot");
  has("StateDirectoryMode=0700");
  has("ReadWritePaths=/var/lib/fivem-discord-manager-bot");
  has("NoNewPrivileges=true");
  has("PrivateTmp=true");
  has("PrivateDevices=true");
  has("ProtectSystem=strict");
  has("ProtectHome=true");
  has("ProtectKernelTunables=true");
  has("ProtectKernelModules=true");
  has("ProtectKernelLogs=true");
  has("ProtectControlGroups=true");
  has("RestrictRealtime=true");
  has("RestrictSUIDSGID=true");
  has("LockPersonality=true");
  has("CapabilityBoundingSet=");
  has("AmbientCapabilities=");
  has("RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6");
  assert.doesNotMatch(unit, /^ReadWritePaths=.*\/opt\//m);
  assert.doesNotMatch(unit, /^ReadWritePaths=.*\/etc\//m);
});
