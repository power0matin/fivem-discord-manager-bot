"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const roots = ["src", "scripts", "test"];

function collect(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (entry.isFile() && full.endsWith(".js")) out.push(full);
  }
  return out;
}

const files = roots.flatMap((root) => collect(root)).sort();
let failed = false;
for (const file of files) {
  const res = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (res.status !== 0) failed = true;
}

if (failed) process.exit(1);
console.log(`Syntax OK: ${files.length} JavaScript files`);
