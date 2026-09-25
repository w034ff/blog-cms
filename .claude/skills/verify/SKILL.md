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

`e2e/README.md` is the reference: how the harness is built, the shared helpers, how
to drive selections, history, native drags, touch and locators, and what makes a
wait valid. Read the section you need before writing a spec.

## Run it

**Run the files your change touches, not the suite.** One file takes well under
two minutes; the whole suite is many times that (the dated measurement is in
`e2e/README.md`, "Why four workers and not shards"). A full run belongs before a
merge, not before a commit.

```bash
npx playwright test e2e/editor-embed.spec.ts          # one file — the default
npx playwright test e2e/<a>.spec.ts e2e/<b>.spec.ts   # several: one command, one boot
npx playwright test e2e/<name>.spec.ts:<line>         # one test, by line
npx playwright test e2e/editor-embed.spec.ts --repeat-each=5   # is it flaky?
npm run test:e2e                                      # the whole suite
```

`npm run test:e2e:shards` is not a faster way to run the suite; it is for a run
that needs its own server and DB copy (`e2e/README.md`, "Why four workers and not
shards").

**A change with no files of its own gets a new spec, not the suite.** The rule
above assumes the change belongs to a spec: an extension, a NodeView, one screen.
Shared chrome — `components/PostEditor.tsx`, a layout under `app/`,
`app/globals.css` — has no "its files", and its blast radius is real: `20a3f24`
(記事の設定 moved onto the top line) landed in 17 specs at once, through geometry
and a locator that no longer matched. That hazard is why the claim needs a spec —
it is not a licence to run the suite. **Write the spec that covers the new claim,
run that file, and stop.** The merge-only rule above is not suspended here; it
wins. If the blast radius still worries you, say so and ask — the user's machine
is not yours to spend.

**The dev server and a full run.** A serial run coexisted with `npm run dev`
(port 3001) on 2026-09-13; three shards beside it did not (61 red, then an OOM
kill on a 19GB machine). Four workers beside the dev server has not been measured
— if the machine is loaded, stop the dev server first. **Never delete a
`.next-e2e-*` directory while a run holds it**: the server panics and every
remaining test fails for no reason.

Prerequisite: `data/blog.db` must exist (run `npm run db:seed` on a fresh clone).

Working in a git worktree: every path is cwd-relative and so already private to it
— except the port. Set `E2E_PORT` (e.g. 3101) in that worktree's
`.claude/settings.local.json` before running, or the second run fails to bind.

## Add a spec

Drop `e2e/<name>.spec.ts`; it inherits admin auth + `baseURL` from the config.
Use `getByRole` / `getByLabel` for toolbar buttons and fields, and `setInputFiles`
for uploads (it works on a hidden `<input type="file">`). Build on the shared
helpers in `e2e/editor-probe.ts`, `e2e/editor-authoring.ts` and
`e2e/native-drag.ts` instead of writing the gesture by hand.

## When something goes red

Measured 2026-09-13: three full runs produced three reds and **zero product
defects** — every one was the harness's own input timing. So triage before
debugging, in this order, changing only the set of tests while the commit and the
build stay the same:

1. **The one test alone** (`--repeat-each=5`). Green here and red in a full run
   means the suite, not the code.
2. **Its file.** Green per-file and red in a full run is the shape
   `docs/cms-features.md` records twice (the image-bubble 22s case, and this one).
3. **A full run**, only once 1 and 2 have said something.

Copy the trace out of `test-results/` before running anything else; the next run
wipes it.

Then read the failure as one of two kinds:

- **The setup did not land** — a caret that never moved, a click that made no
  NodeSelection, a row that is still the previous query's. Fix the wait, not the
  product. A wait must be a predicate that is **false before the thing it waits for
  and true after** (`e2e/README.md`, "Waits").
- **The product changed.** Only then open the app code.

Native keys are for when the key _is_ the subject. When a keystroke is only setup,
place the caret through the editor (`caretAtStartOf`, `setRange`) — a `Home` or an
arrow sent inside ProseMirror's 20ms selection-sync window is discarded, and no
amount of waiting produces it.
