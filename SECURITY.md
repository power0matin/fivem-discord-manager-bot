# Security Policy

## Reporting a Vulnerability

If you find a security issue (token leak, auth bypass, etc.), please **do not** open a public issue.
Instead, contact the maintainer privately and rotate the affected tokens immediately.

Contact: [me@matinshahabadi.ir](mailto:me@matinshahabadi.ir)

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.0.x   | Yes                |
| 1.x.x   | No                 |

## Security Best Practices

### Token Safety

- Never commit `.env` or any secrets to version control.
- Rotate Discord/Twitch/Kick tokens if you suspect a leak.
- Use environment variables or a secrets manager in production.

### Bot Permissions

Follow the principle of least privilege:

- **Minimum required**: View Channel, Send Messages, Embed Links, Read Message History
- **Tickets**: Add Manage Channels, Manage Messages
- **Stream Notifier**: Add Manage Messages, Mention Everyone (if using @here)
- **Welcome**: Add Manage Roles (if using auto-role)
- **FiveM Status**: Add Manage Channels (voice status), Manage Events (scheduled events)

### Discord Intents

- **Message Content Intent**: Required for prefix commands. Not needed if using slash commands only.
- **Server Members Intent**: Required for welcome auto-role and role management features.

### Data Storage

- `data.json` stores runtime configuration and state. It is gitignored by default.
- Never share `data.json` publicly -- it may contain channel IDs, message IDs, and operational state.
- Back up `data.json` before major changes.

### API Credentials

- Twitch and Kick credentials are used only for server-side API calls.
- Tokens are never logged or exposed in embeds/messages.
- Token refresh happens in-memory only; refreshed tokens are not persisted.

## Dependency Security

- Keep Node.js updated (18+ required).
- Run `npm audit` periodically to check for vulnerable dependencies.
- The bot uses minimal dependencies: `discord.js`, `axios`, `dotenv`.
