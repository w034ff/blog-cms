import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { loadMarkdown } from './editor-authoring';

// `.prose table { table-layout: fixed }` (app/globals.css, docs/editor-requirements.md §11): keeps a
// table inside the frame, and column widths still while typing.

const TABLE_MD = ['| 項目 | 説明 | 可否 |', '| --- | --- | --- |', '| あ | い | ○ |'].join('\n');

// From layout, not the declaration, which a later selector could outrank.
function tableMetrics(page: Page): Promise<{ width: number; wrapper: number; cols: number[] }> {
  return page.evaluate(() => {
    const table = document.querySelector('.ProseMirror table') as HTMLTableElement;
    return {
      width: Math.round(table.getBoundingClientRect().width),
      // TableView's wrapper, the box the table must stay in (editor only).
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

// A spaceless token escapes `overflow-wrap: break-word`, being excluded from min-content, which auto
// layout sizes by; it scrolled the whole page sideways.
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

// Not a URL: Chrome breaks at `/`, `?` and `&`, so a URL passed with the rule reverted. A hash has no
// break opportunity.
const HASH = `sha256-${'0f3c9ab27e'.repeat(12)}`;

test('a long hash in a cell leaves the table inside its wrapper', async ({ page }) => {
  await tableWithText(page, HASH);

  const { width, wrapper } = await tableMetrics(page);
  expect(width).toBeLessThanOrEqual(wrapper);
});

// With `width: 100%`, auto layout gives a growing column its neighbours' width.
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
