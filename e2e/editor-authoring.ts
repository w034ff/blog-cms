import { expect, type Locator, type Page } from '@playwright/test';
import { historyState } from './editor-probe';

// Write-side companions to editor-probe.ts: they change the live editor, for documents and
// selections the UI can't reach — structures no typing shortcut builds but saved markdown carries
// (a code block inside a list item), and multi-block selections with exact endpoints, which a
// guard reading `editor.isActive(...)` sees differently from a caret (selection-scan.ts).

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

// Put an explicit break in the undo history, so the next change starts its own event: after
// loadMarkdown (one history event) a gesture would otherwise be undone together with the document.
//
// No page export reaches prosemirror-history's `closeHistory`, so its meta is set by name:
// `closeHistoryKey = new PluginKey("closeHistory")`, which `createKey` names "closeHistory$". An
// empty transaction carries it; the plugin reads the meta before its
// `if (tr.steps.length == 0) { return history; }` return. **Checked, not assumed**: a renamed key
// (a @tiptap bump) would silently fall back to time-based grouping, the vacuity this removes.
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

// Select a range by raw document position, for tests about exactly where the endpoints are; a
// mouse drag lands them by font metrics.
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
// the end of its last. Found, not `± 2`, which fails for a list or table (no textblock child) and
// for a node that is itself a textblock.
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
      // descendants() walks past the host, so stay inside it; textblocks come in document order.
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

// One endpoint on its own, for a range that crosses into a node (the isolating edge's shape).
export async function contentStartOf(page: Page, typeName: string): Promise<number> {
  const { from } = await innerRange(page, typeName);
  return from;
}

// Select the content of the first node of `typeName` — inside it, nothing outside.
export async function selectInside(page: Page, typeName: string): Promise<void> {
  const { from, to } = await innerRange(page, typeName);
  await setRange(page, from, to);
}

// A collapsed caret at the start of `typeName`'s inline content: a native `Home` inside the ~20ms
// selection-sync window after typing is discarded (docs/editor-pitfalls.md §1.1).
export async function caretAtStartOf(page: Page, typeName: string): Promise<void> {
  const { from } = await innerRange(page, typeName);
  await setRange(page, from);
}

// Collapse the selection to its end: a pressed End acts on the DOM selection, which reaches
// state a debounce later (docs/editor-pitfalls.md §1.1), and Enter would replace the range. Reads
// `selection.to` rather than re-resolving a node by type.
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

// Select the first node of `typeName` as a node, as the drag handle does. A TextSelection over the
// same ground has endpoints outside any textblock, warns, and picks up the neighbours.
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

// Select from the first block into the first node of `typeName`: the mixed selection an
// isActive-based guard reports false for. `backward` is an upward drag, which guards reading
// `$head` alone (prosemirror-tables' isInTable) miss.
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

// Move the paragraph reading `text` above the first node of `typeName`, which rebuilds the
// jumped-over block's NodeView (docs/embed-requirements.md §8.4). A transaction, not the drag
// handle: prosemirror-view's `destroyBetween` is reached the same way without CDP input over an
// iframe (§8.1, criterion E12). Callers must prove the rebuild, e.g. a stamp on the old DOM gone.
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

// 記事の設定 starts closed. Idempotent; reads the toggle's `aria-expanded`
// (PostSettingsPanel.tsx, docs/editor-requirements.md §12.22).
export async function openPostSettings(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: '記事の設定' });
  if ((await toggle.getAttribute('aria-expanded')) === 'true') return;
  await toggle.click();
  await expect(page.getByLabel('カテゴリ')).toBeVisible();
}

// 記事の設定's タグ field (TagField.tsx): the combobox, and the hidden input a save sends, by
// selector since `getByRole` cannot see it.
export function tagCombobox(page: Page): Locator {
  return page.getByRole('combobox', { name: 'タグ' });
}

export function tagsField(page: Page): Locator {
  return page.locator('input[type="hidden"][name="tags"]');
}

// Type into タグ, Enter on the first row, wait for the chip `name` (the existing tag's name, or the
// typed text when the first row adds it). The panel must be open.
export async function addTag(page: Page, typed: string, name: string = typed): Promise<void> {
  const box = tagCombobox(page);
  await box.fill(typed);
  await expect(
    page.getByRole('listbox', { name: 'タグ' }).getByRole('option').first(),
  ).toBeVisible();
  await box.press('Enter');
  await expect(page.getByRole('button', { name: `「${name}」を外す` })).toBeVisible();
  await expect(box).toHaveValue('');
}

// The drawer is modal and its backdrop swallows clicks into the editor, so close it before
// working outside the panel. Idempotent.
export async function closePostSettings(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: '記事の設定' });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') return;
  // Scoped: `name: '閉じる'` is a substring match, and WritingHelpDialog's close shares it.
  await page.locator('#post-settings-panel').getByRole('button', { name: '閉じる' }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
}

// 投稿 refuses a post with no category (docs/editor-requirements.md §12.32), so every spec that
// publishes a new post calls this. Keeps a chosen one. Clicks the radio in the page rather than
// opening 記事の設定, which would add two steps to every publish.
export async function ensureCategory(page: Page): Promise<void> {
  if ((await page.locator('input[name="category"]:checked').count()) > 0) return;
  const first = page.locator('input[name="category"]').first();
  await first.evaluate((input: HTMLInputElement) => input.click());
  await expect(first).toBeChecked();
}

// The publish state, from the pinned row's `data-publish-state` (PostEditor.tsx). Attachment, not
// visibility: the row carries no text. The button cannot stand in: publishDisabled is true both in
// flight and after landing.
function publishState(page: Page, state: string): Locator {
  return page.locator(`[data-publish-state="${state}"]`);
}

// 投稿/更新 has landed and the live post is current. 20s, the suite's longest wait (a run failing
// only here means memory, not code: docs/cms-features.md「E2E: 3シャードは開発サーバと同居できない」).
export async function expectPublished(page: Page): Promise<void> {
  await expect(publishState(page, 'published-current')).toBeAttached({ timeout: 20_000 });
}

// The last edit is persisted. Not 保存済み ✓, which fades (PostEditor.tsx); the attribute does not.
export async function expectAutosaved(page: Page): Promise<void> {
  await expect(page.locator('[data-autosave-state="saved"]')).toBeAttached({ timeout: 20_000 });
}

// Never published.
export async function expectDraft(page: Page): Promise<void> {
  await expect(publishState(page, 'draft')).toBeAttached();
}

// Published, with edits that have not been pushed public.
export async function expectPublishPending(page: Page): Promise<void> {
  await expect(publishState(page, 'published-pending')).toBeAttached();
}
