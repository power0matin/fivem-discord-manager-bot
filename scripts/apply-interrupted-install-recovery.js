"use strict";

const fs = require("node:fs");
const file = "scripts/install.sh";
let text = fs.readFileSync(file, "utf8");
const marker = 'log "Removed stale installer staging directory:';
if (text.includes(marker)) {
  console.log("Interrupted install recovery already applied.");
  process.exit(0);
}
const from = `acquire_deploy_lock

if ! is_test_mode; then`;
const to = `acquire_deploy_lock

# A killed installer may leave only staging directories behind. Because this
# process owns the deployment lock, no live installer can legitimately own them.
for stale_staging in "$RELEASES_DIR"/.staging-*; do
  [[ -d "$stale_staging" ]] || continue
  safe_remove_tree "$stale_staging" "$RELEASES_DIR"
  log "Removed stale installer staging directory: $stale_staging"
done

if ! is_test_mode; then`;
if (!text.includes(from)) throw new Error("install.sh: interrupted recovery patch target not found");
text = text.replace(from, to);
fs.writeFileSync(file, text);
console.log("Interrupted install recovery applied.");
