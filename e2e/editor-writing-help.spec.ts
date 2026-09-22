import { devices, expect, test, type Page } from '@playwright/test';
import { SHORTCUT_CATALOG } from '../components/editor/shortcut-catalog';
import { selectionSpan } from './editor-probe';
import { loadMarkdown } from './editor-authoring';

// ヘルプ — the reference sheet in the page header (docs/cms-features.md「書き方ヘルプ」§7, criteria
// 3a–3e). What only a browser answers here is the wiring: the dialog's four exits, where focus
// lands afterwards, that the sheet is absent on touch, and that what it draws is the catalog rather
// than a list re-written in the component. The catalog's own shape (no duplicate id or token, no
// key literal left in Toolbar.tsx) is data and is measured in
// components/editor/shortcut-catalog.test.ts instead.

async function openHelp(page: Page) {
  const button = page.getByRole('button', { name: 'ヘルプ' });
  await button.click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  return { button, sheet };
}

// 3a. All four exits in one navigation: a spec is ~2.3s of preamble for ~0ms of claim, and these
// are four spellings of one predicate rather than four claims.
test('the sheet opens from the header and closes four ways', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const { sheet } = await openHelp(page);

  await page.getByRole('button', { name: '閉じる' }).click();
  await expect(sheet).toBeHidden();

  await openHelp(page);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  await openHelp(page);
  // The backdrop, which is the dialog's parent box: pressed at the top-left corner, outside the
  // centred panel. `mousedown` is what the overlay listens for (a control that unmounts on
  // mousedown lets the mouseup fall through), and `click()` sends both.
  await page.mouse.click(8, 8);
  await expect(sheet).toBeHidden();
});

// 3b. The sheet is a reference, so opening and closing it must leave the post exactly as it was.
// **This is the measurable half of "Escape does not reach the editor".** The other half has no
// reachable scenario today: every editor-side Escape consumer is either bound to the editor's own
// DOM (ProseMirror's handlers, the slash menu's `onKeyDown`) and so silent once focus moves to the
// dialog, or closed by the very mousedown that opens this sheet (`useDismiss`'s outside-pointer
// handler). The `stopPropagation` in WritingHelpDialog stays as a cheap guard against a future
// document-level listener, not because a spec can see it today.
test('opening and closing leaves the document and the caret untouched', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, '一行目\n\n二行目');
  // The paragraph's box runs the column's full width, so a click at its centre lands past the text
  // and the caret settles at the end of 一行目 (pos 4). Waited for as a predicate on the editor's
  // own selection: a click reaches `state.selection` through ProseMirror's 20ms DOMObserver
  // debounce, and reading it any sooner returns where the caret was before the click
  // (editor-probe.ts's `caretAtLineStart` records the same trap).
  await page.locator('.ProseMirror p').first().click();
  await expect.poll(() => selectionSpan(page)).toEqual([4, 4]);

  const before = await selectionSpan(page);
  const { sheet } = await openHelp(page);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  expect(await selectionSpan(page)).toEqual(before);
  await expect(page.locator('.ProseMirror')).toContainText('一行目');
});

// 3c. Focus goes back to the button that opened the sheet — and nothing scrolls on the way. Handing
// focus to the editor instead is what would move the page: a NodeSelection scrolls its whole block
// into view, under a sticky header that does not know it is covering the top of the viewport.
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

// 3e. The sheet draws the catalog, not a list of its own: the spec imports the same module, so a key
// added there and forgotten in the component fails here. `Mod-k` and `Mod-e` are the reason — they
// have no toolbar button, so nothing else in the suite would notice them disappearing.
test('the shortcut section draws every catalog entry', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const { sheet } = await openHelp(page);
  const rows = sheet.locator('ul li');

  await expect(rows).toHaveCount(SHORTCUT_CATALOG.length);
  for (const entry of SHORTCUT_CATALOG) {
    await expect(rows.filter({ hasText: entry.label }).first()).toBeVisible();
  }
  // The keys themselves, one cap per key on this platform (⌘⇧S stays one cap on a Mac).
  await expect(rows.filter({ hasText: 'リンク' }).locator('kbd')).toHaveText(['Ctrl', 'K']);
});

// 3d. Touch has neither a keyboard nor the tooltips this sheet is a second opinion on, and the
// header is the one place with no room to spare. Emulated rather than narrowed: a small viewport
// still reports `hover: hover`, which would leave this testing a button that is painted after all.
// The five keys below are editor-narrow-menus.spec.ts's PHONE, for the reason stated there.
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
