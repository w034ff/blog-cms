import { test, expect, type Page, type Locator } from '@playwright/test';
import { cdpNativeDrag, dragSelect, type Point } from './native-drag';
import { docString, markdown } from './editor-probe';
import { loadMarkdown } from './editor-authoring';

// PROTOTYPE (試作): a regression guard for 43f9917 "keep table drag-and-drop from
// growing the table", the case the E2E harness deliberately left for later because
// Playwright's mouse API can't drive a native HTML5 drag to completion.
//
// The 43f9917 fix is a ProseMirror `handleDrop` hook (tableDropGuard in
// components/editor/table-extensions.ts) that blocks the two drops which turn a text
// move into table structure. Each has its own test below:
//   1. a drop in a table but not in any cell (a cell/row boundary) → ProseMirror
//      fits the slice into a stray cell, which fixTables rectangularizes into a
//      whole spurious column/row (the table *grows*);
//   2. a drop in a cell but at block level (its top/bottom edge) → a second
//      paragraph is added to the cell, which forces the table out of the clean GFM
//      pipe form into an HTML fallback.
//
// handleDrop fires on the *native* `drop` DOM event, which the normal mouse API can
// never produce — see e2e/native-drag.ts for why, and for the CDP machinery
// cdpNativeDrag uses to get one.

// Structural fingerprint of the first table in the editor. 43f9917's two failure
// modes both show up here: a stray column/row grows columns/rows/cells; a cell's
// block-level drop adds a second <p> (which is what forces the GFM→HTML fallback).
async function tableShape(page: Page) {
  const editor = page.locator('.ProseMirror');
  const columns = await editor.locator('tr').first().locator('th,td').count();
  const rows = await editor.locator('tr').count();
  const cells = await editor.locator('th,td').count();
  const maxParagraphsPerCell = await editor
    .locator('th,td')
    .evaluateAll((cellEls) => Math.max(0, ...cellEls.map((c) => c.querySelectorAll('p').length)));
  return { columns, rows, cells, maxParagraphsPerCell };
}

// New editor + a draggable "DRAGME" paragraph above a fresh 3×3 table, with that
// word already selected and ready to drag. Returns the editor and the on-screen
// centre of the selection to start the drag from.
async function seedTableAndSelectSource(page: Page): Promise<{ editor: Locator; source: Point }> {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  // A draggable source paragraph above a 3×3 table (picked from the toolbar's
  // size grid). Enter first, so insertTable lands in the empty paragraph and
  // leaves "DRAGME" as its own block above the table.
  await page.keyboard.type('DRAGME');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '表', exact: true }).click();
  await page.getByRole('button', { name: '3行3列の表を挿入' }).click();
  await expect(editor.locator('table')).toBeVisible();
  await expect(editor.locator('table').getByText('DRAGME')).toHaveCount(0);

  // Select the source word so ProseMirror will drag it (dragstart only fires on a
  // mousedown inside a live selection). Do it via the keyboard: insertTable leaves
  // the cursor in a cell, which shows the table BubbleMenu right over "DRAGME" and
  // would intercept a mouse click — ArrowUp exits the table so the menu hides, and
  // it stays hidden through the drag since the selection never re-enters the table.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  const box = await editor.getByText('DRAGME', { exact: true }).boundingBox();
  if (!box) throw new Error('source text not found');
  return { editor, source: { x: box.x + box.width / 2, y: box.y + box.height / 2 } };
}

// prosemirror-dropcursor's indicator, under either of the two classes it toggles between.
const DROP_CURSOR = '.prosemirror-dropcursor-block, .prosemirror-dropcursor-inline';

// The refusal notice, shared with the paste guard: it is one rule about what a cell may hold, so it
// gets one message, worded for both gestures.
const NOTICE = '表のセルにはこの要素を入れられません';

const TABLE_MD = '| 見出しA | 見出しB |\n| --- | --- |\n| セルの中身 | 二つ目 |';

// A document with `block` between a paragraph and a table, and `text` the line inside that block to
// drag-select into. Dragging *into* the block is what puts the block node in the slice — the same
// shape a copy of the same range puts on the clipboard, which is why paste and drop have to answer
// it the same way.
const BLOCKS = {
  blockquote: { block: '> 引用の中身です', text: '引用の中身です' },
  // The isolating one, and the reason it is in this loop rather than represented by the quote: a
  // selection crossing a code block's edge is clamped by isolating-boundary.ts, which performs the
  // drop *itself* and so is asked before this guard. Without the fall-through it added, this drag
  // split the table while the identical paste was refused.
  codeBlock: { block: '```ts:a.ts\nconst x = 1;\n```', text: 'const x = 1;' },
  bulletList: { block: '- 箇条書きの項目', text: '箇条書きの項目' },
} as const;

async function openWithBlockAbove(page: Page, block: string): Promise<Locator> {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, `前の段落です\n\n${block}\n\n${TABLE_MD}`);
  return editor;
}

// The centre of the body cell 「セルの中身」's own text — inside the textblock, not at the cell's
// block edge, so it is the *slice* being refused here and not the position (which case 2 above
// already covers).
async function bodyCellText(editor: Locator): Promise<Point> {
  const cell = await editor.getByText('セルの中身').boundingBox();
  if (!cell) throw new Error('body cell not found');
  return { x: cell.x + cell.width / 2, y: cell.y + cell.height / 2 };
}

// A cell is `paragraph+`, so a block dropped into one splits the table in two around it — exactly
// what tableCellPasteGuard refuses on the paste path, reached by a different gesture. Measured
// before the guard covered it, dropping a quote into 「セルの中身」's text:
//
//   table(row(th, th), row(td("セルの中身の段落です"), td EMPTY)),
//   blockquote(paragraph("引用")), table(row(td("二つ目")))
//
// — the host table torn in two, a cell emptied, and the trailing fragment headerless and so saved
// as raw HTML.
for (const [name, { block, text }] of Object.entries(BLOCKS)) {
  test(`dropping a ${name} into a cell's text is refused`, async ({ page }) => {
    const editor = await openWithBlockAbove(page, block);
    const before = await docString(page);

    const above = await editor.getByText('前の段落です').boundingBox();
    const inside = await editor.getByText(text).boundingBox();
    if (!above || !inside) throw new Error('missing boxes');
    const dragFrom = await dragSelect(
      page,
      { x: above.x + 10, y: above.y + above.height / 2 },
      { x: inside.x + 20, y: inside.y + inside.height / 2 },
    );

    await cdpNativeDrag(page, dragFrom, await bodyCellText(editor), async () => {
      // Refused before the mouse comes up: the indicator never promises this landing.
      await expect(page.locator(DROP_CURSOR)).toHaveCount(0);
    });

    // A refused drop is a no-op — the source is not deleted either, since the deletion is the
    // drop's own — so the whole document is the assertion.
    expect(await docString(page)).toBe(before);
    expect(await markdown(page)).not.toContain('<table');
    await expect(page.getByRole('status')).toHaveText(NOTICE);
  });
}

// The fourth block, and the one the paste path deliberately does *not* refuse: a whole table.
// prosemirror-tables' own handlePaste claims every table-carrying paste and merges it cell-wise —
// that is what makes cell-to-cell paste work — but it hooks no drop, so a dropped table slice goes
// in through ordinary fitting and tears the host table like any other block. Measured: it left a
// headerless `table(tableRow(tableCell("元二")))` fragment behind, saved as raw HTML.
test('dropping a whole table into a cell is refused', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(
    page,
    `${TABLE_MD}\n\n前の段落です\n\n| 別A | 別B |\n| --- | --- |\n| 別セル | 別二 |\n\n後の段落です`,
  );
  const before = await docString(page);

  // Selecting from the paragraph above the second table to the one below it covers that table
  // end-to-end, so the slice carries the whole node.
  const above = await editor.getByText('前の段落です').boundingBox();
  const below = await editor.getByText('後の段落です').boundingBox();
  if (!above || !below) throw new Error('missing boxes');
  const dragFrom = await dragSelect(
    page,
    { x: above.x + 10, y: above.y + above.height / 2 },
    { x: below.x + 40, y: below.y + below.height / 2 },
  );

  await cdpNativeDrag(page, dragFrom, await bodyCellText(editor));

  expect(await docString(page)).toBe(before);
  expect(await markdown(page)).not.toContain('<table');
  await expect(page.getByRole('status')).toHaveText(NOTICE);
});

// The other half of the rule, and the one that would break if the guard refused by position or by
// "the slice mentions a block": ordinary text dragged into a cell is a normal edit. It lands, the
// indicator says so beforehand, and the table keeps its pipe form.
test('plain text can still be dragged into a cell', async ({ page }) => {
  const editor = await openWithBlockAbove(page, '> 引用の中身です');
  const before = await docString(page);

  const above = await editor.getByText('前の段落です').boundingBox();
  if (!above) throw new Error('missing box');
  const dragFrom = await dragSelect(
    page,
    { x: above.x + 2, y: above.y + above.height / 2 },
    { x: above.x + 40, y: above.y + above.height / 2 },
  );

  await cdpNativeDrag(page, dragFrom, await bodyCellText(editor), async () =>
    expect(page.locator(DROP_CURSOR)).toHaveCount(1),
  );

  const after = await docString(page);
  expect(after, after).not.toBe(before);
  await expect(editor.locator('table')).toHaveCount(1);
  await expect(editor.locator('th,td')).toHaveCount(4);
  expect(await markdown(page)).not.toContain('<table');
});

// Case 1 — a drop in the table's structure, not a cell: the seam between the header
// row and the first body row. 43f9917 without the guard turns this into a stray cell
// that fixTables squares off into a whole extra row/column.
test('a native drop at a table cell/row boundary does not grow the table', async ({ page }) => {
  const { editor, source } = await seedTableAndSelectSource(page);

  const before = await tableShape(page);
  expect(before.columns).toBe(3);
  expect(before.maxParagraphsPerCell).toBe(1);

  const headerBox = await editor.locator('th').first().boundingBox();
  if (!headerBox) throw new Error('table header cell not found');
  await cdpNativeDrag(page, source, {
    x: headerBox.x + headerBox.width / 2,
    y: headerBox.y + headerBox.height, // the header/body row boundary
  });

  // The guard cancels the drop, so the table keeps its exact shape and the source
  // text stays put (a cancelled drop is a no-op, not a move that deletes the source).
  expect(await tableShape(page)).toEqual(before);
  await expect(editor.getByText('DRAGME', { exact: true })).toBeVisible();
});

// Case 2 — a drop inside a cell but at block level: its top edge, just under the
// border. 43f9917 without the guard adds a *second* paragraph to that cell, and a
// two-block cell can't serialize as a GFM pipe row, so the whole table falls back to
// an HTML <table> (dropping column alignment on the sanitized public page). The
// second <p> is the DOM tell, caught by tableShape's maxParagraphsPerCell.
test('a native drop at a cell block edge does not add a second paragraph', async ({ page }) => {
  const { editor, source } = await seedTableAndSelectSource(page);

  const before = await tableShape(page);
  expect(before.columns).toBe(3);
  expect(before.maxParagraphsPerCell).toBe(1);

  const cellBox = await editor.locator('td').first().boundingBox();
  if (!cellBox) throw new Error('table body cell not found');
  await cdpNativeDrag(page, source, {
    x: cellBox.x + cellBox.width / 2,
    y: cellBox.y + 3, // the cell's top block edge, above its paragraph's text
  });

  // The guard cancels the drop: the cell keeps a single paragraph (still GFM), the
  // table is otherwise untouched, and the source text stays put.
  expect(await tableShape(page)).toEqual(before);
  await expect(editor.getByText('DRAGME', { exact: true })).toBeVisible();
});
