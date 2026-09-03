import { expect, type Page } from '@playwright/test';

// Shared read-only probes into the *live* TipTap editor. TipTap 3 hangs the Editor instance off
// the .ProseMirror DOM node, so any spec can read the running editor state via page.evaluate —
// the only way to observe browser-only editor behaviour (neither tsc nor vitest sees the runtime).
// Everything here is side-effect free except pressKeyUntil, which is the "does this action make
// progress?" primitive (drive a key and watch where the caret lands).
//
// These exist to catch two bug classes we've actually hit (see components/editor/blockquote-
// extension.ts): duplicate module instances that break `instanceof` — spotted via the bundler-
// renamed constructor name (`_TextSelection`) from selectionClassName — and boundary/nesting
// logic that never converges (oscillation), spotted via pressKeyUntil timing out.

// `editor.state.doc.toString()` — ProseMirror's compact tree, e.g.
// `doc(blockquote(paragraph("aaa"), blockquote(paragraph("bbb"))))`. Ideal for asserting structure.
export function docString(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as
      | (Element & { editor?: { state: { doc: { toString(): string } } } })
      | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    return el.editor.state.doc.toString();
  });
}

// The markdown the editor would save — `editor.storage.markdown.getMarkdown()`, which is what
// PostEditor mirrors into its hidden `body` input. docString says what the document *is*; this says
// what gets stored, and the two can disagree (a table with no GFM pipe form still looks like a
// table on screen while saving as raw HTML).
export function markdown(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as
      | (Element & { editor?: { storage: { markdown: { getMarkdown(): string } } } })
      | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    return el.editor.storage.markdown.getMarkdown();
  });
}

// The runtime class name of the current selection. A canonical selection reads `TextSelection`;
// a duplicate prosemirror-state copy shows the bundler-renamed `_TextSelection` (or `TextSelection2`
// …) — the signature of an `instanceof`-breaking module duplication.
export function selectionClassName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as
      | (Element & { editor?: { state: { selection: { constructor: { name: string } } } } })
      | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    return el.editor.state.selection.constructor.name;
  });
}

// "<caret's textblock text>@<offset within it>", e.g. `bbb@3` = caret at the end of a "bbb" line.
// Compact enough to assert exactly where a keystroke left the caret.
export function caret(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as
      | (Element & {
          editor?: {
            state: {
              selection: { $from: { parent: { textContent: string }; parentOffset: number } };
            };
          };
        })
      | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    const { $from } = el.editor.state.selection;
    return `${$from.parent.textContent}@${$from.parentOffset}`;
  });
}

// The caret's absolute document position (`selection.from`). caret() above is the readable probe and
// should be preferred; this is for the cases it cannot decide — when two candidate landing places
// hold the same text, or both are non-empty and the question is which *block* the caret is in.
export function caretPos(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as
      | (Element & { editor?: { state: { selection: { from: number } } } })
      | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    return el.editor.state.selection.from;
  });
}

// `[from, to]` of the current selection. **The probe a spec needs when the gesture under test is a
// range**: a Shift-arrow selection reaches ProseMirror's state through the 20ms DOM-sync debounce,
// so a spec that pastes in the same tick is measuring a collapsed caret and can pass for the wrong
// reason (the paste-over-selection specs, 2026-09-03). Asserting `to > from` after `settle` is what
// makes those measurements non-vacuous.
export function selectionSpan(page: Page): Promise<[number, number]> {
  return page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as
      | (Element & { editor?: { state: { selection: { from: number; to: number } } } })
      | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    const { from, to } = el.editor.state.selection;
    return [from, to] as [number, number];
  });
}

// How many *document-changing* transactions an action dispatches. **The probe for a handler that
// stages an edit and then decides not to make it**: the end state cannot tell "the transaction was
// dropped whole" from "it was dispatched and the fall-through did the same thing", and the count
// can. Selection-only transactions are ignored, so ProseMirror's DOM-sync traffic cannot make the
// number wobble.
export async function countDocChanges(page: Page, action: () => Promise<void>): Promise<number> {
  await page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as
      | (Element & {
          editor?: {
            on(
              event: 'transaction',
              handler: (props: { transaction: { docChanged: boolean } }) => void,
            ): void;
          };
        })
      | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    const counted = window as Window & { __docChanges?: number };
    counted.__docChanges = 0;
    el.editor.on('transaction', ({ transaction }) => {
      if (transaction.docChanged) counted.__docChanges = (counted.__docChanges ?? 0) + 1;
    });
  });
  await action();
  return page.evaluate(() => (window as Window & { __docChanges?: number }).__docChanges ?? -1);
}

// As much of prosemirror-history's plugin state as these tests need: `undoDepth`'s
// `hist.done.eventCount`, and the grouping clock (`this.prevTime = prevTime`) that decides whether
// the next change joins the event before it or starts its own — `newGroup = history.prevTime == 0 ||
// (… history.prevTime < (tr.time || 0) - options.newGroupDelay …)`.
//
// Reading the depth is how a spec says "this gesture cost exactly one undo" without waiting out
// `newGroupDelay: config.newGroupDelay || 500`. A pause can only *hope* the grouping window has
// closed, and a slow-enough test passes such an assertion for the wrong reason; the count states it.
// closeHistory() in editor-authoring.ts is the write-side companion, and prevTime is what it checks.
//
// The plugin is matched by its exact key. `historyKey = new PluginKey("history")`, and
// prosemirror-state's `createKey` turns that name into the string "history$" (`return name + "$"`).
// Exact, not a prefix: "history$1" would be a *second* key of that name, i.e. not this one.
export function historyState(page: Page): Promise<{ undoDepth: number; prevTime: number }> {
  return page.evaluate(() => {
    type HistoryPluginState = { done: { eventCount: number }; prevTime: number };
    type Plugin = { key: string; getState(state: object): HistoryPluginState | undefined };
    const el = document.querySelector('.ProseMirror') as
      | (Element & { editor?: { state: { plugins: Plugin[] } } })
      | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    const { state } = el.editor;
    const plugin = state.plugins.find((p) => p.key === 'history$');
    if (!plugin) {
      throw new Error(`no history plugin; keys: ${state.plugins.map((p) => p.key).join(' ')}`);
    }
    const history = plugin.getState(state);
    if (!history) throw new Error('the history plugin holds no state');
    return { undoDepth: history.done.eventCount, prevTime: history.prevTime };
  });
}

// Let ProseMirror's 20ms selection-sync debounce (DOMObserver.flushSoon) settle WITHOUT recreating
// the selection — a page-side timeout, never an arrow/click (those take the DOM-readback path and
// would paper over a stuck/foreign selection).
export function settle(page: Page): Promise<void> {
  return page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
}

// Press `key` repeatedly (settling between presses) until the caret reaches `wantCaret` (a value
// from caret()), or the budget runs out. Returns the caret where it stopped, so a test can assert
// convergence: `expect(await pressKeyUntil(page, 'Backspace', 'bbb@3')).toBe('bbb@3')`. A handler
// that oscillates or no-ops never reaches the target, so the assertion fails instead of hanging —
// this is how the nested-blockquote Backspace oscillation is guarded.
export async function pressKeyUntil(
  page: Page,
  key: string,
  wantCaret: string,
  maxPresses = 10,
): Promise<string> {
  let where = await caret(page);
  for (let i = 0; i < maxPresses && where !== wantCaret; i++) {
    await page.keyboard.press(key);
    await settle(page);
    where = await caret(page);
  }
  return where;
}

// Assert the current selection is a canonical (not duplicated) class. Guards against the
// `instanceof`-breaking duplicate prosemirror-state — pass the expected class, default TextSelection.
export async function expectCanonicalSelection(
  page: Page,
  className = 'TextSelection',
): Promise<void> {
  expect(await selectionClassName(page)).toBe(className);
}

// An optional screenshot, for *looking at* a change rather than asserting one. Writes nothing
// unless `E2E_SHOT_DIR` names a directory, so an ordinary suite run is unaffected and a
// verification pass can ask for exactly the frames it wants without a spec of its own — which is
// what keeps a session-specific output path out of the tracked specs.
export async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.E2E_SHOT_DIR;
  if (!dir) return;
  // A frame worth looking at is a settled one: a third-party iframe photographed the instant an
  // assertion passes is a black box, which says nothing about whether it works. Bounded and
  // swallowed, because a page carrying an embedded player may never go quiet — and because this
  // wait must never be able to fail a spec that is otherwise green. Nothing here runs unless the
  // screenshots were asked for.
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  await page.screenshot({ path: `${dir}/${name}.png` });
}
