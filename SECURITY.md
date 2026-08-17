# Security Policy

## Supported versions

| Version | Status |
|---|---|
| 2.1.x | Supported |
| 2.0.x | Security fixes only |
| 1.x | Unsupported |

## Reporting a vulnerability

Do not open a public issue for token leakage, permission bypasses, private-ticket disclosure, data corruption, or other security-sensitive findings. Contact the maintainer privately at `me@matinshahabadi.ir`. If a credential may have leaked, revoke/rotate it immediately; do not wait for a code fix.

## Security model

Secrets belong in environment configuration, not `data.json` or source control. `.env`, runtime databases, atomic temporary files and local backups are ignored by Git.

The production systemd unit runs as a dedicated unprivileged account with a read-only application tree. Persistent writes are restricted to `/var/lib/fivem-discord-manager-bot`.

### Discord permissions

Use least privilege, but do not omit permissions required to enforce a security boundary:

- Tickets require **Manage Channels and Manage Roles** so private channel overwrites can be applied atomically. Ticket creation fails rather than creating a public fallback channel.
- Anti-raid requires **Kick Members**. The bot only records a kick as successful after Discord confirms it.
- Auto-role/live-role features require Manage Roles and correct role hierarchy.
- Ticket voice move requires Move Members.
- Scheduled restart events require Manage Events.

### Privileged intents

The current runtime requests Message Content, Server Members and Presence intents. Enable all three in the Discord Developer Portal before production startup. Presence is used for the `{online}` server-stat placeholder.

### Persistence

`data.json` is operationally sensitive and may contain Discord IDs and runtime state. The persistence layer:

- serializes concurrent writes,
- writes to a unique mode-0600 temporary file,
- fsyncs before replacement,
- verifies a backup of the previous valid database,
- fails closed on corrupt JSON instead of replacing it with defaults.

Use `scripts/backup.sh` and `scripts/restore.sh` for verified operational backups. Backups are stored outside the release directory in the production layout.

### Dependencies

Pull requests must use the committed lockfile and CI must run:

```bash
npm ci
npm run verify
npm audit --audit-level=high
```

High/critical advisories are release blockers unless a documented reachability analysis and explicit maintainer decision says otherwise.

### Logs

Do not log raw Discord tokens, Twitch/Kick client secrets, OAuth access tokens, `.env` content, or backup file content. Error logs should include component/context without secret material.
