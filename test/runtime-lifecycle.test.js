"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function runChild(source, { signalAfterReady = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", source], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (signalAfterReady && stdout.includes("READY")) {
        child.kill(signalAfterReady);
        signalAfterReady = null;
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

test("uncaught exceptions terminate with non-zero status", async () => {
  const result = await runChild(`
    require('./src/hardening/runtime').installProcessGuards();
    setTimeout(() => { throw new Error('boom'); }, 10);
  `);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Fatal:UncaughtException/);
});

test("SIGTERM performs graceful shutdown and exits successfully", async () => {
  const result = await runChild(`
    require('./src/hardening/runtime').installProcessGuards();
    console.log('READY');
    setInterval(() => {}, 1000);
  `, { signalAfterReady: "SIGTERM" });
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
});
