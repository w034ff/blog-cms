---
name: verify
description: Drive the real TipTap editor in a browser via the lean Playwright E2E harness (isolated seeded DB + saved admin auth). Use before committing an editor change whose behaviour only a browser can show — input rules, keymaps, NodeViews, geometry, IME, a real drag, the clipboard, autosave, publish. A claim about a Slice, a content expression or a markdown string belongs in vitest instead; see "Where an editor test goes" in AGENTS.md.
---

# Verify editor changes (Playwright E2E harness)

Drives the **real editor** in system Chrome against an **isolated seeded copy** of
the DB, so a change can be observed working end-to-end.

This is the expensive layer and it is for what only a browser answers. The
document-level guards — slice repair, placement, schema content expressions — are
vitest cases over `components/editor/test-schema.ts` and cost about a millisecond
each; AGENTS.md holds the question to ask before writing either.

## Run it

```bash
npm run test:e2e              # one server, the whole suite
npm run test:e2e:shards       # N processes, one server each (default 3)
```

Sharding is the faster path — measured 2026-09-11, the same suite ran in 14.9m
across 3 shards against 34.7m in one. Each shard boots its own `next dev` and
Chrome, so it is memory-bound; drop to 2 if the machine is loaded, and **never
delete a `.next-e2e-*` directory while a run holds it** (the servers panic and
every remaining test fails for no reason).

It **coexists with `npm run dev`** (port 3001) — no need to stop your dev server.

Under the hood (`playwright.config.ts`, `e2e/constants.ts`): every per-server path
is keyed by `E2E_PORT` (default 3100), which is what lets the shards coexist.

1. `e2e/prepare-db.mts` copies `data/blog.db` → `e2e/.tmp/blog.e2e.<port>.db`
   (WAL-safe `better-sqlite3` backup) and upserts a test admin. **The real DB is
   never touched.**
2. A second `next dev` boots on that port in its own build dir
   (`NEXT_DIST_DIR=.next-e2e-<port>`) so it doesn't collide with the dev server's
   `<distDir>/dev/lock`, with a test `SESSION_SECRET` and `BLOG_DB_PATH`.
3. The `setup` project logs in via the real `/login` form once and saves the
   session to `e2e/.auth/admin.<port>.json`; the spec projects reuse it.

Prerequisite: `data/blog.db` must exist (run `npm run db:seed` on a fresh clone).

Working in a git worktree: everything above is cwd-relative and so already private
to it — except the port. Set `E2E_PORT` (e.g. 3101) in that worktree's
`.claude/settings.local.json` before running, or the second run fails to bind
(`reuseExistingServer: false`, so it never silently tests the other tree's server).

## Add a spec

Drop `e2e/<name>.spec.ts`; it inherits admin auth + `baseURL` from the config.
Use `getByRole` / `getByLabel` for toolbar buttons and fields, and `setInputFiles`
for uploads (it works on a hidden `<input type="file">`).

The shared helpers are where the hard-won parts live — read them before writing
the gesture by hand:

- `e2e/editor-probe.ts` — read the live editor: `docString`, `markdown`, `caret`,
  `settle`, `historyState`.
- `e2e/editor-authoring.ts` — change it: `loadMarkdown`, `setRange`,
  `moveBlockAbove`, `openPostSettings` (the metadata fields start folded).
- `e2e/native-drag.ts` — **native HTML5 drag, driven through CDP**, which
  `page.mouse` cannot produce. `cdpNativeDrag`, plus `caretPoint` and `dragSelect`,
  which return the selection actually realized rather than a guessed pixel offset.
- `e2e/x-embed-stub.ts` — the X endpoint, so no spec depends on a third party.

Drag endpoints are measured, never hard-coded: a fixed `+40px` once took 13 specs
red at once because Chrome's drag-select does not snap to the nearest boundary.

## Notes / constraints

- System Chrome via `channel: 'chrome'` — no bundled-browser download.
- `.next-e2e-*/` and `tsconfig.e2e.*.json` are gitignored; `next dev`'s tsconfig
  auto-edits are redirected to the per-port file (via `typescript.tsconfigPath`)
  so the tracked `tsconfig.json` stays clean.
- Each shard runs serially inside itself (`workers: 1`, `fullyParallel: false`) —
  editor interactions are timing-sensitive, which is why the suite is split into
  processes rather than given more workers.
- Adding Playwright followed the repo's supply-chain rules (`@playwright/test`
  exact-pinned, `--min-release-age 7`, `--ignore-scripts`).
