import { test, expect, type Page } from '@playwright/test';
import { docString } from './editor-probe';
import { loadMarkdown, selectNode, setRange } from './editor-authoring';

// The accordion's slice rules (docs/accordion-requirements.md §6.2, §6.3). Two of them, and
// neither is the callout's:
//
//   • placement — an accordion may only ever land at the document's top level, so a slice
//     carrying one into a quote, a list, a callout or a cell is refused (drop) or has its box
//     dropped and its contents kept (paste);
//   • the half-selected repair — a selection crossing an accordion's edge hands the gesture the
//     accordion node itself. Unwrapping it one level, which is what the callout guard does, would
//     splice `[detailsSummary, detailsContent]` into the document: neither may live there, so the
//     unwrap goes two levels and the title comes back as a paragraph.
//
// Browser-only: the repair rides prosemirror-view's transformPasted, and the placement question is
// asked of a resolved drop/paste target in the live editor.

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
  // Caret inside the quote.
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
  // The box did not go in — the title came back as a paragraph and the body followed it.
  expect(doc).toContain('blockquote(paragraph("題名"), paragraph("畳んだ本文")');
  expect(doc).not.toContain('blockquote(details');
});

test('a copy crossing the accordion edge pastes without building one', async ({ page }) => {
  await openEditor(page);
  // From inside the body out into the paragraph below: the slice carries the accordion, cut open
  // at the start and closed at the end — the shape that forces the box to be kept.
  await copyThenCaret(page, 14, 24, 7);
  await page.keyboard.press('Control+v');

  const doc = await docString(page);
  expect(doc).not.toContain('paragraph("前の段落です"), details');
  // Nothing bare escaped into the document: both child types only ever appear inside an accordion.
  expect(doc.match(/detailsSummary/g) ?? []).toHaveLength(1);
  expect(doc.match(/detailsContent/g) ?? []).toHaveLength(1);
});

// §9 criterion 16: a folded accordion's body is `hidden` but still in the document, so a
// select-all has to take it and one undo has to bring the whole thing back — title and body
// together, even though only the title was ever on screen.
//
// Built by typing rather than loaded: `setContent` puts the whole load into one history event, so
// an undo after loading rolls back the load itself and lands on an empty document. Authoring the
// accordion the way an author would keeps the deletion as its own event, which is the thing under
// test.
test('a folded accordion is selected, deleted and restored by one undo', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.keyboard.type(':::details ');
  await page.keyboard.type('題名');
  const built = await docString(page);
  expect(built).toContain('detailsSummary("題名")');

  // Insertion leaves an accordion open (§7.4), so folding it is now part of setting this test up
  // rather than something to assert. The toggle is a view action — it touches neither the document
  // nor prosemirror-history — so it cannot disturb what follows.
  await page.locator('.ProseMirror [data-type="details"] > button').click();
  // Folded: the body is in the document but not on screen.
  await expect(page.locator('.ProseMirror [data-type="detailsContent"]')).toBeHidden();
  expect(await docString(page)).toBe(built);

  // prosemirror-history groups changes made within 500ms of each other into one undo event, and a
  // scripted test types far faster than that — without this pause the deletion joins the
  // authoring and a single undo rolls back both, which would say nothing about the deletion.
  await page.waitForTimeout(700);

  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  expect(await docString(page)).not.toContain('details');

  await page.keyboard.press('Control+z');
  expect(await docString(page)).toBe(built);
});

test('the accordion has a drag handle while folded', async ({ page }) => {
  await openEditor(page);
  const handle = page.locator('.ProseMirror .block-drag-handle');
  await page.locator('.ProseMirror [data-type="details"]').hover();
  await expect(handle).toBeVisible();
});
