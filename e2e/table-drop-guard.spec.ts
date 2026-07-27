import { test, expect, type Page, type Locator } from '@playwright/test';

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
// handleDrop fires on the *native* `drop` DOM event — but page.mouse.down()/move()/
// up() only dispatch trusted mouse events and never complete a native drag (the OS
// drag loop is never driven), so ProseMirror's `dragstart` runs yet the matching
// `drop` never does. The guard is therefore untestable through the normal mouse API.
//
// The way in is the Chrome DevTools Protocol. A real mouse-driven `dragstart` still
// fires (so ProseMirror sets view.dragging — the source of the dropped slice and the
// move flag), and Input.setInterceptDrags suppresses the OS drag loop that would
// otherwise stall it. Headless Chromium never emits Input.dragIntercepted for a
// text-selection drag, so rather than wait for it we synthesize the DragData and
// replay dragEnter/dragOver/drop at the target via Input.dispatchDragEvent — a
// deterministic native `drop` that reaches the guard's handleDrop. (The dropped
// slice still comes from view.dragging, so this stays faithful to a real text move.)

// Shape of the Input.DragData we hand to Input.dispatchDragEvent. The CDPSession
// command types already carry the full Protocol shape; this is the narrow subset we
// build, kept explicit to avoid leaning on the internal Protocol namespace.
interface DragData {
  items: { mimeType: string; data: string }[];
  files?: string[];
  dragOperationsMask: number;
}

type Point = { x: number; y: number };

// A native HTML5 drag from `from` to `to`, driven at the CDP level (see file header).
async function cdpNativeDrag(page: Page, from: Point, to: Point): Promise<void> {
  const client = await page.context().newCDPSession(page);
  try {
    // Suppress the real OS drag loop so it can't race the CDP-driven drop below.
    await client.send('Input.setInterceptDrags', { enabled: true });

    // Begin a real drag from inside the current selection. Crossing the drag
    // threshold fires the DOM `dragstart` (ProseMirror sets view.dragging, which is
    // the source of the slice + the move flag its drop handler acts on). Headless
    // Chromium fires dragstart but never emits Input.dragIntercepted for a
    // text-selection drag, so we don't wait for it — we synthesize the DragData and
    // drive the drop ourselves; the slice comes from view.dragging regardless.
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 8, from.y + 8, { steps: 6 });

    const selectedText = await page.evaluate(() => window.getSelection()?.toString() ?? '');
    const data: DragData = {
      items: [{ mimeType: 'text/plain', data: selectedText }],
      dragOperationsMask: 16, // Move
    };

    // Replay the movement and the drop at the target as native drag events. The
    // `drop` is the DOM event tableDropGuard's handleDrop listens for.
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await client.send('Input.dispatchDragEvent', { type: 'dragEnter', x: to.x, y: to.y, data });
    await client.send('Input.dispatchDragEvent', { type: 'dragOver', x: to.x, y: to.y, data });
    await client.send('Input.dispatchDragEvent', { type: 'drop', x: to.x, y: to.y, data });
    await page.mouse.up();
  } finally {
    await client.send('Input.setInterceptDrags', { enabled: false });
    await client.detach();
  }
}

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
