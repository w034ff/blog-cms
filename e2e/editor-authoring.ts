import { expect, type Page } from '@playwright/test';
import { historyState } from './editor-probe';

// Write-side companions to editor-probe.ts: they *change* the live editor rather than read it, and
// exist for documents and selections the UI can't reach. Two cases keep coming up:
//
//   - structures no typing shortcut will build (a code block inside a list item — the fence input
//     rule needs its target type to be valid at the caret, and a list item's first child must be a
//     paragraph), but which ordinary saved or pasted markdown carries, so loading is how a real
//     post arrives at them;
//   - selections spanning more than one block, which a guard reading `editor.isActive(...)` sees
//     differently from a caret (see components/editor/selection-scan.ts). Playwright can drag one,
//     but the exact endpoints matter to these tests, and setTextSelection states them outright.
//
// closeHistory is the odd one out: it changes nothing in the document, only the undo history's
// grouping, and it is here because it is a dispatch rather than a read.

type Transaction = { setMeta(key: string, value: boolean): Transaction };

type EditorProbe = Element & {
  editor?: {
    commands: {
      setContent(content: string): boolean;
      setTextSelection(range: { from: number; to: number }): boolean;
      setNodeSelection(pos: number): boolean;
    };
    state: { doc: { descendants(f: (node: unknown, pos: number) => void): void }; tr: Transaction };
    view: { dispatch(tr: Transaction): void };
  };
};

// Replace the document with markdown, the way opening a saved post does (the editor parses it
// through the same tiptap-markdown pipeline).
export function loadMarkdown(page: Page, markdown: string): Promise<void> {
  return page.evaluate((md) => {
    const el = document.querySelector('.ProseMirror') as EditorProbe | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    el.editor.commands.setContent(md);
  }, markdown);
}

// Put an explicit break in the undo history: whatever changes next starts its own event instead of
// joining the one before it. This is what a test needs after loadMarkdown — setContent is a single
// history event, so a gesture that groups with it is undone *together with the whole document*, and
// the undo then proves nothing about what the gesture cost.
//
// The break is stated, not waited for. prosemirror-history exports `closeHistory`, but nothing
// exports it into a page that only has the bundled editor, so the meta it sets is set directly:
// `closeHistory(tr)` is `tr.setMeta(closeHistoryKey, true)` with
// `closeHistoryKey = new PluginKey("closeHistory")`, which prosemirror-state's `createKey` names
// "closeHistory$" (`return name + "$"`), and `setMeta` takes that string as readily as the key.
//
// An empty transaction carries it, and that is deliberate: the plugin reads the meta *before* its
// `if (tr.steps.length == 0) { return history; }` early return, and that return hands back the state
// the meta already replaced — so `prevTime` becomes 0 while the document stays untouched.
//
// Checked, not assumed. A renamed key (a @tiptap family bump is a recurring operation here) or a
// filterTransaction swallowing the empty transaction would drop every caller back onto time-based
// grouping silently, where a test slow enough to outlast `newGroupDelay` still passes — which is the
// vacuity this helper exists to remove, so it must not be able to reintroduce it quietly.
export async function closeHistory(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as EditorProbe | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    el.editor.view.dispatch(el.editor.state.tr.setMeta('closeHistory$', true));
  });
  const { prevTime } = await historyState(page);
  if (prevTime !== 0) {
    throw new Error(`closeHistory did not take: prevTime is ${prevTime}, expected 0`);
  }
}

// Select a range by raw document position. The blunt one, for tests whose whole point is *where*
// the endpoints are: a mouse drag lands them by font metrics, which is exactly what a test asserting
// an exact resulting document cannot afford.
export function setRange(page: Page, from: number, to = from): Promise<void> {
  return page.evaluate(
    ({ from, to }) => {
      const el = document.querySelector('.ProseMirror') as EditorProbe | null;
      if (!el?.editor) throw new Error('no live editor on .ProseMirror');
      el.editor.commands.setTextSelection({ from, to });
    },
    { from, to },
  );
}

// The inline-content edges of the first node of `typeName`: the start of its first textblock and
// the end of its last. Both selection helpers below build on this.
//
// The textblocks are found rather than assumed. Both helpers used to arrive at their endpoints with
// `± 2` — really "the node, then its first (or last) child" — which only holds when that child is a
// textblock. It is not for a bulletList (the child is a listItem) or a table (a tableRow), so
// prosemirror-state warned "TextSelection endpoint not pointing into a node with inline content"
// and built a selection nobody had asked for. The arithmetic was wrong the other way for a node
// that is *itself* a textblock: a codeBlock's own first and last character fell outside.
function innerRange(page: Page, typeName: string): Promise<{ from: number; to: number }> {
  return page.evaluate((name) => {
    const el = document.querySelector('.ProseMirror') as EditorProbe | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    let host: { from: number; to: number } | null = null;
    let first: number | null = null;
    let last: number | null = null;
    el.editor.state.doc.descendants((node, pos) => {
      const n = node as { type: { name: string }; nodeSize: number; isTextblock: boolean };
      if (!host) {
        if (n.type.name !== name) return;
        host = { from: pos, to: pos + n.nodeSize };
        // A node that is its own textblock (codeBlock) has no inner one to descend to.
        if (n.isTextblock) {
          first = pos;
          last = pos + n.nodeSize;
        }
        return;
      }
      // descendants() keeps walking past the host, so stay inside its range. Nested textblocks come
      // in document order, which is what makes the last assignment the last one.
      const { from, to } = host as { from: number; to: number };
      if (pos < from || pos >= to || !n.isTextblock) return;
      if (first === null) first = pos;
      last = pos + n.nodeSize;
    });
    if (!host) throw new Error(`no ${name} in the document`);
    if (first === null || last === null) throw new Error(`no textblock inside ${name}`);
    // +1 / -1 step over the textblock's own open and close tokens, into its inline content.
    return { from: (first as number) + 1, to: (last as number) - 1 };
  }, typeName);
}

// The inline-content start of the first node of `typeName`. `selectInside` is the whole-node form;
// this is one endpoint on its own, for a range that *crosses* into a node — which is the shape the
// isolating edge has to be measured at (a selection running from the paragraph above the footnotes
// to where the first definition's text begins).
export async function contentStartOf(page: Page, typeName: string): Promise<number> {
  const { from } = await innerRange(page, typeName);
  return from;
}

// Select the content of the first node of `typeName` — inside it, nothing outside.
export async function selectInside(page: Page, typeName: string): Promise<void> {
  const { from, to } = await innerRange(page, typeName);
  await setRange(page, from, to);
}

// Put a collapsed caret at the start of the first node of `typeName`'s inline content — what a
// native `Home` pressed in there is meant to produce, except that this one cannot be swallowed.
// A `Home` sent inside the ~20ms selection-sync window (DOMObserver.flushSoon) that follows typing
// is discarded: ProseMirror re-asserts its own pre-Home selection onto the DOM, the caret never
// moves, and a poll watching the DOM offset waits for a value that will never arrive.
export async function caretAtStartOf(page: Page, typeName: string): Promise<void> {
  const { from } = await innerRange(page, typeName);
  await setRange(page, from);
}

// Collapse the current selection to its end — the deterministic counterpart to pressing End after a
// shift-selection. That key moves the *DOM* selection, which reaches state.selection a debounce
// later (ProseMirror's DOMObserver.flushSoon, ~20ms), so a key pressed inside that window acts on
// the ranged selection End was meant to collapse — and Enter *replaces* a ranged selection. This
// reads `selection.to`, so it names the end of the range just selected rather than re-resolving a
// node by type, which would be a different node the moment the document leads with something else.
export function collapseToEnd(page: Page): Promise<void> {
  return page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as
      | (EditorProbe & { editor?: { state: { selection: { to: number } } } })
      | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    const { to } = el.editor.state.selection;
    el.editor.commands.setTextSelection({ from: to, to });
  });
}

// Select the first node of `typeName` *as a node* — the selection the block drag handle makes, and
// the one to copy a whole block with. A TextSelection spanning the same ground has to put its
// endpoints on the block boundaries either side, where the parent is the doc rather than a
// textblock; prosemirror-state warns about that ("TextSelection endpoint not pointing into a node
// with inline content") and the resulting slice picks up whatever the neighbouring blocks
// contribute. A NodeSelection says "this node, closed on both sides" outright.
export function selectNode(page: Page, typeName: string): Promise<void> {
  return page.evaluate((name) => {
    const el = document.querySelector('.ProseMirror') as EditorProbe | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    let at: number | null = null;
    el.editor.state.doc.descendants((node, pos) => {
      const n = node as { type: { name: string } };
      if (n.type.name === name && at === null) at = pos;
    });
    if (at === null) throw new Error(`no ${name} in the document`);
    el.editor.commands.setNodeSelection(at as number);
  }, typeName);
}

// Select from inside the document's first block *into* the first node of `typeName` — the mixed
// selection an isActive-based guard reports false for. `backward` puts the anchor in the target and
// the head in the first block instead, which is what a user dragging upwards produces; guards
// reading `$head` alone (prosemirror-tables' isInTable) only miss that direction.
export async function selectAcross(
  page: Page,
  typeName: string,
  options: { backward?: boolean } = {},
): Promise<void> {
  // 2 = inside the document's first block; the other end is inside the target's last textblock.
  const outer = 2;
  const { to: inner } = await innerRange(page, typeName);
  await (options.backward ? setRange(page, inner, outer) : setRange(page, outer, inner));
}

// Move the paragraph reading `text` to just before the first node of `typeName` — the reorder that
// rebuilds the *jumped-over* block's NodeView (docs/embed-requirements.md §8.4, row 1 of its table;
// the other direction rebuilds the moved block instead and leaves the target alone).
//
// A transaction rather than the block drag handle: what this exists to exercise is prosemirror-view's
// child sync (`destroyBetween` on the node-diff pass), which a `delete` + `insert` reaches
// identically, without depending on CDP input over an iframe (embed §8.1, criterion E12). Callers
// that care whether the rebuild happened must check it themselves — stamping the old DOM and
// asserting the stamp is gone is the only thing that proves this reached the diff at all.
export function moveBlockAbove(page: Page, text: string, typeName: string): Promise<void> {
  return page.evaluate(
    ({ needle, name }) => {
      const el = document.querySelector('.ProseMirror') as EditorProbe | null;
      if (!el?.editor) throw new Error('no live editor on .ProseMirror');
      const { state, view } = el.editor as unknown as {
        state: {
          tr: { delete(f: number, t: number): { insert(at: number, n: unknown): unknown } };
          doc: {
            forEach(
              f: (
                n: { type: { name: string }; textContent: string; nodeSize: number },
                pos: number,
              ) => void,
            ): void;
            nodeAt(pos: number): unknown;
          };
        };
        view: { dispatch(tr: unknown): void };
      };
      let from = -1;
      let size = 0;
      let over = -1;
      state.doc.forEach((node, pos) => {
        if (node.type.name === 'paragraph' && node.textContent === needle) {
          from = pos;
          size = node.nodeSize;
        }
        if (over === -1 && node.type.name === name) over = pos;
      });
      if (from === -1) throw new Error(`no paragraph reading ${needle}`);
      if (over === -1) throw new Error(`no ${name} in the document`);
      if (from < over)
        throw new Error('the block to move must start out below the one jumped over');
      // Deleting below `over` leaves that position untouched, so it can be reused as the insert.
      view.dispatch(state.tr.delete(from, from + size).insert(over, state.doc.nodeAt(from)));
    },
    { needle: text, name: typeName },
  );
}

// 記事の設定 starts closed, so a spec that touches カテゴリ, タグ, 説明, サムネイル or 限定公開
// has to open it first. Idempotent: a panel already open is left alone rather than toggled shut.
//
// The toggle is a <button> on the editor's pinned bar and the panel is a `hidden` div below it —
// they are no longer one <details>, because the panel has to render outside the sticky block or
// an open panel would pin its whole height to the top of the viewport. `aria-expanded` is what
// ties them together, and it is what this reads.
export async function openPostSettings(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: '記事の設定' });
  if ((await toggle.getAttribute('aria-expanded')) === 'true') return;
  await toggle.click();
  await expect(page.getByLabel('カテゴリ')).toBeVisible();
}

// The suite's publish barrier: 投稿/更新 has landed and the post is live with nothing pending.
//
// Reads `data-publish-state`, not the status text. The row writes out only the two states that
// need acting on (PostEditor.tsx says why), so 公開済み（最新） is no longer on screen — and it
// was this barrier in 26 places, which coupled the suite to one piece of Japanese UI copy. The
// span is empty in this state and therefore has no box, so this asserts attachment, not
// visibility. The publish button cannot stand in for it: publishDisabled is true both while the
// request is in flight and after it lands, so it never distinguishes the two.
export async function expectPublished(page: Page): Promise<void> {
  await expect(page.locator('[data-publish-state="published-current"]')).toBeAttached({
    timeout: 20_000,
  });
}
