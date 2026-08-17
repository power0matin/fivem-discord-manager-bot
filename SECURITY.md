# Security Policy

## Supported versions

| Version | Status |
|---|---|
| 2.1.x | Supported |
| 2.0.x | Security fixes only |
| 1.x | Unsupported |

The supported production runtime is Node.js **22+** with the committed lockfile.

## Reporting a vulnerability

Do not open a public issue for token leakage, permission bypasses, private-ticket disclosure, data corruption, unsafe update/restore behavior, or other security-sensitive findings. Contact the maintainer privately at `me@matinshahabadi.ir`. If a credential may have leaked, revoke/rotate it immediately; do not wait for a code fix.

## Security model

Secrets belong in environment configuration, not `data.json` or source control. `.env`, runtime databases, atomic temporary files and local backups are ignored by Git.

The production systemd unit runs as the dedicated unprivileged `fivembot` account. The application/release tree and configuration are not writable by the service; persistent writes are restricted to `/var/lib/fivem-discord-manager-bot`.

### Discord permissions

Use least privilege, but do not omit permissions required to enforce a security boundary:

- Tickets require **Manage Channels and Manage Roles**. Creation validates configured staff-role hierarchy before creating a channel, applies an `@everyone` View Channel deny in the creation request, and does not acknowledge success until persistent state is saved.
- If private-ticket setup/persistence fails, the channel is deleted. If Discord rejects cleanup too, the still-private channel is tracked as `recovery_required` for startup reconciliation rather than reported as successful.
- Anti-raid requires **Kick Members**. The bot only records a kick as successful after Discord confirms it.
- Auto-role/live-role features require Manage Roles and correct role hierarchy.
- Ticket voice move requires Move Members.
- Scheduled restart events require Manage Events; the success timestamp is committed only after event creation and persistence succeed.

### Privileged intents

The current runtime requests Message Content, Server Members and Presence intents. Enable all three in the Discord Developer Portal before production startup. Presence is used for the `{online}` server-stat placeholder.

### Persistence

`data.json` is operationally sensitive and may contain Discord IDs and runtime state. The persistence layer:

- coalesces burst mutations into a bounded serialized write backlog,
- snapshots state before asynchronous write processing,
- writes to a unique mode-0600 temporary file,
- fsyncs before replacement,
- verifies a backup of the previous valid database,
- reports temporary-file cleanup failures instead of silently discarding them,
- fails closed on corrupt JSON instead of replacing it with defaults,
- remains usable after tested write/fsync/rename failures.

### Production deployment and recovery

Production install/update/restore operations share an atomic `flock` deployment lock. A lock file without a live lock owner is not considered an active update.

- Installer staging is separate from `current`; dependency/syntax/config validation runs before the active symlink switches.
- Reinstall creates a verified backup before replacing a managed release.
- Installer failure after the switch restores the previous symlink, service unit and service active/inactive state.
- Updater hashes current persistence and creates a verified external backup before installing. If a failed new release changed data, rollback restores the verified pre-update data.
- Restore verifies checksum/JSON before touching live data, stops an active service before the safety snapshot, uses an atomic replacement, and restores the safety snapshot if post-swap readiness fails.
- Uninstall requires exact managed paths plus the `.managed-install` sentinel.

Operational backups live under `/var/backups/fivem-discord-manager-bot`, outside `/opt/fivem-discord-manager-bot` so release cleanup cannot remove them.

### systemd sandbox

The version-controlled unit uses `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, private devices/tmp, an empty capability set, restricted address families and a restrictive `UMask`. The only explicit writable application path is the state directory.

Run on the target host before release:

```bash
sudo systemd-analyze verify /etc/systemd/system/fivem-discord-manager-bot.service
sudo systemd-analyze security fivem-discord-manager-bot.service
```

### Dependencies

Pull requests must use the committed lockfile and CI must run:

```bash
npm ci
npm audit --audit-level=high
npm run lint
npm test
npm run verify
```

High/critical advisories are release blockers unless a documented reachability analysis and explicit maintainer decision says otherwise.

### Logs

Do not log raw Discord tokens, Twitch/Kick client secrets, OAuth access tokens, `.env` content, or backup file content. Security-sensitive failures should include component/context without secret material.
