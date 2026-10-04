import { devices, expect, test, type Page } from '@playwright/test';
import { SHORTCUT_CATALOG } from '../components/editor/shortcut-catalog';
import { selectionSpan } from './editor-probe';
import { loadMarkdown } from './editor-authoring';

// ヘルプ (docs/cms-features.md「書き方ヘルプ」§7, criteria 3a–3e): the dialog's exits, where focus
// lands, its absence on touch, and that it draws the catalog. The catalog's shape is
// shortcut-catalog.test.ts's.

async function openHelp(page: Page) {
  const button = page.getByRole('button', { name: 'ヘルプ' });
  await button.click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  return { button, sheet };
}

// 3a: four spellings of one predicate, one navigation.
test('the sheet opens from the header and closes four ways', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const { sheet } = await openHelp(page);

  await page.getByRole('button', { name: '閉じる' }).click();
  await expect(sheet).toBeHidden();

  await openHelp(page);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  await openHelp(page);
  // The backdrop, at the corner outside the panel. It listens for `mousedown`.
  await page.mouse.click(8, 8);
  await expect(sheet).toBeHidden();
});

// 3b: opening and closing leaves the post as it was, **the measurable half of "Escape does not reach
// the editor"**. Every editor Escape consumer is bound to editor DOM or closed by the opening
// mousedown; WritingHelpDialog's `stopPropagation` guards a future document listener.
test('opening and closing leaves the document and the caret untouched', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, '一行目\n\n二行目');
  // A centred click lands past the text, at the end of 一行目 (pos 4); waited on the editor's own
  // selection (docs/editor-pitfalls.md §1.1).
  await page.locator('.ProseMirror p').first().click();
  await expect.poll(() => selectionSpan(page)).toEqual([4, 4]);

  const before = await selectionSpan(page);
  const { sheet } = await openHelp(page);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  expect(await selectionSpan(page)).toEqual(before);
  await expect(page.locator('.ProseMirror')).toContainText('一行目');
});

// 3c: focus returns to the button without scrolling; the editor's NodeSelection would scroll its
// block under the sticky header.
test('closing returns focus to the button without scrolling the page', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, Array.from({ length: 40 }, (_, i) => `段落 ${i + 1}`).join('\n\n'));
  await page.mouse.wheel(0, 600);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  const scrolled = await page.evaluate(() => window.scrollY);

  const { button, sheet } = await openHelp(page);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  await expect(button).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
});

// 3e: the same module drives the spec, so a forgotten key fails; `Mod-k` and `Mod-e` have no button.
test('the shortcut section draws every catalog entry', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const { sheet } = await openHelp(page);
  const rows = sheet.locator('ul li');

  await expect(rows).toHaveCount(SHORTCUT_CATALOG.length);
  for (const entry of SHORTCUT_CATALOG) {
    await expect(rows.filter({ hasText: entry.label }).first()).toBeVisible();
  }
  // One cap per key here (⌘⇧S is one cap on a Mac).
  await expect(rows.filter({ hasText: 'リンク' }).locator('kbd')).toHaveText(['Ctrl', 'K']);
});

// 3d: touch has no keyboard or tooltips, and the header no room. Emulated: a small viewport still
// reports `hover: hover`. The five keys are editor-narrow-menus.spec.ts's PHONE.
const PIXEL_7 = devices['Pixel 7'];
test.describe('touch', () => {
  test.use({
    viewport: PIXEL_7.viewport,
    userAgent: PIXEL_7.userAgent,
    deviceScaleFactor: PIXEL_7.deviceScaleFactor,
    isMobile: PIXEL_7.isMobile,
    hasTouch: PIXEL_7.hasTouch,
  });

  test('the header offers no ヘルプ button', async ({ page }) => {
    await page.goto('/admin/posts/new');
    await expect(page.getByRole('button', { name: '記事の設定' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ヘルプ' })).toBeHidden();
  });
});
