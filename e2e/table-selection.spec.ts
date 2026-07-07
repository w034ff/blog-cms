import { test, expect } from '@playwright/test';

// Guards the table drag-select highlight: prosemirror-tables tags selected cells
// with .selectedCell, and the globals.css `.prose .selectedCell::after` overlay
// is what actually paints the selection (that overlay is the kept fix — without
// it the drag works but shows nothing, reading as "can't select across cells").
test('dragging across table cells shows the selection highlight', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  // The 表 button opens a size picker; pick 3×3 from the grid.
  await page.getByRole('button', { name: '表', exact: true }).click();
  await page.getByRole('button', { name: '3行3列の表を挿入' }).click();
  await expect(editor.locator('table')).toBeVisible();

  // TipTap renders the header row as bare <th> (no <thead>) and body rows as
  // <td>; the first two <td> are adjacent cells in the first body row.
  const first = editor.locator('td').nth(0);
  const second = editor.locator('td').nth(1);
  const a = await first.boundingBox();
  const b = await second.boundingBox();
  if (!a || !b) throw new Error('table cells not found');

  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();

  const selected = editor.locator('.selectedCell');
  expect(await selected.count()).toBeGreaterThanOrEqual(2);

  // The class alone isn't the fix — assert the overlay is actually painted.
  const overlayBg = await selected
    .first()
    .evaluate((el) => getComputedStyle(el, '::after').backgroundColor);
  expect(overlayBg.replace(/\s/g, '')).toContain('51,144,255');
});
