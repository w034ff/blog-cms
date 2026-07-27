import { test, expect } from '@playwright/test';

// Drives the toolbar's table size picker: open the dropdown, hover a cell to
// confirm the size readout tracks it, then click to insert a table of exactly
// that many rows/columns (first row a header). Guards the grid → insertTable wiring.
test('table picker inserts a table of the hovered grid size', async ({ page }) => {
  await page.goto('/admin/posts/new');

  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  // Open the dropdown (exact name so it doesn't also match the grid cells, whose
  // labels contain "表").
  await page.getByRole('button', { name: '表', exact: true }).click();

  // Hovering a cell updates the size readout.
  const cell = page.getByRole('button', { name: '2行3列の表を挿入' });
  await cell.hover();
  await expect(page.getByText('2 行 × 3 列')).toBeVisible();

  // Clicking it inserts a 2×3 table (row 1 = header) and closes the menu.
  await cell.click();

  const rows = editor.locator('table tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.first().locator('th')).toHaveCount(3);
  await expect(rows.nth(1).locator('td')).toHaveCount(3);
});

// The dropdown's numeric-input escape hatch: open the dialog, type a size past the
// grid's 8×8 ceiling, and insert. Guards the dialog → insertTable wiring and the
// grid ↔ dialog hand-off.
test('table picker dialog inserts a table from numeric input', async ({ page }) => {
  await page.goto('/admin/posts/new');

  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await page.getByRole('button', { name: '表', exact: true }).click();
  await page.getByRole('button', { name: '行数・列数を入力' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('行数').fill('4');
  await dialog.getByLabel('列数').fill('10');
  await dialog.getByRole('button', { name: '追加' }).click();

  await expect(dialog).toBeHidden();
  const rows = editor.locator('table tr');
  await expect(rows).toHaveCount(4);
  await expect(rows.first().locator('th')).toHaveCount(10);
  await expect(rows.nth(1).locator('td')).toHaveCount(10);
});
