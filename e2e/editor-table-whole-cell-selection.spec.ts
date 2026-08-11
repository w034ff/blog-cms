import { test, expect, type Page } from '@playwright/test';
import { caret, docString, markdown, settle } from './editor-probe';

// Tab's own goToNextCell (prosemirror-tables) selects the destination cell's entire
// content, mirroring spreadsheet overwrite-on-type UX. Two different keys then read
// that non-empty TextSelection wrongly, and both are pinned here:
//
//   • ArrowDown/Up — prosemirror-view's vertical-arrow handling (and prosemirror-tables'
//     own arrow("vert") keymap) bail out on a non-empty selection entirely, so an arrow
//     right after Tab used to fall through to the browser's native "collapse selection to
//     its edge" behavior instead of changing rows — looking like a sideways jump.
//   • Enter / Shift+Enter / Mod+Enter — all three make a hard break in a cell, and
//     setHardBreak is an insert, so it replaced the selection: Tab then any of them wiped
//     the destination cell's content and left only the break. Worse than the arrows, since
//     that is data loss on a gesture that reads as pure navigation.
//
// table-extensions.ts answers both by recognizing that exact shape
// (isWholeTextblockSelected): the arrows move a row, and the break keys collapse to the
// end of the cell before inserting. Shift/Mod+Enter belong to @tiptap/extension-hard-break,
// which calls setHardBreak directly, so the table extension has to intercept them to get
// them past the same guard — which is exactly why they are pinned here by key, not by
// trusting that one code path covers all three.
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

// The headline case: after Tab the cell's whole content is selected, and setHardBreak is
// an insert, so the break keys used to replace it — `tableCell(paragraph(hardBreak))`, the
// text gone. The break is what they all do in a cell (a second paragraph has no pipe form,
// see table-extensions.ts), so the fix is where it goes, not what it is: to the end of the
// content rather than over it. Mod+Enter is Control+Enter on this harness's platform.
for (const key of ['Enter', 'Shift+Enter', 'Control+Enter']) {
  test(`${key} on a whole-cell selection keeps the content and breaks after it`, async ({
    page,
  }) => {
    const rows = await setUpTable(page);

    await selectWholeCell(page, rows.nth(2).locator('td').nth(1)); // B2
    await page.keyboard.press(key);
    await settle(page);
    expect(await docString(page)).toContain('tableCell(paragraph("B2", hardBreak))');

    // A trailing break writes nothing (prosemirror-markdown's hard_break serializer skips
    // one with no content after it), so the second line is typed before the markdown is
    // asserted — and the table is still a pipe table, which is what the break buys.
    await page.keyboard.type('X');
    await settle(page);
    expect(await docString(page)).toContain('tableCell(paragraph("B2", hardBreak, "X"))');
    expect(await markdown(page)).toContain('| B1 | B2<br>X | B3 |');
  });
}

// Intercepting Shift+Enter for the table must not cost prose its own hard break: the guard
// declines outside a cell and @tiptap/extension-hard-break's binding answers as before.
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

// The other half of the rule: a selection the author actually made is still replaced, the
// same as typing over it would. Only the whole-textblock shape Tab leaves behind is treated
// as navigation — "B" here is selected by hand and goes.
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
