"use strict";

const fs = require("node:fs");

const CURRENT_SCHEMA_VERSION = 1;

function validateDataObject(value, { requireSchema = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Persistence root must be a JSON object");
  }

  if (value.schemaVersion == null) {
    if (requireSchema) throw new Error("Persistence file is missing schemaVersion");
    return value;
  }

  if (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 1) {
    throw new Error("schemaVersion must be a positive integer");
  }
  if (value.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Persistence schema ${value.schemaVersion} is newer than supported schema ${CURRENT_SCHEMA_VERSION}`
    );
  }
  return value;
}

function validateDataFile(file, options) {
  const raw = fs.readFileSync(file, "utf8");
  return validateDataObject(JSON.parse(raw), options);
}

if (require.main === module) {
  const file = process.argv[2];
  const requireSchema = process.argv.includes("--require-schema");
  if (!file) {
    console.error("Usage: node scripts/validate-data.js /path/to/data.json [--require-schema]");
    process.exit(2);
  }
  try {
    validateDataFile(file, { requireSchema });
  } catch (err) {
    console.error(`Invalid persistence file: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { validateDataObject, validateDataFile, CURRENT_SCHEMA_VERSION };
