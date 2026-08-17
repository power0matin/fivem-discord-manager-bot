# Contributing

Thanks for contributing!

## Guidelines

- Use Node.js **22+**.
- Keep the bot lightweight and avoid unbounded hot-path work.
- Do **not** add features that require storing user tokens/secrets in the repository.
- Never commit `.env`, `data.json`, backups, logs, deployment locks or generated runtime state.
- Prefer small PRs with a clear description and regression tests for behavior changes.
- Follow the existing CommonJS style and keep error handling explicit; do not hide failures to make CI green.
- Changes to persistence, tickets, deployment, backup/restore or permissions require failure-path tests.

## Development

```bash
npm ci
cp .env.example .env
# Fill .env with development credentials
npm run start
```

For development with auto-reload:

```bash
npm run dev
```

Before submitting:

```bash
npm ci
npm audit --audit-level=high
npm run lint
npm test
npm run verify
npm run check:syntax
git diff --check
```

If deployment scripts change, also run ShellCheck and the deployment tests on Linux:

```bash
shellcheck scripts/*.sh scripts/lib/*.sh
systemd-analyze verify deploy/fivem-discord-manager-bot.service
node --test \
  test/deployment.test.js \
  test/deployment-transaction.test.js \
  test/backup-restore-hardening.test.js \
  test/installation-preflight.test.js \
  test/systemd-unit.test.js \
  test/storage-stress.test.js
```

## Slash Commands

When adding or modifying slash commands:

1. Update command definitions in the appropriate `slash/commands.js` file.
2. Update `COMMANDS.md` and README when user-facing behavior changes.
3. Run `npm run slash:register` against a development application/guild.
4. Test both guild-scoped and global registration where relevant.

## Project Structure

```text
src/
  index.js
  hardening/runtime.js
  modules/
    stream-notifier/
      index.js
      config.js
      storage.js
      validation.js
      kick.js
      twitch.js
      streamerRole.js
      slash/
    fivem/
    tickets/
      index.js
      safety.js
    welcome/
scripts/
  lib/deploy-common.sh
  install.sh
  update.sh
  backup.sh
  restore.sh
  uninstall.sh
  healthcheck.js
  validate-data.js
test/
  helpers/
  *.test.js
deploy/
  fivem-discord-manager-bot.service
```

## Pull Request checklist

- [ ] Clean `npm ci` succeeds on a supported Node version.
- [ ] `npm audit --audit-level=high` passes.
- [ ] Lint, syntax and full automated tests pass.
- [ ] I added/updated failure-path regression tests when behavior changed.
- [ ] I did not commit secrets or runtime artifacts.
- [ ] I updated README/COMMANDS/SECURITY/CHANGELOG as applicable.
- [ ] Deployment changes pass ShellCheck and `systemd-analyze verify`.
- [ ] Discord-facing changes are smoke-tested with development credentials before release.
