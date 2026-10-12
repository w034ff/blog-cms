import { expect, type Page } from '@playwright/test';

// Read-only probes into the live TipTap editor, which TipTap 3 hangs off the .ProseMirror node —
// the only way to observe browser-only editor behaviour. Side-effect free except pressKeyUntil.
// Two bug classes they catch (components/editor/blockquote-extension.ts): a duplicated module
// that breaks `instanceof` (selectionClassName), and logic that never converges (pressKeyUntil).

// `editor.state.doc.toString()` — ProseMirror's compact tree, e.g.
// `doc(blockquote(paragraph("aaa"), blockquote(paragraph("bbb"))))`. Ideal for asserting structure.
export function docString(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as
      (Element & { editor?: { state: { doc: { toString(): string } } } }) | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    return el.editor.state.doc.toString();
  });
}

// The markdown PostEditor saves (`editor.storage.markdown.getMarkdown()`). It can disagree with
// docString: a table with no GFM pipe form looks like a table but saves as raw HTML.
export function markdown(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as
      (Element & { editor?: { storage: { markdown: { getMarkdown(): string } } } }) | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    return el.editor.storage.markdown.getMarkdown();
  });
}

// The selection's runtime class: a duplicated prosemirror-state shows as `_TextSelection` or
// `TextSelection2`.
export function selectionClassName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as
      (Element & { editor?: { state: { selection: { constructor: { name: string } } } } }) | null;
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

// The caret's absolute position (`selection.from`), for when caret() cannot decide: two landing
// places with the same text, or which block the caret is in.
export function caretPos(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as
      (Element & { editor?: { state: { selection: { from: number } } } }) | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    return el.editor.state.selection.from;
  });
}

// `[from, to]` of the selection. **For a gesture that is a range**: a Shift-arrow selection reaches
// state through the 20ms debounce (docs/editor-pitfalls.md §1.1), so assert `to > from` after
// `settle`, or a same-tick paste measures a collapsed caret.
export function selectionSpan(page: Page): Promise<[number, number]> {
  return page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as
      (Element & { editor?: { state: { selection: { from: number; to: number } } } }) | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    const { from, to } = el.editor.state.selection;
    return [from, to] as [number, number];
  });
}

// How many document-changing transactions an action dispatches: **for a handler that stages an
// edit and then declines it**, where the end state cannot tell a dropped transaction from a
// fall-through that did the same thing. Selection-only transactions are ignored.
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

// prosemirror-history's state: `undoDepth` (`hist.done.eventCount`) and `prevTime`, the clock in
// `newGroup = history.prevTime == 0 || (… history.prevTime < (tr.time || 0) - options.newGroupDelay …)`.
// The depth says "this cost one undo" without waiting out `newGroupDelay`; closeHistory() in
// editor-authoring.ts is the write side.
//
// Matched by exact key: `new PluginKey("history")` is "history$" (`return name + "$"`); "history$1"
// would be a second key of that name.
export function historyState(page: Page): Promise<{ undoDepth: number; prevTime: number }> {
  return page.evaluate(() => {
    type HistoryPluginState = { done: { eventCount: number }; prevTime: number };
    type Plugin = { key: string; getState(state: object): HistoryPluginState | undefined };
    const el = document.querySelector('.ProseMirror') as
      (Element & { editor?: { state: { plugins: Plugin[] } } }) | null;
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

// Let the 20ms selection sync settle with a page-side timeout, never an arrow or click, which would
// take the DOM-readback path and hide a stuck selection.
export function settle(page: Page): Promise<void> {
  return page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
}

// Wait until the caret is at its textblock's start, asked of **the editor's own selection**. A key
// inside the 20ms sync window after `Home` bypasses every keymap. Polling the DOM offset is not
// enough: while state holds the old position ProseMirror can write it back and undo `Home`, after
// the poll saw 0 (docs/editor-pitfalls.md §1.1).
export async function caretAtLineStart(page: Page): Promise<void> {
  await expect.poll(() => caret(page)).toMatch(/@0$/);
}

// Press `key` (settling between presses) until caret() reads `wantCaret` or the budget runs out;
// returns where it stopped, so an oscillating or no-op handler fails instead of hanging.
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

// An optional screenshot for looking at a change. Writes only when `E2E_SHOT_DIR` is set, which
// keeps session-specific paths out of the specs.
export async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.E2E_SHOT_DIR;
  if (!dir) return;
  // A settled frame (an iframe shot too early is a black box). Bounded and swallowed: an embedded
  // player may never go quiet, and this must never fail a green spec.
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  await page.screenshot({ path: `${dir}/${name}.png` });
}
