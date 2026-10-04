import { test, expect, type Page } from '@playwright/test';
import { loadMarkdown, setRange } from './editor-authoring';
import { docString, settle } from './editor-probe';

// `Mod-Alt-0` (@tiptap/extension-paragraph's `setParagraph()`) is the one gesture reaching TipTap's
// `clearNodes`: `setBlockType` skips a node already `hasMarkup`. `clearNodes` took
// `contentMatchAt(index).defaultType`, which past the first child of `block+ footnoteSection?` is
// `footnoteSection`, throwing "RangeError: Invalid content for node type footnoteSection".
// clear-nodes-extension.ts picks a textblock. **`pageerror` is watched**: the throw left the
// document unchanged.
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`));
  return errors;
}

async function openEditor(page: Page) {
  const editor = page.locator('.ProseMirror');
  await page.goto('/admin/posts/new');
  await expect(editor).toBeVisible();
  await editor.click();
  await settle(page);
  return editor;
}

// The first textblock's start in `typeName`, by walking the document.
function caretInside(page: Page, typeName: string): Promise<number> {
  return page.evaluate((name) => {
    const el = document.querySelector('.ProseMirror') as Element & {
      editor?: { state: { doc: { descendants(f: (n: unknown, p: number) => void): void } } };
    };
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    let host: { from: number; to: number } | null = null;
    let at: number | null = null;
    el.editor.state.doc.descendants((node, pos) => {
      const n = node as { type: { name: string }; nodeSize: number; isTextblock: boolean };
      if (!host) {
        if (n.type.name !== name) return;
        host = { from: pos, to: pos + n.nodeSize };
        if (n.isTextblock) at = pos;
        return;
      }
      if (at !== null) return;
      const { from, to } = host as { from: number; to: number };
      if (pos < from || pos >= to || !n.isTextblock) return;
      at = pos;
    });
    if (!host) throw new Error(`no ${name} in the document`);
    if (at === null) throw new Error(`no textblock inside ${name}`);
    return (at as number) + 1; // step over the textblock's open token
  }, typeName);
}

// The final textblock's end, derived, not counted.
function lastTextblockEnd(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as Element & {
      editor?: { state: { doc: { content: { size: number } } } };
    };
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    return el.editor.state.doc.content.size - 1;
  });
}

// The report: top-level index 1, where `defaultType` stops being `paragraph`.
test('Mod-Alt-0 on a blank line below a paragraph does not throw', async ({ page }) => {
  const errors = watchErrors(page);
  await openEditor(page);

  await page.keyboard.type('本文');
  await page.keyboard.press('Enter');
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph("本文"), paragraph)');

  await page.keyboard.press('Control+Alt+0');
  await settle(page);

  expect(errors).toEqual([]);
  // A no-op: already a paragraph, nothing to lift from.
  expect(await docString(page)).toBe('doc(paragraph("本文"), paragraph)');

  // The caret survived.
  await page.keyboard.type('つづき');
  expect(await docString(page)).toBe('doc(paragraph("本文"), paragraph("つづき"))');
});

// Index 0 never threw; the fix must not change it.
test('Mod-Alt-0 in the document first paragraph stays a no-op', async ({ page }) => {
  const errors = watchErrors(page);
  await openEditor(page);

  await page.keyboard.type('唯一の段落');
  await settle(page);

  await page.keyboard.press('Control+Alt+0');
  await settle(page);

  expect(errors).toEqual([]);
  expect(await docString(page)).toBe('doc(paragraph("唯一の段落"))');
});

// Spanning index 0 and 1: the throw landed mid-`nodesBetween`, also reading as a no-op.
test('Mod-Alt-0 over a selection spanning two top-level paragraphs does not throw', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await openEditor(page);

  await loadMarkdown(page, '前の段落\n\n二つ目\n');
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph("前の段落"), paragraph("二つ目"))');

  await setRange(page, 1, await lastTextblockEnd(page));
  await settle(page);

  await page.keyboard.press('Control+Alt+0');
  await settle(page);

  expect(errors).toEqual([]);
  expect(await docString(page)).toBe('doc(paragraph("前の段落"), paragraph("二つ目"))');
});

// `clearNodes` re-types and lifts, the half a narrower fix could lose: measured on the unfixed
// build, this is how a line leaves a list or quote.
const LIFTED: { name: string; md: string; host: string; before: string; after: string }[] = [
  {
    name: 'a list item',
    md: '- 項目\n',
    host: 'bulletList',
    before: 'doc(bulletList(listItem(paragraph("項目"))), paragraph)',
    after: 'doc(paragraph("項目"), paragraph)',
  },
  {
    name: 'a blockquote',
    md: '> 引用\n',
    host: 'blockquote',
    before: 'doc(blockquote(paragraph("引用")), paragraph)',
    after: 'doc(paragraph("引用"), paragraph)',
  },
];

for (const { name, md, host, before, after } of LIFTED) {
  test(`Mod-Alt-0 still lifts a paragraph out of ${name}`, async ({ page }) => {
    const errors = watchErrors(page);
    await openEditor(page);

    await loadMarkdown(page, md);
    await settle(page);
    expect(await docString(page)).toBe(before);

    await setRange(page, await caretInside(page, host));
    await settle(page);
    await page.keyboard.press('Control+Alt+0');
    await settle(page);

    expect(errors).toEqual([]);
    expect(await docString(page)).toBe(after);
  });
}

// A heading converts in place via `setBlockType`, staying in its list item: this path must not lift.
test('Mod-Alt-0 converts a heading in place, leaving it in its list item', async ({ page }) => {
  const errors = watchErrors(page);
  await openEditor(page);

  await loadMarkdown(page, '- 項目\n\n  ## 見出し\n');
  await settle(page);
  expect(await docString(page)).toBe(
    'doc(bulletList(listItem(paragraph("項目"), heading("見出し"))), paragraph)',
  );

  await setRange(page, await caretInside(page, 'heading'));
  await settle(page);
  await page.keyboard.press('Control+Alt+0');
  await settle(page);

  expect(errors).toEqual([]);
  expect(await docString(page)).toBe(
    'doc(bulletList(listItem(paragraph("項目"), paragraph("見出し"))), paragraph)',
  );
});

// A heading at index 1: converts, as before the fix.
test('Mod-Alt-0 converts a top-level heading below a paragraph', async ({ page }) => {
  const errors = watchErrors(page);
  await openEditor(page);

  await page.keyboard.type('前の段落');
  await page.keyboard.press('Enter');
  await page.keyboard.type('## 見出し');
  await settle(page);

  await page.keyboard.press('Control+Alt+0');
  await settle(page);

  expect(errors).toEqual([]);
  expect(await docString(page)).toBe('doc(paragraph("前の段落"), paragraph("見出し"), paragraph)');
});
