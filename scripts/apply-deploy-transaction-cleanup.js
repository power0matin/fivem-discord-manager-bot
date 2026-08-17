"use strict";

const fs = require("node:fs");

function patch(file, from, to, label) {
  let text = fs.readFileSync(file, "utf8");
  if (!text.includes(from)) {
    if (text.includes(to)) return;
    throw new Error(`${file}: missing ${label}`);
  }
  text = text.replace(from, to);
  fs.writeFileSync(file, text);
}

patch(
  "scripts/install.sh",
  `  if [[ -n "$service_backup" && -f "$service_backup" ]]; then
    rm -f -- "$service_backup"
  fi
  if (( rc != 0 && transaction_started == 1 && install_succeeded == 0 )); then
    rollback_install
  fi
  return "$rc"`,
  `  if (( rc != 0 && transaction_started == 1 && install_succeeded == 0 )); then
    rollback_install
  fi
  if [[ -n "$service_backup" && -f "$service_backup" ]]; then
    rm -f -- "$service_backup"
  fi
  return "$rc"`,
  "service backup rollback ordering"
);

patch(
  "scripts/restore.sh",
  `had_original=0
safety_backup=""
if [[ -f "$DATA_FILE" ]]; then
  had_original=1
  safety_backup="$(DATA_FILE="$DATA_FILE" BACKUP_DIR="$BACKUP_DIR" DEPLOY_TEST_MODE="$DEPLOY_TEST_MODE" SERVICE_USER="$SERVICE_USER" SERVICE_GROUP="$SERVICE_GROUP" bash "$SCRIPT_DIR/backup.sh")"
  [[ -f "$safety_backup" && -f "$safety_backup.sha256" ]] || die "Failed to create verified pre-restore safety backup."
fi`,
  `service_stopped_for_restore=0
if (( service_present == 1 && service_was_active == 1 )); then
  systemctl stop "$SERVICE_NAME"
  service_stopped_for_restore=1
fi

had_original=0
safety_backup=""
if [[ -f "$DATA_FILE" ]]; then
  had_original=1
  if ! safety_backup="$(DATA_FILE="$DATA_FILE" BACKUP_DIR="$BACKUP_DIR" DEPLOY_TEST_MODE="$DEPLOY_TEST_MODE" SERVICE_USER="$SERVICE_USER" SERVICE_GROUP="$SERVICE_GROUP" bash "$SCRIPT_DIR/backup.sh")"; then
    if (( service_stopped_for_restore == 1 )); then systemctl start "$SERVICE_NAME"; fi
    die "Failed to create pre-restore safety backup."
  fi
  if [[ ! -f "$safety_backup" || ! -f "$safety_backup.sha256" ]]; then
    if (( service_stopped_for_restore == 1 )); then systemctl start "$SERVICE_NAME"; fi
    die "Failed to create verified pre-restore safety backup."
  fi
fi`,
  "freeze service before safety backup"
);

patch(
  "scripts/restore.sh",
  `if (( service_present == 1 && service_was_active == 1 )); then
  systemctl stop "$SERVICE_NAME"
fi

mv -f -- "$tmp_file" "$DATA_FILE"`,
  `mv -f -- "$tmp_file" "$DATA_FILE"`,
  "remove duplicate restore stop"
);

console.log("Final deploy transaction corrections applied.");
