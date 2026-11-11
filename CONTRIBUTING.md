# Contributing

Thanks for taking the time to help improve **My Bubble** (Minha Bolha).

## Before you start

- The project is licensed under **GPL-3.0-only**. By contributing, you agree that your changes are distributed under the same license.
- For security issues, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
- For large features or behavior changes, open an issue first so the approach can be discussed.

## Development setup

Requirements: Node.js 20+ and npm on Windows.

```bash
npm install
cp .env.example .env   # optional: API keys can also be set in Settings
npm run dev            # API on :4000 + web dev server on :5173
npm run desktop        # build the web app and launch the Electron shell
```

Useful checks before opening a pull request:

```bash
npm run typecheck
npm run check:secrets
npm run dist           # optional: full installer + portable build
```

## Guidelines

- Keep changes focused and consistent with the existing structure and naming.
- Do not commit `.env`, `data/`, `release/`, logs, cookies or personal API keys.
- Run `npm run check:secrets` before pushing.
- Update the relevant documentation (`README.md`, `README.pt-BR.md`) when behavior changes.
- Add a clear description of what changed and how it was tested.

## Language and naming

- The app is called **Minha Bolha** in Portuguese and **My Bubble** in other languages.
- User-facing strings must be added to all three languages in `apps/web/src/lib/i18n.tsx`.
- Repository and release text is written in English. Portuguese documentation lives in `README.pt-BR.md`.
