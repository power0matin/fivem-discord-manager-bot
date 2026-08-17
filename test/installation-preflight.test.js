"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createDeployHarness, root } = require("./helpers/deploy-harness");

function runBash(code, env = {}) {
  return spawnSync("bash", ["-c", code], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

test("production installer clearly rejects non-root execution", { skip: process.getuid?.() === 0 }, () => {
  const result = spawnSync("bash", ["scripts/install.sh"], {
    cwd: root,
    env: { ...process.env, DEPLOY_TEST_MODE: "0" },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be run as root/i);
});

test("production platform check rejects a host without systemd as PID1/system manager", { skip: require("node:fs").existsSync("/run/systemd/system") }, () => {
  const result = runBash(
    'set -Eeuo pipefail; DEPLOY_TEST_MODE=0; source scripts/lib/deploy-common.sh; require_supported_platform'
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /systemd is not running/i);
});

test("Node versions below the supported LTS floor fail fast with a clear error", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fivem-old-node-"));
  try {
    const fakeNode = path.join(dir, "node");
    const fakeNpm = path.join(dir, "npm");
    await fs.writeFile(
      fakeNode,
      '#!/usr/bin/env bash\nif [[ "${1:-}" == "-v" ]]; then echo v20.19.0; exit 0; fi\nexit 1\n',
      "utf8"
    );
    await fs.writeFile(fakeNpm, '#!/usr/bin/env bash\nexit 0\n', "utf8");
    await fs.chmod(fakeNode, 0o755);
    await fs.chmod(fakeNpm, 0o755);
    const result = runBash(
      'set -Eeuo pipefail; DEPLOY_TEST_MODE=1; source scripts/lib/deploy-common.sh; validate_node_version',
      { PATH: `${dir}:${process.env.PATH}` }
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Node\.js >=22 LTS is required/i);
    assert.match(result.stderr, /v20\.19\.0/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("production rejects a Node 22 runtime that is only available from a user-local PATH", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fivem-user-node-"));
  try {
    const fakeNode = path.join(dir, "node");
    const fakeNpm = path.join(dir, "npm");
    await fs.writeFile(
      fakeNode,
      '#!/usr/bin/env bash\nif [[ "${1:-}" == "-v" ]]; then echo v22.20.0; exit 0; fi\nif [[ "${1:-}" == "-e" ]]; then exit 0; fi\nexit 0\n',
      "utf8"
    );
    await fs.writeFile(fakeNpm, '#!/usr/bin/env bash\nexit 0\n', "utf8");
    await fs.chmod(fakeNode, 0o755);
    await fs.chmod(fakeNpm, 0o755);

    const result = runBash(
      'set -Eeuo pipefail; DEPLOY_TEST_MODE=0; SYSTEMD_PATH=/usr/local/bin:/usr/bin:/bin; source scripts/lib/deploy-common.sh; validate_node_version',
      { PATH: `${dir}:${process.env.PATH}` }
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /systemd service Node|system-wide|user-local\/nvm/i);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("first production-install pass creates protected env template and exits without switching release", async () => {
  const h = await createDeployHarness();
  try {
    const envFile = path.join(h.configDir, "bot.env");
    await fs.rm(envFile);
    const result = h.runScript("install.sh", [], { RELEASE_ID: "first-config-pass" });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /Created .*bot\.env/i);
    assert.equal((await fs.stat(envFile)).mode & 0o777, 0o640);
    await assert.rejects(fs.lstat(path.join(h.appRoot, "current")));
  } finally {
    await h.cleanup();
  }
});

test("installer removes orphan staging from an interrupted prior run after acquiring the lock", async () => {
  const h = await createDeployHarness({ existing: true });
  try {
    const stale = path.join(h.appRoot, "releases", ".staging-killed-run-1234");
    await fs.mkdir(stale, { recursive: true });
    await fs.writeFile(path.join(stale, "partial"), "partial", "utf8");
    const result = h.runScript("install.sh", [], { RELEASE_ID: "after-interruption" });
    assert.equal(result.status, 0, result.stderr);
    await assert.rejects(fs.access(stale));
    assert.equal(path.basename(await h.currentRelease()), "after-interruption");
  } finally {
    await h.cleanup();
  }
});
