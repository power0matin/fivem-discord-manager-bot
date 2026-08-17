# FiveM Discord Manager Bot

<!-- repo-badges:start -->
<p align="center">
  <a href="https://hits.sh/github.com/power0matin/fivem-discord-manager-bot/"><img src="https://hits.sh/github.com/power0matin/fivem-discord-manager-bot.svg?style=flat-square&amp;label=Views&amp;labelColor=18181B&amp;color=0EA5E9&amp;logo=github" alt="Repository Views"/></a>
  <a href="https://github.com/power0matin/fivem-discord-manager-bot/stargazers"><img src="https://img.shields.io/github/stars/power0matin/fivem-discord-manager-bot?style=flat-square&amp;label=Stars&amp;labelColor=18181B&amp;color=F59E0B&amp;logo=github&amp;logoColor=white" alt="GitHub Stars"/></a>
  <a href="https://github.com/power0matin/fivem-discord-manager-bot/forks"><img src="https://img.shields.io/github/forks/power0matin/fivem-discord-manager-bot?style=flat-square&amp;label=Forks&amp;labelColor=18181B&amp;color=6366F1&amp;logo=github&amp;logoColor=white" alt="GitHub Forks"/></a>
  <a href="https://github.com/power0matin/fivem-discord-manager-bot/issues"><img src="https://img.shields.io/github/issues/power0matin/fivem-discord-manager-bot?style=flat-square&amp;label=Issues&amp;labelColor=18181B&amp;color=22C55E&amp;logo=github&amp;logoColor=white" alt="GitHub Issues"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/power0matin/fivem-discord-manager-bot?style=flat-square&amp;label=License&amp;labelColor=18181B&amp;color=EF4444&amp;logo=github&amp;logoColor=white" alt="GitHub License"/></a>
</p>
<!-- repo-badges:end -->

A modular Discord bot for FiveM communities with Twitch/Kick stream notifications, FiveM server status, private support tickets, welcome/goodbye automation, anti-raid protection, roles, server statistics, and restart events.

## Requirements

- Node.js **22+**
- npm with the committed `package-lock.json`
- A Discord application and bot token
- Linux with **systemd** for the supported production deployment scripts
- Root access for production install/update/restore/uninstall operations

The runtime requests these Discord privileged intents and they must be enabled on the **Developer Portal → Bot** page:

- **Message Content Intent** — prefix commands / optional ticket text commands
- **Server Members Intent** — welcome, member lookup, role management
- **Presence Intent** — `{online}` server-stat placeholder

Recommended bot permissions depend on enabled modules:

- Baseline: View Channels, Send Messages, Embed Links, Read Message History
- Tickets: **Manage Channels + Manage Roles** (required for private overwrites), Manage Messages
- Stream live role / welcome auto-role: Manage Roles and correct role hierarchy
- Anti-raid: **Kick Members**
- Ticket voice move: Move Members
- Stream notification cleanup: Manage Messages
- `@here`: Mention Everyone
- Voice status/stat channels: Manage Channels
- Scheduled restart events: Manage Events

## Clean install (development/manual)

```bash
git clone https://github.com/power0matin/fivem-discord-manager-bot.git
cd fivem-discord-manager-bot
npm ci
cp .env.example .env
```

Fill at least:

```env
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
```

Optional IDs and platform credentials in `.env.example` are intentionally blank. Do not leave placeholder IDs or fake credentials.

Register slash commands:

```bash
npm run slash:register
```

For development, set `DISCORD_GUILD_ID` so commands appear in one guild immediately.

Start:

```bash
npm start
```

The first successful run creates `data.json`. Runtime configuration is then persisted there; `.env` supplies secrets and first-run defaults unless `ENV_OVERRIDES_DB=true`.

## Verification

```bash
npm ci
npm audit --audit-level=high
npm run lint
npm test
npm run verify
npm run check:syntax
```

The test suite covers configuration validation, Discord permission failure paths, ticket recovery, persistence corruption and stress, process lifecycle, installer/update transactions, systemd policy, readiness, and backup/restore rollback behavior.

## Configuration

### Required runtime

| Variable | Purpose |
|---|---|
| `DISCORD_TOKEN` | Discord bot token (secret) |

### Slash registration

| Variable | Purpose |
|---|---|
| `DISCORD_CLIENT_ID` | Discord application ID |
| `DISCORD_GUILD_ID` | Optional development guild ID |

### Runtime defaults / authorization

| Variable | Default | Purpose |
|---|---:|---|
| `DISCORD_NOTIFY_CHANNEL_ID` | empty | Stream notification channel default |
| `PREFIX` | `.` | Legacy prefix |
| `MENTION_HERE` | `true` | Allow notifier `@here` |
| `KEYWORD_REGEX` | `nox\s*rp` | Stream title filter; unsafe nested-quantifier regexes are rejected |
| `CHECK_INTERVAL_SECONDS` | `60` | Stream polling, 10..3600 |
| `ENV_OVERRIDES_DB` | `false` | Force ENV defaults over persisted settings at startup |
| `ALLOWED_ROLE_IDS` | empty | Comma-separated admin roles; empty falls back to Manage Server |
| `STREAMER_LIVE_ROLE_ID` | empty | Optional live-streamer role |

### Discovery / platform credentials

`TWITCH_CLIENT_ID` + `TWITCH_CLIENT_SECRET` enable Twitch. `KICK_CLIENT_ID` + `KICK_CLIENT_SECRET` enable Kick. Leaving them blank disables that platform cleanly.

### Persistence

| Variable | Purpose |
|---|---|
| `DATA_DIR` | Optional data directory; default is current working directory |
| `DATA_FILE` | Optional absolute database path; overrides `DATA_DIR` |
| `TZ` | Optional process timezone used for configured FiveM restart clock times |

`data.json` is written through a bounded/coalescing serialized atomic writer. Burst mutations share a small write backlog rather than creating an unbounded promise chain. Before replacing an existing database, the previous valid file is copied to `data.json.bak` and parsed for verification. The temporary file is fsynced before rename. Corrupt JSON fails closed and is **not** replaced by an empty database.

## Features and commands

### Stream notifier

Use `/setup wizard` for the notifier configuration. Legacy prefix operations remain available (`.config`, `.health`, `.tick`, `.k ...`, `.t ...`). Twitch/Kick calls use request timeouts and runtime backoff.

### FiveM

```text
/fivem toggle
/fivem set-endpoint
/fivem set-channel
/fivem set-interval
/fivem set-title
/fivem set-description
/fivem set-banner
/fivem set-website
/fivem set-connect
/fivem set-connect-command
/fivem set-restart-times
/fivem set-voice-status
/fivem set-scheduled-events
/fivem status
/fivem show
```

FiveM endpoints must return JSON with recognizable FiveM structure. Generic HTTP 200 pages are not treated as an online server. Scheduled-event state is committed only after Discord confirms event creation and persistence succeeds.

### Tickets

Tickets support multiple types. Current configuration commands are:

```text
/tickets toggle
/tickets set-log-channel
/tickets clear-log-channel
/tickets panel
/tickets type-add
/tickets type-remove
/tickets type-list
/tickets type-set-category
/tickets type-staff-role
/tickets type-mention-role
/tickets type-set-voice
/tickets claim
/tickets assign
/tickets unassign
/tickets close
/tickets show
```

Ticket channels are private from the first Discord API request. Creation fails before channel creation if required permissions or configured staff-role hierarchy are unsafe. If permission setup or persistence fails after creation, the temporary channel is removed; if Discord also rejects cleanup, the still-private channel is tracked as `recovery_required` so startup reconciliation can clean it deterministically. Concurrent creation for the same user/type is serialized.

### Welcome / anti-raid / stats

```text
/welcome toggle
/welcome set-channel
/welcome set-title
/welcome set-message
/welcome set-buttons
/welcome set-color
/welcome set-banner
/welcome set-dm
/welcome set-role
/welcome set-anti-raid
/welcome set-goodbye
/welcome set-goodbye-message
/welcome set-stats
/welcome set-log-channel
/welcome test
/welcome show
```

Button URLs must use HTTP/HTTPS. Anti-raid only reports a kick after Discord confirms it. `{online}` requires Presence Intent.

## Production deployment (systemd)

The supported production layout keeps immutable releases, configuration, persistent state and verified backups separate:

```text
/opt/fivem-discord-manager-bot/releases/...   immutable application releases
/opt/fivem-discord-manager-bot/current        active release symlink
/etc/fivem-discord-manager-bot/bot.env        secrets/config
/var/lib/fivem-discord-manager-bot/data.json  persistent state
/var/backups/fivem-discord-manager-bot/       verified backups
```

The production scripts intentionally reject unsupported non-Linux/non-systemd environments and require Node.js 22+.

### First installation

From a trusted checkout:

```bash
sudo bash scripts/install.sh
```

On a fresh host, the first invocation creates `/etc/fivem-discord-manager-bot/bot.env` with mode `0640` and exits with status `2` **before switching any release**. Fill the real credentials without placing them in shell history:

```bash
sudoedit /etc/fivem-discord-manager-bot/bot.env
```

Then rerun:

```bash
sudo bash scripts/install.sh
```

A successful installation:

1. checks root, Linux/systemd, Node/npm and required tools,
2. creates or validates the dedicated `fivembot` account/group,
3. verifies directory and secret-file permissions,
4. removes orphan `.staging-*` directories left by an interrupted installer after acquiring the deployment lock,
5. creates a verified pre-install backup when replacing an existing managed install,
6. stages a new immutable release and runs `npm ci --omit=dev --ignore-scripts`, syntax/config/unit validation,
7. validates the version-controlled systemd unit,
8. atomically switches `current`,
9. restarts the service and waits for readiness,
10. creates the managed-install sentinel only after success.

If a failure occurs after transaction start, the installer restores the previous symlink and systemd unit, restores the prior active/inactive service state, and removes the failed release. A readiness failure is an installation failure.

Expected permissions in production:

```text
/etc/fivem-discord-manager-bot/bot.env        root:fivembot 0640
/var/lib/fivem-discord-manager-bot            fivembot:fivembot 0700
/var/lib/fivem-discord-manager-bot/data.json  fivembot:fivembot 0600
/var/backups/fivem-discord-manager-bot         root:root 0700
```

Useful commands:

```bash
sudo systemctl status fivem-discord-manager-bot --no-pager -l
sudo journalctl -u fivem-discord-manager-bot -f
sudo -u fivembot env DATA_FILE=/var/lib/fivem-discord-manager-bot/data.json \
  node /opt/fivem-discord-manager-bot/current/scripts/healthcheck.js
```

The unit uses `network-online.target`, a dedicated unprivileged account, `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome=true`, private devices/tmp, a restrictive `UMask`, an empty capability set, and write access limited to the state directory.

## Backup and restore

Create and verify a backup:

```bash
sudo DATA_FILE=/var/lib/fivem-discord-manager-bot/data.json \
  BACKUP_DIR=/var/backups/fivem-discord-manager-bot \
  bash /opt/fivem-discord-manager-bot/current/scripts/backup.sh
```

Backup filenames use `mktemp` entropy in addition to a UTC timestamp, so rapid successive backups cannot overwrite one another. Each backup is JSON-validated, fsynced, mode `0600`, and accompanied by a SHA-256 sidecar outside the release tree.

Restore:

```bash
sudo bash /opt/fivem-discord-manager-bot/current/scripts/restore.sh \
  /var/backups/fivem-discord-manager-bot/data-<timestamp>-<random>.json
```

Restore takes the shared deployment lock, verifies checksum and JSON **before** touching live data, stops an active service before taking the safety snapshot, creates a verified pre-restore backup, atomically replaces data, restores mode/ownership, restarts, and waits for readiness. If post-swap validation/readiness fails, the safety backup is restored. A failed restore never intentionally treats the replacement as success.

## Update and rollback

Prepare a trusted checkout of the target version and run:

```bash
sudo SOURCE_DIR=/path/to/new/checkout bash /path/to/new/checkout/scripts/update.sh
```

Updater behavior:

```text
atomic flock
→ validate managed installation
→ hash current data
→ verified external data backup
→ stage/install new release
→ atomic symlink switch
→ restart
→ readiness check
→ validate persistence
```

Only one install/update/restore transaction can own the deployment lock. A stale lock **file** does not block a later update because lock ownership is held by the kernel with `flock`.

If the new release fails before the switch (for example `npm ci` fails), the old release remains active. If failure happens after the switch/readiness attempt, installer rollback restores the prior code/unit; the updater additionally compares the live data hash and restores the verified pre-update backup if the failed release changed persistent state. The previous release must pass readiness before rollback is considered healthy.

## Uninstall

Default uninstall preserves data and the service account:

```bash
sudo bash /opt/fivem-discord-manager-bot/current/scripts/uninstall.sh
```

To explicitly remove `/var/lib/fivem-discord-manager-bot` and the dedicated account too:

```bash
sudo bash /opt/fivem-discord-manager-bot/current/scripts/uninstall.sh --purge-data
```

The uninstaller requires exact production paths plus a valid `/opt/fivem-discord-manager-bot/.managed-install` sentinel. It refuses arbitrary/shared paths. External backups are intentionally preserved.

## Recovery and troubleshooting

### Bot exits immediately

```bash
sudo journalctl -u fivem-discord-manager-bot -n 100 --no-pager
```

Configuration errors are fail-fast. Invalid booleans, intervals, snowflakes, placeholder IDs and unsafe regexes produce explicit startup errors.

### Production install fails readiness

The installer returns a non-zero status and attempts to restore the previous managed release. Inspect:

```bash
readlink -f /opt/fivem-discord-manager-bot/current
sudo systemctl status fivem-discord-manager-bot --no-pager -l
sudo journalctl -u fivem-discord-manager-bot -n 200 --no-pager
```

Do not delete `/var/lib/fivem-discord-manager-bot` while diagnosing an update or restore failure.

### Slash commands do not appear

```bash
npm run slash:list
npm run slash:register
```

Use `DISCORD_GUILD_ID` during development and ensure the bot invite includes `bot` and `applications.commands` scopes.

### Tickets fail to create

Verify **Manage Channels + Manage Roles** and that every configured staff role is below the bot's highest role. Unsafe hierarchy/permission state fails closed; it does not intentionally create a public fallback channel.

### Server stats do not update

Verify the configured channel is a voice channel, the bot has Manage Channels, and Presence Intent is enabled if the format contains `{online}`.

### FiveM scheduled events do not appear

Configure a status channel and restart times, enable scheduled events, and grant Manage Events.

## CI

The version-controlled CI is read-only and gates pull requests on:

```text
npm ci
npm audit --audit-level=high
npm run lint
npm test
npm run verify
npm run check:syntax
ShellCheck
systemd-analyze verify
deployment/backup/restore/systemd tests
persistence stress tests
git diff --check
clean git status
```

CI covers Node.js 22 and 24. A green CI run is an internal Source/Repository gate; a real Ubuntu/systemd + Discord smoke test is still required before declaring a release Production Ready.

## Security

Never commit `.env`, `data.json`, tokens, backups, runtime logs, temporary persistence files, or generated deployment state. See [SECURITY.md](SECURITY.md) for reporting policy.

## License

MIT — see [LICENSE](LICENSE).
