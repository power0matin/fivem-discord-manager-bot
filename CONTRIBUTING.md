# Contributing

Thanks for contributing!

## Guidelines

- Keep the bot lightweight (avoid heavy global scans by default).
- Do **not** add features that require storing user tokens/secrets in the repo.
- Make sure `.env` / `data.json` are never committed.
- Prefer small PRs with a clear description.

## Development

```bash
npm install
cp .env.example .env
npm start
```

## Pull Request checklist

- [ ] I tested the bot locally.
- [ ] I didn't commit any secrets.
- [ ] I updated README if needed.
