# Contributing

Thanks for contributing!

## Guidelines

- Keep the bot lightweight (avoid heavy global scans by default).
- Do **not** add features that require storing user tokens/secrets in the repo.
- Make sure `.env` / `data.json` are never committed.
- Prefer small PRs with a clear description.
- Follow the existing code style (CommonJS, no semicolons in new files, use `"use strict"`).

## Development

```bash
npm install
cp .env.example .env
# Fill in your .env with valid tokens
npm run start
```

For development with auto-reload:

```bash
npm run dev
```

## Slash Commands

When adding or modifying slash commands:

1. Update the command definitions in the appropriate `slash/commands.js` file
2. Run `npm run slash:register` to register changes
3. Test both guild-scoped (with `DISCORD_GUILD_ID`) and global registration

## Project Structure

```
src/
  index.js                    # Entrypoint
  modules/
    stream-notifier/          # Twitch + Kick stream monitoring
      index.js                # Main module logic
      config.js               # Environment config
      storage.js              # data.json persistence
      validation.js           # Shared validation helpers
      kick.js                 # Kick API client
      twitch.js               # Twitch API client
      streamerRole.js         # Live role management
      ui/embeds.js            # Embed builder system
      slash/
        commands.js           # Slash command definitions
        setup.js              # Interactive setup wizard
        register.js           # Command registration script
    fivem/                    # FiveM server status
      index.js                # Status polling + embed
      slash/commands.js       # Slash command definitions
    tickets/                  # Ticket system
      index.js                # Ticket logic
      slash/commands.js       # Slash command definitions
    welcome/                  # Welcome system
      index.js                # Welcome logic
      slash/commands.js       # Slash command definitions
```

## Pull Request checklist

- [ ] I tested the bot locally.
- [ ] I didn't commit any secrets.
- [ ] I updated README if needed.
- [ ] I updated COMMANDS.md if I added/changed commands.
- [ ] Slash commands register without errors (`npm run slash:register`).
