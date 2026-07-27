import { test, expect, type Page } from '@playwright/test';
import { caret, settle } from './editor-probe';

// Tab's own goToNextCell (prosemirror-tables) selects the destination cell's entire
// content, mirroring spreadsheet overwrite-on-type UX. That non-empty TextSelection
// makes prosemirror-view's vertical-arrow handling (and prosemirror-tables' own
// arrow("vert") keymap) bail out entirely, so ArrowDown/Up right after Tab used to
// fall through to the browser's native "collapse selection to its edge" behavior
// instead of changing rows — looking like a sideways jump. table-extensions.ts adds
// a keyboard shortcut that recognizes that exact shape (isWholeTextblockSelected) and
// moves a row instead.
//
// These specs reproduce that selection shape with Home, Shift+End instead of an
// actual Tab press: Playwright's synthetic Tab key, dispatched via CDP, escapes the
// contenteditable to the browser's native focus-cycling here rather than reaching
// ProseMirror's own Tab handler — a harness/CDP quirk (real keypresses in the
// browser this bug was reported from do not do this), unrelated to the fix itself.
// The fix only cares about the resulting selection shape, not how it got there, so
// Home/Shift+End reproduces the exact same non-empty, whole-cell TextSelection
// without depending on synthetic Tab.

async function insertTable(page: Page, rows: number, cols: number): Promise<void> {
  await page.getByRole('button', { name: '表', exact: true }).click();
  await page.getByRole('button', { name: `${rows}行${cols}列の表を挿入` }).click();
}

// 1 header row + 3 body rows x 3 cols ("A"/"B"/"C" rows, cols 1-3), each body cell
// pre-filled (non-empty content is what makes a whole-cell selection non-empty, the
// shape the bug needs — an empty cell's "whole selection" is trivially the empty
// selection, which never reproduced the bug in the first place).
async function setUpTable(page: Page): Promise<ReturnType<Page['locator']>> {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await insertTable(page, 4, 3);

  const rows = editor.locator('table tr');
  const labels = [
    ['A1', 'A2', 'A3'],
    ['B1', 'B2', 'B3'],
    ['C1', 'C2', 'C3'],
  ];
  for (let r = 0; r < labels.length; r += 1) {
    const cells = rows.nth(r + 1).locator('td');
    for (let c = 0; c < labels[r].length; c += 1) {
      await cells.nth(c).click();
      await settle(page);
      await page.keyboard.type(labels[r][c]);
    }
  }
  return rows;
}

// Select a cell's whole content the same way Tab's goToNextCell leaves it: a
// non-empty TextSelection spanning the entire textblock, start to end.
async function selectWholeCell(page: Page, cell: ReturnType<Page['locator']>): Promise<void> {
  await cell.click();
  await settle(page);
  await page.keyboard.press('Home');
  await settle(page);
  await page.keyboard.press('Shift+End');
  await settle(page);
}

test('ArrowDown on a whole-cell selection moves to the row below, and keeps moving down', async ({
  page,
}) => {
  const rows = await setUpTable(page);

  await selectWholeCell(page, rows.nth(1).locator('td').nth(1)); // A2
  await page.keyboard.press('ArrowDown');
  await settle(page);
  // Landed at the start of the cell directly below (row 2, col 1 = "B2"), not
  // collapsed sideways in place.
  expect(await caret(page)).toBe('B2@0');

  // Selection is now collapsed; a second ArrowDown should keep moving down
  // normally (no chaining weirdness) into row 3, col 1 = "C2".
  await page.keyboard.press('ArrowDown');
  await settle(page);
  expect(await caret(page)).toMatch(/^C2@/);
});

test('ArrowUp on a whole-cell selection moves to the row above', async ({ page }) => {
  const rows = await setUpTable(page);

  await selectWholeCell(page, rows.nth(3).locator('td').nth(1)); // C2
  await page.keyboard.press('ArrowUp');
  await settle(page);
  expect(await caret(page)).toBe('B2@0');
});

test('plain ArrowDown/Up with a collapsed cursor still move between rows normally', async ({
  page,
}) => {
  const rows = await setUpTable(page);

  await rows.nth(1).locator('td').nth(0).click(); // A1
  await settle(page);
  await page.keyboard.press('ArrowDown');
  await settle(page);
  expect(await caret(page)).toMatch(/^B1@/);

  await page.keyboard.press('ArrowUp');
  await settle(page);
  expect(await caret(page)).toMatch(/^A1@/);
});

test('ArrowDown on a whole-cell selection in the last row exits the table, not sideways', async ({
  page,
}) => {
  const rows = await setUpTable(page);

  // No row below the last row, so nextCell finds nothing and the shortcut defers;
  // this falls through to the same "exit the table downward" behavior an ordinary
  // collapsed ArrowDown already has there (see editor-block-drag-handle.spec.ts's
  // table case) — landing in the empty trailing paragraph, not stuck sideways in C3.
  await selectWholeCell(page, rows.nth(3).locator('td').nth(2)); // C3
  await page.keyboard.press('ArrowDown');
  await settle(page);
  expect(await caret(page)).toBe('@0');
  await expect(page.locator('.ProseMirror table tr')).toHaveCount(4);
});
