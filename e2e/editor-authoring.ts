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

// Select the content of the first node of `typeName` — inside it, nothing outside.
export function selectInside(page: Page, typeName: string): Promise<void> {
  return page.evaluate((name) => {
    const el = document.querySelector('.ProseMirror') as EditorProbe | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    let at: { from: number; to: number } | null = null;
    el.editor.state.doc.descendants((node, pos) => {
      const n = node as { type: { name: string }; nodeSize: number };
      if (n.type.name === name && !at) at = { from: pos, to: pos + n.nodeSize };
    });
    if (!at) throw new Error(`no ${name} in the document`);
    const { from, to } = at as { from: number; to: number };
    el.editor.commands.setTextSelection({ from: from + 2, to: to - 2 });
  }, typeName);
}

// Select from inside the document's first block *into* the first node of `typeName` — the mixed
// selection an isActive-based guard reports false for. `backward` puts the anchor in the target and
// the head in the first block instead, which is what a user dragging upwards produces; guards
// reading `$head` alone (prosemirror-tables' isInTable) only miss that direction.
export function selectAcross(
  page: Page,
  typeName: string,
  options: { backward?: boolean } = {},
): Promise<void> {
  return page.evaluate(
    ({ name, backward }) => {
      const el = document.querySelector('.ProseMirror') as EditorProbe | null;
      if (!el?.editor) throw new Error('no live editor on .ProseMirror');
      let at: { from: number; to: number } | null = null;
      el.editor.state.doc.descendants((node, pos) => {
        const n = node as { type: { name: string }; nodeSize: number };
        if (n.type.name === name && !at) at = { from: pos, to: pos + n.nodeSize };
      });
      if (!at) throw new Error(`no ${name} in the document`);
      // 2 = inside the document's first block; `to - 2` = inside the target's last textblock.
      const outer = 2;
      const inner = (at as { to: number }).to - 2;
      el.editor.commands.setTextSelection(
        backward ? { from: inner, to: outer } : { from: outer, to: inner },
      );
    },
    { name: typeName, backward: options.backward ?? false },
  );
}
