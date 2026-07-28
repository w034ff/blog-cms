---
name: verify
description: Drive the real TipTap editor in a browser to verify editor changes end-to-end via the lean Playwright E2E harness (isolated seeded DB + saved admin auth). Use before committing nontrivial editor changes; the editor is browser-only, so vitest/tsc can't observe its runtime behavior.
---

# Verify editor changes (Playwright E2E harness)

The editor is browser-only (TipTap / ProseMirror) — vitest and tsc can't catch its
runtime behavior. This harness drives the **real editor** in system Chrome against
an **isolated seeded copy** of the DB, so a change can be observed working
end-to-end (not just unit-tested).

## Run it

```bash
npm run test:e2e
```

It **coexists with `npm run dev`** (port 3001) — no need to stop your dev server.

Under the hood (`playwright.config.ts`):

1. `e2e/prepare-db.mts` copies `data/blog.db` → `e2e/.tmp/blog.e2e.db` (WAL-safe
   `better-sqlite3` backup) and upserts a test admin. **The real DB is never touched.**
2. A second `next dev` boots on **port 3100** (override with `E2E_PORT`) in an
   isolated build dir (`NEXT_DIST_DIR=.next-e2e`) so it doesn't collide with the
   dev server's `<distDir>/dev/lock`, with a test `SESSION_SECRET` and `BLOG_DB_PATH`.
3. The `setup` project logs in via the real `/login` form once and saves the
   session to `e2e/.auth/admin.json`; the spec projects reuse it.

Prerequisite: `data/blog.db` must exist (run `npm run db:seed` on a fresh clone).

Working in a git worktree: everything above is cwd-relative and so already private
to it — except the port. Set `E2E_PORT` (e.g. 3101) in that worktree's
`.claude/settings.local.json` before running, or the second run fails to bind
(`reuseExistingServer: false`, so it never silently tests the other tree's server).

## What it covers (`e2e/*.spec.ts`)

- **editor-smoke** — the editor mounts, the toolbar renders, and autosave persists
  a draft (`保存済み ✓`) to the isolated DB.
- **table-selection** — dragging across table cells shows the `.selectedCell`
  highlight (guards the `app/globals.css` `.prose .selectedCell::after` overlay).
- **image-upload** — the toolbar image control uploads a file and inserts an
  `<img src="/uploads/…">`.

## Add a spec

Drop `e2e/<name>.spec.ts`; it inherits admin auth + `baseURL` from the config.
Use `page.mouse` for cell-selection drags, `setInputFiles` for uploads, and
`getByRole` / `getByLabel` for toolbar buttons and fields. **Avoid native HTML5
drag-and-drop** — Playwright's DnD support is weak, which is why the table
drop-guard regression (`43f9917`) has no spec yet (it needs CDP-level drag events).

## Notes / constraints

- System Chrome via `channel: 'chrome'` — no bundled-browser download.
- `.next-e2e/` and `tsconfig.e2e.json` are gitignored; `next dev`'s tsconfig
  auto-edits are redirected to `tsconfig.e2e.json` (via
  `typescript.tsconfigPath`) so the tracked `tsconfig.json` stays clean.
- Runs serially (`workers: 1`) — editor interactions are timing-sensitive.
- Adding Playwright followed the repo's supply-chain rules (`@playwright/test`
  exact-pinned, `--min-release-age 7`, `--ignore-scripts`).
