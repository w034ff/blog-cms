import { test, expect, type Page } from '@playwright/test';

// Table cells are paragraph-only (components/editor/table-extensions.ts): markdown cannot
// store block structure inside a cell — the GFM pipe form holds one line of inline content,
// and with the stock `block+` cells a nested code block/list/callout silently flattened to
// its text on save. These specs pin the prevention at every entry point: block input rules
// inside a cell, the callout menu, and the table picker.

async function insertTable(page: Page): Promise<void> {
  await page.getByRole('button', { name: '表', exact: true }).click();
  await page.getByRole('button', { name: '2行2列の表を挿入' }).click();
}

// Block input rules (``` fence, list marker) must not fire inside a cell; the typed text
// stays literal and — the part that used to corrupt — survives a save/reload unchanged.
test('block markdown shortcuts stay literal text inside a cell and round-trip', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await insertTable(page);

  const cells = editor.locator('td');
  await cells.nth(0).click();
  await page.keyboard.type('```ts ');
  await page.keyboard.type('const x = 1');
  await cells.nth(1).click();
  await page.keyboard.type('- 項目1');

  // No block structure materialized inside the cells.
  await expect(editor.locator('td .code-block')).toHaveCount(0);
  await expect(editor.locator('td ul')).toHaveCount(0);
  await expect(cells.nth(0)).toContainText('```ts const x = 1');
  await expect(cells.nth(1)).toContainText('- 項目1');

  // Autosave, then rebuild the editor from the stored markdown: the table and the
  // literal cell text come back intact (previously the fence flattened and a stray
  // serializer artifact appeared after the table).
  await page.getByLabel('タイトル').fill('セル入れ子ガード');
  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await expect(editor).toBeVisible();
  await expect(editor.locator('table')).toHaveCount(1);
  await expect(editor.locator('td').nth(0)).toContainText('```ts const x = 1');
  await expect(editor.locator('td').nth(1)).toContainText('- 項目1');
});

// The callout menu refuses while the caret is in a table (it used to split the table in
// two around the new callout) — and still works from outside the table afterwards.
// Real pointer clicks throughout: they double as the regression test for the floating
// table toolbar's z-20 (it must not cover the main toolbar's dropdown panels).
test('the callout menu is a no-op inside a table and intact outside it', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await insertTable(page);

  await editor.locator('td').first().click();
  await page.getByRole('button', { name: '囲み枠' }).click();
  await page.getByRole('button', { name: '情報', exact: true }).click();
  await expect(editor.locator('.markdown-alert')).toHaveCount(0);
  await expect(editor.locator('table')).toHaveCount(1);

  // Caret below the table (the trailing paragraph): the same menu inserts normally.
  await editor.click({ position: { x: 200, y: 400 } });
  await page.getByRole('button', { name: '囲み枠' }).click();
  await page.getByRole('button', { name: '情報', exact: true }).click();
  await expect(editor.locator('.markdown-alert')).toHaveCount(1);
  await expect(editor.locator('td .markdown-alert')).toHaveCount(0);
  await expect(editor.locator('table')).toHaveCount(1);
});

// The table picker refuses while the caret is in a table (it used to split the host
// table around a new sibling table instead of nesting).
test('the table picker is a no-op inside a table', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await insertTable(page);

  await editor.locator('td').first().click();
  await insertTable(page);

  await expect(editor.locator('table')).toHaveCount(1);
  await expect(editor.locator('td table')).toHaveCount(0);
});
