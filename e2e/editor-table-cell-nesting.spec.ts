import { test, expect, type Page } from '@playwright/test';
import { docString } from './editor-probe';
import { expectAutosaved, loadMarkdown, selectAcross } from './editor-authoring';

// Cells are paragraph-only (table-extensions.ts): the pipe form holds one line, and `block+` cells
// flattened nested blocks on save. Pinned at every entry: input rules, the callout menu, the
// table picker.

async function insertTable(page: Page): Promise<void> {
  await page.getByRole('button', { name: '表', exact: true }).click();
  await page.getByRole('button', { name: '2行2列の表を挿入' }).click();
}

// No block input rules in a cell: the typed text stays literal and survives a reload.
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

  // No block structure in the cells.
  await expect(editor.locator('td .code-block')).toHaveCount(0);
  await expect(editor.locator('td ul')).toHaveCount(0);
  await expect(cells.nth(0)).toContainText('```ts const x = 1');
  await expect(cells.nth(1)).toContainText('- 項目1');

  // Save and reload: the table and the literal text return intact.
  await page.getByLabel('タイトル').fill('セル入れ子ガード');
  await expectAutosaved(page);
  await page.reload();
  await expect(editor).toBeVisible();
  await expect(editor.locator('table')).toHaveCount(1);
  await expect(editor.locator('td').nth(0)).toContainText('```ts const x = 1');
  await expect(editor.locator('td').nth(1)).toContainText('- 項目1');
});

// In a table the callout menu greys out (`editor.can().setCallout()`; the quote case is in
// editor-callout-menu.spec.ts). Real clicks also check the table toolbar's z-20 stays under the
// main toolbar's panels.
test('the callout menu is disabled inside a table and intact outside it', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await insertTable(page);

  const trigger = page.getByRole('button', { name: '囲み枠' });
  await editor.locator('td').first().click();
  await expect(trigger).toBeDisabled();
  await expect(editor.locator('.markdown-alert')).toHaveCount(0);
  await expect(editor.locator('table')).toHaveCount(1);

  // Below the table, it inserts.
  await editor.click({ position: { x: 200, y: 400 } });
  await expect(trigger).toBeEnabled();
  await trigger.click();
  await page.getByRole('button', { name: '情報', exact: true }).click();
  await expect(editor.locator('.markdown-alert')).toHaveCount(1);
  await expect(editor.locator('td .markdown-alert')).toHaveCount(0);
  await expect(editor.locator('table')).toHaveCount(1);
});

// In a table the picker greys out (`editor.can().insertTable()`); the floating TableToolbar edits
// rows and columns instead.
test('the table picker is disabled inside a table', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  const trigger = page.getByRole('button', { name: '表', exact: true });
  await expect(trigger).toBeEnabled(); // top level: a table can be inserted here
  await insertTable(page);

  await editor.locator('td').first().click();
  await expect(trigger).toBeDisabled();
  await expect(editor.locator('table')).toHaveCount(1);
  await expect(editor.locator('td table')).toHaveCount(0);

  // The table toolbar is offered instead.
  await expect(page.getByRole('button', { name: '行を追加' })).toBeVisible();

  // Below the table, it works.
  await editor.click({ position: { x: 200, y: 400 } });
  await expect(trigger).toBeEnabled();
  await insertTable(page);
  await expect(editor.locator('table')).toHaveCount(2);
});

// The quote button reads toggleBlockquote, false in a cell. A code block still takes a quote.
test('the quote button is disabled inside a table cell', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await insertTable(page);

  const quote = page.getByRole('button', { name: '引用' });
  await editor.locator('td').first().click();
  await expect(quote).toBeDisabled();

  // Outside, it works.
  await editor.click({ position: { x: 200, y: 400 } });
  await expect(quote).toBeEnabled();
  await quote.click();
  await expect(editor.locator('blockquote')).toHaveCount(1);
});

// isInTable reads `$head` alone, so a selection dragged up out of a table passed and insertTable
// replaced the range with an empty table. The guard scans the range (selection-scan.ts).
for (const backward of [false, true]) {
  test(`a ${backward ? 'backward' : 'forward'} selection reaching into a table cannot insert one`, async ({
    page,
  }) => {
    await page.goto('/admin/posts/new');
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();
    await editor.click();

    await loadMarkdown(page, 'text\n\n| a | b |\n| --- | --- |\n| c | d |\n');
    const before = await docString(page);
    expect(before).toContain('tableCell(paragraph("c"))');

    await selectAcross(page, 'table', { backward });

    // A selection touching the table greys the trigger too.
    await expect(page.getByRole('button', { name: '表', exact: true })).toBeDisabled();

    // The command refuses; the table keeps its cells.
    const inserted = await page.evaluate(() => {
      const el = document.querySelector('.ProseMirror') as
        | (Element & {
            editor?: {
              commands: {
                insertTable(o: { rows: number; cols: number; withHeaderRow: boolean }): boolean;
              };
            };
          })
        | null;
      if (!el?.editor) throw new Error('no live editor on .ProseMirror');
      return el.editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
    });
    expect(inserted).toBe(false);
    expect(await docString(page)).toBe(before);
  });
}
