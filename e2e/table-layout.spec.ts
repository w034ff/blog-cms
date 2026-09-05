import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { loadMarkdown } from './editor-authoring';

// `.prose table { table-layout: fixed }` (app/globals.css, docs/table-requirements.md §11).
// Two things depend on it, and both are invisible until they are not: a table that outgrows
// the editor frame, and column widths that move while the author types.

const TABLE_MD = ['| 項目 | 説明 | 可否 |', '| --- | --- | --- |', '| あ | い | ○ |'].join('\n');

// Every measurement is taken from layout, not from the declaration: asserting
// `table-layout === 'fixed'` would pass on a rule that some later selector outranks.
function tableMetrics(page: Page): Promise<{ width: number; wrapper: number; cols: number[] }> {
  return page.evaluate(() => {
    const table = document.querySelector('.ProseMirror table') as HTMLTableElement;
    return {
      width: Math.round(table.getBoundingClientRect().width),
      // The div @tiptap/extension-table's TableView puts around the table — the box the
      // table has to stay inside. Editor-only; the published page has no such wrapper.
      wrapper: (table.parentElement as HTMLElement).clientWidth,
      cols: [...table.querySelectorAll('tr:first-child > *')].map((cell) =>
        Math.round(cell.getBoundingClientRect().width),
      ),
    };
  });
}

async function tableWithText(page: Page, text: string): Promise<void> {
  await loadMarkdown(page, TABLE_MD);
  const editor = page.locator('.ProseMirror');
  await expect(editor.locator('table')).toBeVisible();
  // The 説明 column's body cell.
  await editor.locator('table td').nth(1).click();
  await page.keyboard.press('End');
  await page.keyboard.type(text, { delay: 0 });
  await page.waitForTimeout(200);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
});

// A long token with no whitespace is the case `overflow-wrap: break-word` cannot answer:
// it is excluded from min-content sizing, which is what auto layout measures columns by.
// Before the fix this made the table 2418px inside a 766px wrapper and put the whole page
// into horizontal scroll.
test('a long unbroken token leaves the table inside its wrapper', async ({ page }) => {
  await tableWithText(page, 'a'.repeat(300));

  const { width, wrapper } = await tableMetrics(page);
  expect(width).toBeLessThanOrEqual(wrapper);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      ),
    )
    .toBe(false);
});

// The same defect in the shape an author actually produces. Deliberately not a URL: Chrome
// takes `/`, `?` and `&` as break opportunities, so even a 210-character URL wraps on its own
// and asserting on one measured nothing (checked by reverting the rule — it passed either way).
// What has no break opportunity at all is a hash, a token, or an identifier.
const HASH = `sha256-${'0f3c9ab27e'.repeat(12)}`;

test('a long hash in a cell leaves the table inside its wrapper', async ({ page }) => {
  await tableWithText(page, HASH);

  const { width, wrapper } = await tableMetrics(page);
  expect(width).toBeLessThanOrEqual(wrapper);
});

// The reason the rule is `table-layout` rather than a wrapping tweak: with the plugin's
// `width: 100%`, auto layout cannot grow the table, so a column that gains content takes
// the width from its neighbours. Measured before the fix: 255 → 44px in the two columns
// the author was not typing in.
test('column widths do not move while typing into one cell', async ({ page }) => {
  await loadMarkdown(page, TABLE_MD);
  const editor = page.locator('.ProseMirror');
  await expect(editor.locator('table')).toBeVisible();

  const before = (await tableMetrics(page)).cols;
  expect(before).toHaveLength(3);

  await editor.locator('table td').nth(1).click();
  await page.keyboard.press('End');
  for (let round = 0; round < 4; round += 1) {
    await page.keyboard.type('あ'.repeat(20), { delay: 0 });
    await page.waitForTimeout(120);
    expect((await tableMetrics(page)).cols).toEqual(before);
  }
});
