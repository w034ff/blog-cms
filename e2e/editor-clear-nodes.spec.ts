import { test, expect, type Page } from '@playwright/test';
import { loadMarkdown, setRange } from './editor-authoring';
import { docString, settle } from './editor-probe';

// `Mod-Alt-0` — @tiptap/extension-paragraph's unconditional binding for `setParagraph()`, and the
// only gesture in this editor that reaches TipTap's `clearNodes`. It got there because
// prosemirror-commands' `setBlockType` skips a node that already `hasMarkup` the target, so asking
// for a paragraph while the caret is in one leaves nothing applicable and `setNode` falls through.
//
// `clearNodes` used to pick the replacement type with `contentMatchAt(index).defaultType`, and this
// document is `block+ footnoteSection?` — so past the first child that default is `footnoteSection`
// and the command threw "RangeError: Invalid content for node type footnoteSection". Reported from
// ordinary use: a blank line under a paragraph was enough. components/editor/clear-nodes-extension.ts
// replaces the command with upstream's body picking a textblock instead.
//
// Every case watches `pageerror`, because that is the only thing that can see this failure: the
// throw left the document byte-identical, so a spec asserting only the document reads the crash as
// "the key does nothing" and passes either way.
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

// A caret at the start of the first textblock inside the first node of `typeName`. Found by walking
// the document rather than by arithmetic, so a fixture that nests one level deeper doesn't silently
// point somewhere else.
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

// The last position inside the document's final textblock — the far end of a selection meant to
// span every top-level node. Derived from the document rather than counted out by hand, which for a
// fixture of Japanese text would be an off-by-one waiting to happen.
function lastTextblockEnd(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as Element & {
      editor?: { state: { doc: { content: { size: number } } } };
    };
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    return el.editor.state.doc.content.size - 1;
  });
}

// The report. A blank line below a paragraph is top-level index 1, which is where `defaultType`
// stops being `paragraph` — and it is the most common caret position in a post.
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
  // The correct answer is a no-op: the line is already a paragraph, and a top-level block has
  // nothing to lift out of.
  expect(await docString(page)).toBe('doc(paragraph("本文"), paragraph)');

  // The caret survived, so the key cost the author nothing.
  await page.keyboard.type('つづき');
  expect(await docString(page)).toBe('doc(paragraph("本文"), paragraph("つづき"))');
});

// The same key one index earlier, which never threw — `defaultType` is still `paragraph` at the
// document's first child. Pins that the fix did not change the position that already worked.
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

// A selection spanning index 0 *and* index 1 — the only case where the throw landed part-way
// through `nodesBetween` rather than on the first node it visited. The half-built transaction was
// discarded with the exception, so this read as a no-op too.
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

// `clearNodes` re-types *and lifts*, and the lift is the half a narrower fix would have removed
// without anyone noticing. Both expectations below are the behaviour measured on the unfixed build,
// so they are a real before/after baseline rather than a restatement of the new code: Mod-Alt-0 is
// how an author takes a line back out of a list or a quote.
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

// The conversion the key is actually named for, which never went near `clearNodes`: a heading is a
// different type from a paragraph, so `setBlockType` is applicable and converts in place. Inside a
// list item, so the assertion also says the node stays where it was — this is the path that must
// NOT start lifting.
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

// A heading at top-level index 1 — the same conversion at the position that throws for a paragraph.
// It passed before the fix too (nothing reached clearNodes), and pins that it still does.
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
