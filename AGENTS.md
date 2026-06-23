<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# Commit convention

This repo uses **Conventional Commits** (adopted 2026-06-23). Subject: `type(scope): summary` in the imperative — e.g. `feat(editor): add drag-and-drop image upload`.

- Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`.
- Scope is optional. Breaking changes use `!` (e.g. `feat!:`) or a `BREAKING CHANGE:` footer.
- Subject language: English (matches existing history).
- Commits before this date (e.g. `eadb191` and the initial commits) predate the convention and are intentionally left unprefixed — do not retro-rewrite them.
