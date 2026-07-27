import type { Page } from '@playwright/test';

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

type EditorProbe = Element & {
  editor?: {
    commands: {
      setContent(content: string): boolean;
      setTextSelection(range: { from: number; to: number }): boolean;
      setNodeSelection(pos: number): boolean;
    };
    state: { doc: { descendants(f: (node: unknown, pos: number) => void): void } };
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

// Select the content of the first node of `typeName` — inside it, nothing outside.
export async function selectInside(page: Page, typeName: string): Promise<void> {
  const { from, to } = await innerRange(page, typeName);
  await setRange(page, from, to);
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
