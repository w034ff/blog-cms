import { test, expect, devices, type Page } from '@playwright/test';
import { closeHistory, loadMarkdown } from './editor-authoring';

// The toolbar's undo and redo (docs/editor-requirements.md §12.4): a route to existing commands, and
// disabled states read from `editor.can()`, which need a live history. **Emulated**: the buttons
// exist only under `hover: none`. The five keys are editor-narrow-menus.spec.ts's PHONE.
const PIXEL_7 = devices['Pixel 7'];
const PHONE = {
  viewport: PIXEL_7.viewport,
  userAgent: PIXEL_7.userAgent,
  deviceScaleFactor: PIXEL_7.deviceScaleFactor,
  isMobile: PIXEL_7.isMobile,
  hasTouch: PIXEL_7.hasTouch,
};

async function open(page: Page): Promise<void> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
}

const undo = (page: Page) => page.getByRole('button', { name: '元に戻す' });
const redo = (page: Page) => page.getByRole('button', { name: 'やり直す' });

test.describe('on an emulated phone', () => {
  test.use(PHONE);

  test('the buttons undo and redo a typed run', async ({ page }) => {
    await open(page);
    await page.keyboard.type('あいうえお');
    await expect(page.locator('.ProseMirror')).toContainText('あいうえお');

    await undo(page).click();
    await expect(page.locator('.ProseMirror')).not.toContainText('あいうえお');
    await redo(page).click();
    await expect(page.locator('.ProseMirror')).toContainText('あいうえお');
  });

  test('each button says when its half of the history is empty', async ({ page }) => {
    await open(page);
    // A fresh document has neither, and the greying says so.
    await expect(undo(page)).toBeDisabled();
    await expect(redo(page)).toBeDisabled();

    await page.keyboard.type('あいうえお');
    await expect(undo(page)).toBeEnabled();
    await expect(redo(page)).toBeDisabled();

    await undo(page).click();
    await expect(redo(page)).toBeEnabled();
  });

  // Undo takes back the edit and no more, where `Mod-z` needs a keyboard (§12.4).
  test('undo reaches an edit made on top of a loaded document, not the load itself', async ({
    page,
  }) => {
    await open(page);
    await loadMarkdown(page, '元の本文\n');
    await expect(page.locator('.ProseMirror')).toContainText('元の本文');
    // Without this the press undoes the document: `setContent` is one history event and the typing
    // groups with it, while a real load is no event at all (editor-authoring.ts says the rest).
    await closeHistory(page);
    await page.locator('.ProseMirror').click();
    await page.keyboard.press('End');
    await page.keyboard.type('と追記');
    await expect(page.locator('.ProseMirror')).toContainText('元の本文と追記');

    await undo(page).click();
    await expect(page.locator('.ProseMirror')).toContainText('元の本文');
    await expect(page.locator('.ProseMirror')).not.toContainText('と追記');
  });
});

// On a pointer the pair is hidden (CSS over the same markup, so the first paint is right, §12.4).
test('a pointer does not get the pair, nor the gap that follows it', async ({ page }) => {
  await open(page);
  await expect(undo(page)).toBeHidden();
  await expect(redo(page)).toBeHidden();
  await expect(page.locator('.editor-toolbar-bar .toolbar-button-history')).toHaveCount(2);

  // The pair's separator is its own `hover: none` margin (§12.11), so the wrapper must be hidden too,
  // or the row's `gap-0.5` leaves a stray gap before 大見出し.
  await expect(page.locator('.toolbar-history')).toBeHidden();
  const [barBox, headingBox] = [
    (await page.locator('.editor-toolbar-bar').boundingBox())!,
    (await page.getByRole('button', { name: '大見出し' }).boundingBox())!,
  ];
  // The bar's padding alone separates them.
  const padding = await page
    .locator('.editor-toolbar-bar')
    .evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
  expect(headingBox.x - barBox.x).toBeCloseTo(padding, 0);
});
