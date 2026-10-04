import { test, expect } from '@playwright/test';

// The header's 文字数 (docs/editor-requirements.md §12.38). What is counted is lib/format.test.ts's;
// this spec owns the wiring: the number follows the body, and the narrow widths hide it.

test('the count follows the body and leaves out whitespace', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const body = page.locator('.ProseMirror');
  await expect(body).toBeVisible();
  const count = page.locator('.editor-char-count');
  await expect(count).toHaveText('0 字');
  await body.click();
  await page.keyboard.type('あいう えお');
  await page.keyboard.press('Enter');
  await page.keyboard.type('abc');
  await expect(count).toHaveText('8 字');
});

test.describe('on a narrow pointer window', () => {
  test.use({ viewport: { width: 470, height: 800 } });
  test('the count is hidden', async ({ page }) => {
    await page.goto('/admin/posts/new');
    await expect(page.locator('.ProseMirror')).toBeVisible();
    await expect(page.locator('.editor-char-count')).toBeHidden();
  });
});

test.describe('on a 320px phone', () => {
  test.use({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });
  test('the count is hidden', async ({ page }) => {
    await page.goto('/admin/posts/new');
    await expect(page.locator('.ProseMirror')).toBeVisible();
    await expect(page.locator('.editor-char-count')).toBeHidden();
  });
});

test.describe('on a 390px phone', () => {
  test.use({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
  test('the count is shown', async ({ page }) => {
    await page.goto('/admin/posts/new');
    await expect(page.locator('.ProseMirror')).toBeVisible();
    await expect(page.locator('.editor-char-count')).toBeVisible();
  });
});
