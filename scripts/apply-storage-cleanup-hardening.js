"use strict";

const fs = require("node:fs");
const file = "src/modules/stream-notifier/storage.js";
let text = fs.readFileSync(file, "utf8");
const from = `  } catch (err) {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
}`;
const to = `  } catch (err) {
    if (handle) {
      try {
        await handle.close();
      } catch (cleanupErr) {
        console.error("[Storage] Failed to close temporary persistence file:", cleanupErr?.message ?? cleanupErr);
      }
    }
    try {
      await fs.unlink(tmpPath);
    } catch (cleanupErr) {
      if (cleanupErr?.code !== "ENOENT") {
        console.error("[Storage] Failed to remove temporary persistence file:", cleanupErr?.message ?? cleanupErr);
      }
    }
    throw err;
  }
}`;
if (!text.includes(from)) {
  if (text.includes("Failed to close temporary persistence file")) {
    console.log("Storage cleanup hardening already applied.");
    process.exit(0);
  }
  throw new Error("storage cleanup patch target not found");
}
text = text.replace(from, to);
fs.writeFileSync(file, text);
console.log("Storage cleanup hardening applied.");
