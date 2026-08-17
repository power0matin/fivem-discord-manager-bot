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

- Node.js **18.17+** (Node 20/22 recommended)
- npm with the committed `package-lock.json`
- A Discord application and bot token
- Linux + systemd for the production deployment scripts

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
npm run check:syntax
npm test
npm audit --audit-level=high
```

The test suite covers persistence concurrency/corruption, legacy migration, configuration validation, pathological regex rejection, process lifecycle, readiness, and backup/restore behavior.

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

`data.json` is written through a serialized atomic writer. Before replacing an existing database, the previous valid file is copied to `data.json.bak` and parsed for verification. Corrupt JSON fails closed and is **not** replaced by an empty database.

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

FiveM endpoints must return JSON with recognizable FiveM structure. Generic HTTP 200 pages are not treated as an online server.

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

Ticket channels are created private from the first Discord API request. Creation fails if the bot cannot safely apply permission overwrites. Concurrent creation for the same user/type is serialized, and persistent ticket state is reconciled with Discord after restart.

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

The supported production layout keeps releases separate from persistent state:

```text
/opt/fivem-discord-manager-bot/releases/...   immutable application releases
/opt/fivem-discord-manager-bot/current        active release symlink
/etc/fivem-discord-manager-bot/bot.env        secrets/config
/var/lib/fivem-discord-manager-bot/data.json  persistent state
/var/backups/fivem-discord-manager-bot/       verified backups
```

From a trusted checkout:

```bash
sudo ./scripts/install.sh
```

On the first run, the installer creates `/etc/fivem-discord-manager-bot/bot.env` and exits so you can fill the real token. Then run it again. The installer:

1. validates Node/npm/systemd prerequisites,
2. installs with `npm ci --omit=dev`,
3. installs the version-controlled hardened systemd unit,
4. enables reboot startup,
5. starts the service,
6. waits for `scripts/healthcheck.js` to confirm a real runtime tick.

Useful commands:

```bash
systemctl status fivem-discord-manager-bot
journalctl -u fivem-discord-manager-bot -f
DATA_FILE=/var/lib/fivem-discord-manager-bot/data.json node /opt/fivem-discord-manager-bot/current/scripts/healthcheck.js
```

The unit runs as dedicated user `fivembot`, uses `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome=true`, a restrictive `UMask`, and only grants write access to the data directory.

## Backup and restore

Create and verify a backup:

```bash
sudo DATA_FILE=/var/lib/fivem-discord-manager-bot/data.json ./scripts/backup.sh
```

Backups are stored outside the release tree and get a SHA-256 sidecar.

Restore:

```bash
sudo ./scripts/restore.sh /var/backups/fivem-discord-manager-bot/data-YYYYMMDDTHHMMSSZ.json
```

Restore validates JSON/checksum, backs up current state first, stops the service if installed, performs an atomic replacement, then restarts it.

## Update and rollback

Prepare a trusted checkout of the target version and run:

```bash
sudo SOURCE_DIR=/path/to/new/checkout ./scripts/update.sh
```

Updater behavior:

```text
atomic flock
→ validate managed installation
→ verified external data backup
→ install a new immutable release with npm ci
→ switch current symlink
→ restart
→ readiness check
```

If installation/readiness fails, the updater restores the previous release symlink and restarts it. Persistent state is outside the release directory, and the pre-update data backup remains available for explicit restore.

## Uninstall

Default uninstall preserves data:

```bash
sudo ./scripts/uninstall.sh
```

To explicitly remove `/var/lib/fivem-discord-manager-bot` too:

```bash
sudo ./scripts/uninstall.sh --purge-data
```

The uninstaller requires exact expected paths and refuses arbitrary install/data/config paths. External backups are intentionally preserved.

## Recovery and troubleshooting

### Bot exits immediately

Check:

```bash
journalctl -u fivem-discord-manager-bot -n 100 --no-pager
```

Configuration errors are fail-fast. Invalid booleans, intervals, snowflakes, placeholder IDs and unsafe regexes produce explicit startup errors.

### Slash commands do not appear

```bash
npm run slash:list
npm run slash:register
```

Use `DISCORD_GUILD_ID` during development and ensure the bot invite includes `bot` and `applications.commands` scopes.

### Tickets fail to create

Verify **Manage Channels + Manage Roles** and role hierarchy. A ticket is not accepted unless private permission overwrites can be applied.

### Server stats do not update

Verify the configured channel is a voice channel, the bot has Manage Channels, and Presence Intent is enabled if the format contains `{online}`.

### FiveM scheduled events do not appear

Configure a status channel and restart times, enable scheduled events, and grant Manage Events.

## CI

GitHub Actions runs clean `npm ci`, syntax checks, the Node test suite, and `npm audit --audit-level=high` across supported Node versions. Shell deployment scripts are also syntax/ShellCheck candidates in CI.

## Security

Never commit `.env`, `data.json`, tokens, backups, or runtime logs. See [SECURITY.md](SECURITY.md) for reporting policy.

## License

MIT — see [LICENSE](LICENSE).
