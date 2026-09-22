import { test, expect, type Page } from '@playwright/test';
import { docString } from './editor-probe';
import { expectAutosaved, loadMarkdown, selectAcross } from './editor-authoring';

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
  await expectAutosaved(page);
  await page.reload();
  await expect(editor).toBeVisible();
  await expect(editor.locator('table')).toHaveCount(1);
  await expect(editor.locator('td').nth(0)).toContainText('```ts const x = 1');
  await expect(editor.locator('td').nth(1)).toContainText('- 項目1');
});

// The callout menu refuses while the caret is in a table (it used to split the table in
// two around the new callout) — and still works from outside the table afterwards. The
// refusal now shows as a greyed-out trigger rather than a menu that opens and does
// nothing: CalloutMenu asks `editor.can().setCallout()` and disables itself (see also
// e2e/editor-callout-menu.spec.ts, which pins the same behaviour for a quote).
// Real pointer clicks throughout: they double as the regression test for the floating
// table toolbar's z-20 (it must not cover the main toolbar's dropdown panels).
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

  // Caret below the table (the trailing paragraph): the same menu inserts normally.
  await editor.click({ position: { x: 200, y: 400 } });
  await expect(trigger).toBeEnabled();
  await trigger.click();
  await page.getByRole('button', { name: '情報', exact: true }).click();
  await expect(editor.locator('.markdown-alert')).toHaveCount(1);
  await expect(editor.locator('td .markdown-alert')).toHaveCount(0);
  await expect(editor.locator('table')).toHaveCount(1);
});

// The table picker refuses while the caret is in a table (it used to split the host
// table around a new sibling table instead of nesting). The refusal shows as a greyed-out
// trigger rather than a picker that opens and does nothing on every cell: TableGridMenu asks
// `editor.can().insertTable()` and disables itself, matching the callout/list/quote/image
// controls. Only the *insert* control goes away — row/column editing is the floating
// TableToolbar, which appears exactly while this is disabled.
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

  // The floating table toolbar is what's on offer instead, so nothing is lost.
  await expect(page.getByRole('button', { name: '行を追加' })).toBeVisible();

  // Below the table the picker works as before.
  await editor.click({ position: { x: 200, y: 400 } });
  await expect(trigger).toBeEnabled();
  await insertTable(page);
  await expect(editor.locator('table')).toHaveCount(2);
});

// Same rule for the quote button. A cell can't hold a blockquote either, and toggleBlockquote
// already reports false there — the button just wasn't reading it, so it stayed live and a
// click did nothing at all. It must not over-reach: a code block still accepts a quote (it gets
// wrapped, not converted), so the button stays enabled there.
test('the quote button is disabled inside a table cell', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await insertTable(page);

  const quote = page.getByRole('button', { name: '引用' });
  await editor.locator('td').first().click();
  await expect(quote).toBeDisabled();

  // Outside the table it works as before.
  await editor.click({ position: { x: 200, y: 400 } });
  await expect(quote).toBeEnabled();
  await quote.click();
  await expect(editor.locator('blockquote')).toHaveCount(1);
});

// The picker's refusal read prosemirror-tables' isInTable, which resolves `$head` alone: a
// selection dragged *out* of a table upwards leaves the head in the paragraph above, so the check
// passed and insertTable replaced the range — the existing table was swapped for a fresh empty one
// and its contents were gone. The guard scans the selected range instead
// (components/editor/selection-scan.ts), which is direction-agnostic. Browser-only: the guard lives
// in a command.
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

    // The trigger reads the same command, so a selection merely touching the table greys it out
    // too — not just a caret parked in a cell.
    await expect(page.getByRole('button', { name: '表', exact: true })).toBeDisabled();

    // And the command refuses, so the original table keeps its cells rather than being replaced.
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
