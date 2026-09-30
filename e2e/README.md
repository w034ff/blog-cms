# Editor E2E harness

Playwright against the real editor: system Chrome, a `next dev` of its own, and a throwaway copy of
the seeded DB. It is the expensive layer. Before writing a spec, ask the question in AGENTS.md
("Where an editor test goes"); how to run the suite is in `.claude/skills/verify/SKILL.md`. This file
is the reference both of them lean on: how the harness is built, and what it has cost to learn.

Counts and timings below are dated measurements, not targets. Measure the current ones:
`ls e2e/*.spec.ts | wc -l` for files, `npx playwright test --list | tail -1` for cases (it does not
boot the server).

## How it is built

Every per-server path is keyed by `E2E_PORT` (default 3100, `e2e/constants.ts`), so two runs — two
worktrees, or the shards of `npm run test:e2e:shards` — never share a file.

- `webServer.command` runs `e2e/prepare-db.mts` and then `next dev`. The prep copies `data/blog.db`
  to `e2e/.tmp/blog.e2e.<port>.db` with better-sqlite3's `.backup()` (WAL-safe) and upserts the test
  admin and author. The real DB is never touched. `data/blog.db` must exist (`npm run db:seed` on a
  fresh clone).
- The prep lives in `webServer.command`, not in a `globalSetup`, because Playwright starts the
  webServer before globalSetup runs. Login is a `setup` project (`e2e/auth.setup.ts`) that runs after
  the server is up and saves `e2e/.auth/admin.<port>.json` for the spec projects.
- The server gets its own build dir, `NEXT_DIST_DIR=.next-e2e-<port>`. Next refuses a second
  `next dev` that shares a `<distDir>/dev/lock`, even on another port, so this is what lets the
  harness run beside `npm run dev` (port 3001).
- A worktree outside the repo cannot borrow its `node_modules` through a symlink: Turbopack refuses
  it (`Symlink [project]/node_modules is invalid, it points out of the filesystem root`) and the
  webServer never starts. A hard-linked copy works and costs no space on the same filesystem:
  `cp -al <repo>/node_modules <worktree>/node_modules` (2026-09-30). `data/blog.db` may be a symlink,
  since the prep only reads it.
- `next dev` rewrites the tsconfig it uses. `typescript.tsconfigPath` points it at a gitignored
  `tsconfig.e2e.<port>.json` that extends the real one, so the tracked `tsconfig.json` stays clean.
- `nextConfig.devIndicators` is off under `NEXT_DIST_DIR`. The dev badge is fixed to the bottom-left
  corner, and Playwright refuses a click it would swallow; anything fixed to a screen edge hits it.
- Next does not override an already-set `process.env` from `.env`, so the webServer's own
  `SESSION_SECRET` wins and the server is self-consistent.
- `reuseExistingServer: false`: a second run on a taken port fails to bind rather than silently
  testing the other tree's server. `E2E_EXTERNAL_SERVER=1` points the run at a server started by
  hand (how a production build is measured — `e2e/revalidate-client-cache.spec.ts` needs it).
  Stopping that server is a trap: the process renames itself `next-server`, so
  `pkill -f "next start -p <port>"` misses it (and can match its own shell). The next `next start`
  then fails with EADDRINUSE and the spec silently passes against the old build — it happened
  twice. Find the PID with `ps -eo pid,args | grep "[n]ext-server"`, and read the new server's log
  for Ready before running.
- Uploads still write the real `data/uploads` (content-addressed, deduplicated and GC'd): the
  upload directory is a fixed path in `app/api/uploads/route.ts`, not keyed by the port.
- System Chrome via `channel: 'chrome'`; no bundled browser is downloaded. `@playwright/test` is
  exact-pinned and was installed under the repo's supply-chain rules.

### Why four workers and not shards

`workers: 4` with `fullyParallel: false` (`b91e0c9`, 2026-09-13): 769 cases in 12.1 minutes on one
server, against ~31 minutes at `workers: 1` and 925s on three shards. The timing-sensitive gestures
live inside a page, and each worker has its own browser; what they need is a file's tests in order
on one worker, which `fullyParallel: false` gives. A server is the expensive part — `next dev` is
about 1.6GB resident against ~0.3GB for another browser context — which is what made three shards
memory-bound on a 19.5GB machine. `npm run test:e2e:shards` still exists and multiplies with the
workers, but what it buys is a second server and DB copy, for a run that cannot share one — not
speed (the header of `scripts/e2e-shards.mts`).

- Headroom for 6-8 workers exists; the limit is CPU contention on the 70ms `caretSettled` windows.
  The prerequisite is `retries`, still 0: a failed first attempt leaves its published row behind,
  so specs that count rows (`publish-race-guard.spec.ts`, `publish-flow.spec.ts`,
  `thumbnail.spec.ts`, `link-color.spec.ts`) fail on the retry too until their titles are unique
  per attempt.
- A production build is not worth it for speed: A/B'd on two files and 100 cases, about 4%, which
  the 12-15s of `next build` eats. Per-case time is navigation, context creation and the TipTap
  mount. What production does buy is memory (RSS 235MB vs 1.58GB), so it matters only if the worker
  count outgrows one dev server.
- `--repeat-each` spreads a test's copies over the workers, where they run at once against the one
  DB copy. A test that keys a row by a fixed value (a URL in `link_previews`, a title) then fails
  on its copies overwriting each other, not on its own code: `editor-link-card.spec.ts`'s 14.3.2
  case failed 3 of 4 that way with every copy reading the same `fetched_at`, and 8 of 8 passed at
  `--workers=1` (2026-09-25). Repeat a test with `--workers=1`.
- `next dev` compiles a route on its first hit (672ms for `/uploads/[name]` against 19-32ms warm),
  which is enough to lose a race a production server never has.

## Shared helpers

Read these before writing a gesture by hand; the exports are the list.

- `e2e/editor-probe.ts` reads the live editor: `docString`, `markdown`, `caret`, `caretPos`,
  `selectionSpan`, `countDocChanges`, `historyState`, `settle`, `caretAtLineStart`, `pressKeyUntil`.
- `e2e/editor-authoring.ts` changes it through the editor, not the DOM: `loadMarkdown`, `setRange`,
  `caretAtStartOf`, `collapseToEnd`, `selectInside`, `selectNode`, `selectAcross`, `closeHistory`,
  `moveBlockAbove`, `openPostSettings`, and the publish-state expectations.
- `e2e/native-drag.ts` drives a native HTML5 drag through CDP: `cdpNativeDrag`, `caretPoint`,
  `dragSelect`.
- `e2e/x-embed-stub.ts` stubs the X endpoint, so no spec depends on a third party.

## Driving the editor

### Place a selection through the editor, not with keys

ProseMirror reads the DOM selection into `state.selection` on a ~20ms debounce
(`DOMObserver.flushSoon`), and Playwright presses keys ~4ms apart. `Shift+End` then `Ctrl+c` hands
the copy handler a stale selection; it builds an empty slice and declines, and the browser's own
handler then copies the DOM selection as plain text, so the paste lands characters instead of
nodes. `End` then `Enter` replaces a range that is still there. A click then `Home` lets the click's
caret arrive after the key and overwrite it.

Set the selection with `setRange`, `selectInside` or `caretAtStartOf`, which dispatch and never read
the DOM back. Keep the real `Ctrl+c` / `Ctrl+v` when the clipboard round trip is what the test is
about. When a native key is only setup, it is the wrong tool; `docs/editor-pitfalls.md` §1.1 has the
measurement side of the same debounce.

### History

`setContent` puts a whole load into one history event, so an undo right after `loadMarkdown` rolls
back the load. Break the group with `closeHistory` instead of sleeping: prosemirror-history's
`newGroupDelay` is 500ms, and a `waitForTimeout(700)` lost that margin under full-suite load
(2026-08-15). `closeHistory` dispatches an empty transaction carrying the plain-string key
`'closeHistory$'`, which the plugin reads before its empty-transaction early return. Assert on
`historyState` (`done.eventCount`), and check that `prevTime` reads back 0 — a renamed key on an
@tiptap bump would otherwise restore the time dependence silently.

### Native drags

- A real mouse gesture inside a live selection fires the DOM `dragstart`, which sets
  ProseMirror's `view.dragging`, but headless Chrome never emits `Input.dragIntercepted` for a
  text-selection drag. `cdpNativeDrag` enables `Input.setInterceptDrags`, then synthesizes the
  `DragData` and drives `Input.dispatchDragEvent` (dragEnter / dragOver / drop) at the target. The
  dropped slice still comes from `view.dragging`, so it is faithful to a real move.
- A drop can carry files: put `files: ['<absolute path>']` in the `DragData`. Assert that the file
  arrived before believing a negative.
- Never aim `cdpNativeDrag` at the block drag handle. The handle runs its own mouse controller and
  `view.dragging` is null there, so the CDP drop lands as a separate external text drop on top of a
  live session — a combination no user can produce, and it shredded an accordion in a way the plain
  mouse never does (2026-08-10). Drive the handle with `page.mouse`, and check liveness:
  `.block-drag-indicator` visible, `.block-drag-handle.is-dragging` set. "Document unchanged" is
  evidence of a refusal only when a control drag in the same spec moves something.
- Aim drag endpoints with `caretPoint`, never a pixel offset. Chrome's drag-select does not snap to
  the nearest character boundary (53% through a 16px CJK glyph still ends before it, 78% ends after),
  so `x + 40` took 13 specs red at once (`b5b59b8`), and Chrome 151 moved a `height / 2` endpoint
  onto a code block's empty trailing line. `dragSelect` returns an origin taken from the realized
  selection, because a mousedown exactly on the boundary can land outside it and `dragstart` then
  never fires. Endpoints that only feed counts or `not.toBe` can stay loose.
- What synthetic input cannot reach at all is in `docs/editor-pitfalls.md` §1.3.

### Keys, touch and locators

- A synthetic Tab escapes the contenteditable into the browser's focus cycle. Dispatch a
  `KeyboardEvent('keydown')` to reach the keymap. What dispatch cannot reproduce is the native focus
  move a declined Tab falls through to, so "Tab does nothing here" can only assert an unchanged
  document.
- Touch needs no CDP: `test.use({ hasTouch: true })` and `page.touchscreen.tap()` reach the page as a
  `pointerdown` with `pointerType === 'touch'`. `test.use({ colorScheme })` is the same shape for
  dark mode.
- `getByRole` ignores hidden elements (`includeHidden` defaults to false). That is what makes the
  `@media (hover: none)` idiom safe — a control rendered twice and painted once
  (`docs/editor-requirements.md` §12.4, §12.5) does not trip strict mode. `data-testid` and CSS
  selectors match both copies: rename a duplicated testid, and add `:visible` to a CSS query that
  measures a box.
- `name` is a substring match. `getByLabel('リンク先')` also resolved the `リンク先を開く` button;
  pass `{ exact: true }` when a field's name is a prefix of a button's. A new control's name must not
  be a substring of an existing one, nor contain one.
- A role that comes and goes breaks every `getByRole` aimed at the element, because the locator is
  re-evaluated per action.
- Do not read the link card picker's unfiltered list: it holds the newest 20 and drops the seeded
  posts once other specs publish. A geometry spec waits for `naturalWidth > 0`, not for the `<img>`.

### Focus and fresh mounts

- `loadMarkdown` does not focus the editor. Without a click on `.ProseMirror` first,
  `keyboard.type` never reaches it, and a "the menu does not open" assertion passes for the wrong
  reason. Click before `loadMarkdown`.
- `selectInside` + `collapseToEnd` leaves the caret at the end of the text, where the slash menu
  does not trigger. Resolve the node's first textblock and use its start (`pos + 1` is right only
  when the node itself is a textblock).
- Loading the same markdown into the open editor is not a fresh mount: the node keeps its position
  and attrs, ProseMirror keeps the NodeView, and no lookup runs. Navigate to the page again
  (`page.goto`) when a test needs a new NodeView.
- `dblclick()` fires both clicks inside one animation frame, so it misses anything a human
  double-click (150-300ms apart) hits. Space two `mouse.click` calls. Playwright clicks the
  horizontal centre of an element, which can be the one spot a bug does not cover; click where the
  text is when geometry is what's under test.
- Mutation-test a guard or sanitize assertion: break the predicate and confirm the intended specs
  go red. It caught two vacuous tests in the link card alone.

### Stubs, navigation and screenshots

- `page.route` and `context.route` do not reach a sandboxed frame with an opaque origin (the
  gist's `srcdoc` document, `docs/embed-requirements.md` §18); the real GitHub script loads. Such a
  frame is tested in halves: the parent's half from a report delivered directly, and the shipped
  document against a script served by the spec's own `node:http` server
  (`e2e/gist-reporter.spec.ts`). A `data:` URL does not stand in for the script — Chrome refuses it
  as `<script src>`.
- X is stubbed with `page.route` (`e2e/x-embed-stub.ts`) because its frame is not sandboxed that
  way.
- A fragment-only `page.goto` is a same-document navigation. It silently invalidated an
  anchor-landing test; read the heading id from `page.request.get` instead.
- Verify anything visual — a drag ghost, a collapsed box — by looking at a screenshot
  (`E2E_SHOT_DIR`), not by counts: `toBeVisible()` passed for a ghost that had collapsed to a
  92px sliver (`docs/embed-requirements.md` §10.10). With `loading="lazy"`, a `fullPage` capture
  leaves below-the-fold frames unpainted; scroll each element in and take viewport shots.

## Waits

A wait must be a predicate that is false before the thing it waits for and true after it. A count
that is already right (`toHaveCount(1)`), a loose regex that already matches (`/@0$/`), and a fixed
`waitForTimeout` all pass without anything having happened. Shown three times in a row on
2026-09-12/13; the two fixed then were a 70ms `caretSettled` followed by a swallowed `ArrowLeft`
(replaced by `caretAtStartOf`), and a first click on a just-loaded embed that made no NodeSelection
(now polled until it does).

**Decided 2026-09-13: the six remaining `caretSettled` waits stay** (`editor-callout-boundary.spec.ts`
and `editor-codeblock-boundary.spec.ts`). In three full runs only the one already fixed went red. Do
not re-propose converting them. If one of them flakes, the first thing to try, unmeasured so far, is
`view.domObserver.forceFlush()`: it clears the 20ms timer `flushSoon()` sets and flushes at once,
and does nothing when nothing is pending. Adopt it only after "wait removed → red, `forceFlush` →
green" under load.

## When a full run goes red

Most reds are the harness's own input timing. The triage order is in the verify skill; these are
the shapes it keeps meeting.

- The debounce family reproduces only under full-suite CPU load and wanders: one red per run, a
  different spec each time, green in isolation. The wandering is the signature that separates it
  from a regression.
- A network-dependent family: `editor-link-bubble.spec.ts` asserts the bubble shows `example.com`,
  which holds only while `/api/link-title` has not answered. When the machine reaches example.com,
  the title arrives and the assertion fails. Re-run before believing a lone red there.
- The trace is the evidence, not a re-run. `test-results/` is wiped at the start of the next run, so
  copy the trace out before running anything else — listing it in the same command as the rerun
  destroyed it twice (2026-08-10). The per-action DOM snapshots in the trace show the document at
  every step.
- A CSS change that seems not to apply is often `next dev` serving stale output; the fix is to stop
  the server, delete the dist dir and restart.
