"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const roots = ["src", "scripts", "test", "deploy", ".github/workflows"];
const textExtensions = new Set([".js", ".sh", ".yml", ".yaml", ".json", ".md", ".service"]);
const errors = [];

function walk(relative) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) return [];
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return [relative];
  const out = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) out.push(...walk(child));
    else if (entry.isFile()) out.push(child);
  }
  return out;
}

const files = [...new Set(roots.flatMap(walk))].sort();
for (const file of files) {
  const ext = path.extname(file);
  if (!textExtensions.has(ext) && !file.endsWith(".service")) continue;
  const text = fs.readFileSync(path.join(root, file), "utf8");
  if (text.includes("\r\n")) errors.push(`${file}: CRLF line endings are not allowed`);
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    if (/[ \t]+$/.test(line)) errors.push(`${file}:${index + 1}: trailing whitespace`);
  });
  if (file.endsWith(".sh") && !text.includes("set -Eeuo pipefail")) {
    errors.push(`${file}: deployment shell scripts must enable strict mode`);
  }
  if (file.startsWith(".github/workflows/")) {
    if (/\|\|\s*(true|:)/.test(text)) errors.push(`${file}: CI gates must not mask failures with || true/|| :`);
    if (/continue-on-error:\s*true/.test(text)) errors.push(`${file}: CI gates must not use continue-on-error: true`);
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (!pkg.scripts?.test || !pkg.scripts?.lint || !pkg.scripts?.verify) {
  errors.push("package.json: test, lint, and verify scripts are required");
}
if (pkg.engines?.node !== ">=22") {
  errors.push("package.json: production Node engine must be >=22");
}

if (errors.length) {
  for (const error of errors) console.error(`LINT: ${error}`);
  process.exit(1);
}
console.log(`Lint OK: ${files.length} repository files checked`);
