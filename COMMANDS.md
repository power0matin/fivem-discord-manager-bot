# Command Reference (Discord Stream Notifier Bot)

This file is a quick cheat sheet for the bot’s currently supported commands.

> Note: The command prefix defaults to `.` and can be changed via `PREFIX` in your `.env`.

## Permissions

- If `ALLOWED_ROLE_IDS` is set, only users who have **at least one** of those roles can run admin commands.
- If `ALLOWED_ROLE_IDS` is empty, the fallback requirement is the **Manage Server** permission (`ManageGuild`).

## Help

### `.<help>`

Shows a short list of commands in Discord.

**Example**

- `.help`

## Manual Scan

### `.<tick>`

Runs an immediate scan (Kick + Twitch).

**Example**

- `.tick`

## Kick Commands

> All Kick commands are admin commands (permission required).

### 1) List

#### `.<k list>`

Shows the configured Kick streamers.

**Example**

- `.k list`

### 2) Add

#### `.<k add <kickSlug> [@discordUser|discordUserId]>`

Adds a Kick streamer by `slug`. If you provide `@user` or a numeric `userId`, the bot will mention that user in the LIVE alert message.

**Shortcut**

- `.k <kickSlug> [@discordUser|discordUserId]`

**Examples**

- `.k add amirjavankabir`
- `.k add amirjavankabir @Matin`
- `.k amirjavankabir 123456789012345678`

### 3) Remove

#### `.<k remove <kickSlug>>`

Removes the streamer from the list and (if there is an active LIVE message) also tries to delete it.

**Example**

- `.k remove amirjavankabir`

### 4) Status (Debug)

#### `.<k status <kickSlug>>`

Debug command: shows whether the streamer is live and whether it matches the current filters (Category and Regex).

**Example**

- `.k status amirjavankabir`

## Twitch Commands

> All Twitch commands are admin commands (permission required).

### 1) List

#### `.<t list>`

Shows the configured Twitch streamers.

**Example**

- `.t list`

### 2) Add

#### `.<t add <twitchLogin> [@discordUser|discordUserId]>`

Adds a Twitch streamer by `login`. If you provide `@user` or a numeric `userId`, the bot will mention that user in the LIVE alert message.

**Shortcut**

- `.t <twitchLogin> [@discordUser|discordUserId]`

**Examples**

- `.t add shroud`
- `.t add shroud @Matin`
- `.t shroud 123456789012345678`

### 3) Remove

#### `.<t remove <twitchLogin>>`

Removes the streamer from the list and (if there is an active LIVE message) also tries to delete it.

**Example**

- `.t remove shroud`

### 4) Status (Debug)

#### `.<t status <twitchLogin>>`

Debug command: shows whether the streamer is live and whether it matches the current filters (GameId and Regex).

**Example**

- `.t status shroud`

## Practical Notes

### Mention formats supported

To map a streamer to a Discord user, the bot supports:

1. A real Discord mention (autocomplete)
2. Pasting `<@123>` or `<@!123>`
3. A numeric user ID (`123...`)

### Limitations

- In the current version, settings like `MENTION_HERE`, `KEYWORD_REGEX`, and `CHECK_INTERVAL_SECONDS` are controlled via `.env`. There are no Discord commands to change them at runtime.
