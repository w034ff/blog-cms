import { test, expect, type Page } from '@playwright/test';
import { docString, historyState } from './editor-probe';
import { closeHistory, loadMarkdown, selectNode, setRange } from './editor-authoring';

// The accordion's slice rules (docs/accordion-requirements.md §6.2, §6.3):
//   • placement: top level only, so a slice carrying one into a quote, list, callout or cell is
//     refused (drop) or unboxed (paste);
//   • the half-selected repair unwraps two levels, not the callout's one: `[detailsSummary,
//     detailsContent]` may not live outside, so the title returns as a paragraph.

const MD =
  '前の段落です\n\n<details>\n<summary>題名</summary>\n\n畳んだ本文\n\n</details>\n\n後の段落です\n';
const DOC =
  'doc(paragraph("前の段落です"), details(detailsSummary("題名"), detailsContent(paragraph("畳んだ本文"))), paragraph("後の段落です"))';

async function openEditor(page: Page, markdown = MD, doc = DOC): Promise<void> {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, markdown);
  expect(await docString(page)).toBe(doc);
}

async function copyThenCaret(page: Page, from: number, to: number, at: number): Promise<void> {
  await setRange(page, from, to);
  await page.keyboard.press('Control+c');
  await setRange(page, at);
}

test('a whole accordion pasted into a quote arrives as plain blocks', async ({ page }) => {
  await openEditor(
    page,
    `${MD}\n> 引用文\n`,
    'doc(paragraph("前の段落です"), details(detailsSummary("題名"), detailsContent(paragraph("畳んだ本文"))), paragraph("後の段落です"), blockquote(paragraph("引用文")), paragraph)',
  );

  await selectNode(page, 'details');
  await page.keyboard.press('Control+c');
  // Caret in the quote.
  const at = await page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as
      | (Element & {
          editor?: { state: { doc: { descendants(f: (n: unknown, p: number) => void): void } } };
        })
      | null;
    let pos = 0;
    el?.editor?.state.doc.descendants((node, p) => {
      if ((node as { type: { name: string } }).type.name === 'blockquote') pos = p + 2;
    });
    return pos;
  });
  await setRange(page, at);
  await page.keyboard.press('Control+v');

  const doc = await docString(page);
  // No box: the title as a paragraph, then the body.
  expect(doc).toContain('blockquote(paragraph("題名"), paragraph("畳んだ本文")');
  expect(doc).not.toContain('blockquote(details');
});

test('a copy crossing the accordion edge pastes without building one', async ({ page }) => {
  await openEditor(page);
  // From the body into the paragraph below: open at the start, closed at the end.
  await copyThenCaret(page, 14, 24, 7);
  await page.keyboard.press('Control+v');

  const doc = await docString(page);
  expect(doc).not.toContain('paragraph("前の段落です"), details');
  // No bare child types escaped.
  expect(doc.match(/detailsSummary/g) ?? []).toHaveLength(1);
  expect(doc.match(/detailsContent/g) ?? []).toHaveLength(1);
});

// §9 criterion 16: a folded body is `hidden` but in the document, so select-all takes it and one undo
// restores title and body. Typed, not loaded: undo after a load rolls back the load.
test('a folded accordion is selected, deleted and restored by one undo', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.keyboard.type(':::details ');
  await page.keyboard.type('題名');
  const built = await docString(page);
  expect(built).toContain('detailsSummary("題名")');

  // Fold it (insertion leaves it open, §7.4); the toggle touches neither document nor history.
  await page.locator('.ProseMirror [data-type="details"] > button').click();
  // Folded: in the document, not on screen.
  await expect(page.locator('.ProseMirror [data-type="detailsContent"]')).toBeHidden();
  expect(await docString(page)).toBe(built);

  // Break the history, or the deletion joins the typing (e2e/README.md).
  await closeHistory(page);
  const before = (await historyState(page)).undoDepth;

  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  expect(await docString(page)).not.toContain('details');
  // The deletion is its own event.
  expect((await historyState(page)).undoDepth).toBe(before + 1);

  await page.keyboard.press('Control+z');
  expect(await docString(page)).toBe(built);
  // Only that event undone.
  expect((await historyState(page)).undoDepth).toBe(before);
});

test('the accordion has a drag handle while folded', async ({ page }) => {
  await openEditor(page);
  const handle = page.locator('.ProseMirror .block-drag-handle');
  await page.locator('.ProseMirror [data-type="details"]').hover();
  await expect(handle).toBeVisible();
});
