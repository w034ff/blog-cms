import { test, expect, type Page } from '@playwright/test';
import { caret, docString, markdown, settle } from './editor-probe';

// Tab's goToNextCell selects the destination cell's whole content, and two keys misread it:
//   • ArrowDown/Up: vertical-arrow handling bails on a non-empty selection, so the browser collapsed
//     it sideways instead of changing rows;
//   • Enter / Shift+Enter / Mod+Enter: setHardBreak inserts over the selection, wiping the cell.
// table-extensions.ts recognizes the shape (isWholeTextblockSelected): arrows move a row, break keys
// collapse to the end first. Shift/Mod+Enter come from @tiptap/extension-hard-break, so each key is
// pinned. Home, Shift+End makes the same selection: Playwright's Tab escapes the contenteditable
// (e2e/README.md).

async function insertTable(page: Page, rows: number, cols: number): Promise<void> {
  await page.getByRole('button', { name: '表', exact: true }).click();
  await page.getByRole('button', { name: `${rows}行${cols}列の表を挿入` }).click();
}

// A header row and three filled body rows ("A"/"B"/"C" × 1-3): an empty cell's whole selection is
// empty and never reproduced the bug.
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

// The whole-cell TextSelection goToNextCell leaves.
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
  // The start of B2, directly below, not collapsed sideways.
  expect(await caret(page)).toBe('B2@0');

  // Collapsed now; the next ArrowDown reaches C2.
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

  // No row below: the shortcut defers and ArrowDown exits the table into the trailing paragraph.
  await selectWholeCell(page, rows.nth(3).locator('td').nth(2)); // C3
  await page.keyboard.press('ArrowDown');
  await settle(page);
  expect(await caret(page)).toBe('@0');
  await expect(page.locator('.ProseMirror table tr')).toHaveCount(4);
});

// The headline case: the break keys replaced the selected cell text. The break stays (a second
// paragraph has no pipe form); it goes to the content's end. Mod+Enter is Control+Enter here.
for (const key of ['Enter', 'Shift+Enter', 'Control+Enter']) {
  test(`${key} on a whole-cell selection keeps the content and breaks after it`, async ({
    page,
  }) => {
    const rows = await setUpTable(page);

    await selectWholeCell(page, rows.nth(2).locator('td').nth(1)); // B2
    await page.keyboard.press(key);
    await settle(page);
    expect(await docString(page)).toContain('tableCell(paragraph("B2", hardBreak))');

    // A trailing break writes nothing, so type first; still a pipe table.
    await page.keyboard.type('X');
    await settle(page);
    expect(await docString(page)).toContain('tableCell(paragraph("B2", hardBreak, "X"))');
    expect(await markdown(page)).toContain('| B1 | B2<br>X | B3 |');
  });
}

// Prose keeps its hard break: the guard declines outside a cell.
test('Shift+Enter outside a table still makes a hard break', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await settle(page);

  await page.keyboard.type('x');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('y');
  await settle(page);
  expect(await docString(page)).toContain('paragraph("x", hardBreak, "y")');
});

// A hand-made partial selection is still replaced; only Tab's whole-textblock shape is navigation.
test('Enter over a partial selection in a cell still replaces it', async ({ page }) => {
  const rows = await setUpTable(page);

  const cell = rows.nth(2).locator('td').nth(1); // B2
  await cell.click();
  await settle(page);
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+ArrowRight');
  await settle(page);

  await page.keyboard.press('Enter');
  await settle(page);
  expect(await docString(page)).toContain('tableCell(paragraph(hardBreak, "2"))');
});
