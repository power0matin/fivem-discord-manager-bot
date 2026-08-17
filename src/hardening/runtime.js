"use strict";

const { flushDb } = require("../modules/stream-notifier/storage");

let shutdownPromise = null;
let installed = false;

async function gracefulShutdown(signal, exitCode = 0) {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    try {
      await flushDb();
    } catch (err) {
      console.error(`[Shutdown] persistence flush failed on ${signal}:`, err?.message ?? err);
      exitCode = 1;
    }
    process.exitCode = exitCode;
  })();
  return shutdownPromise;
}

function installProcessGuards() {
  if (installed) return;
  installed = true;

  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.once(signal, () => {
      gracefulShutdown(signal).finally(() => process.exit(process.exitCode || 0));
    });
  }

  process.prependListener("unhandledRejection", (reason) => {
    console.error("[Fatal:UnhandledRejection]", reason);
    gracefulShutdown("unhandledRejection", 1).finally(() => process.exit(1));
  });

  process.prependListener("uncaughtException", (err) => {
    console.error("[Fatal:UncaughtException]", err);
    gracefulShutdown("uncaughtException", 1).finally(() => process.exit(1));
  });
}

function installRuntimeHardening() {
  installProcessGuards();
}

module.exports = {
  installRuntimeHardening,
  installProcessGuards,
  gracefulShutdown,
};
