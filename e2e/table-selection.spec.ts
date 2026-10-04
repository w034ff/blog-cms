import { test, expect } from '@playwright/test';

// prosemirror-tables tags `.selectedCell`, and the globals.css `.prose .selectedCell::after` overlay
// paints it; without it a cross-cell drag shows nothing.
test('dragging across table cells shows the selection highlight', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  // The 表 button opens a size picker; pick 3×3 from the grid.
  await page.getByRole('button', { name: '表', exact: true }).click();
  await page.getByRole('button', { name: '3行3列の表を挿入' }).click();
  await expect(editor.locator('table')).toBeVisible();

  // Header cells are bare <th> (no <thead>); the first two <td> are adjacent body cells.
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

// 表を削除, red at the BubbleMenu's far end, still removes the table.
test('the table toolbar 表を削除 button removes the table', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  await page.getByRole('button', { name: '表', exact: true }).click();
  await page.getByRole('button', { name: '3行3列の表を挿入' }).click();
  await expect(editor.locator('table')).toBeVisible();

  // The caret is in a cell, so the BubbleMenu (in <body>) is showing.
  const del = page.getByRole('button', { name: '表を削除' });
  await expect(del).toHaveClass(/text-red-600/); // destructive tint
  await del.click();
  await expect(editor.locator('table')).toHaveCount(0);
});
