import { test, expect } from '@playwright/test';

// The header (`sticky top-0`) keeps both rows, publish controls and format toolbar, reachable far
// down a long post.
test('the sticky header stays pinned when scrolling a long post', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await page.goto('/admin/posts/new');

  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  const heading = page.getByRole('button', { name: '大見出し' });
  await expect(heading).toBeInViewport();

  // Taller than the viewport.
  await editor.click();
  for (let i = 0; i < 55; i++) {
    await page.keyboard.type(`line ${i}`);
    await page.keyboard.press('Enter');
  }

  // Well past the toolbar's first position.
  await page.evaluate(() => window.scrollTo(0, 700));
  await expect
    .poll(async () => {
      const box = await heading.boundingBox();
      return box?.y ?? -1;
    })
    // Pinned near the top: measured at 63, plus slack, so a taller row pushing it down is caught.
    .toBeLessThan(76);
  await expect(heading).toBeInViewport();

  // The publish controls ride the same header.
  await expect(page.getByRole('button', { name: '投稿' })).toBeInViewport();

  // The dropdowns still open over the content and take clicks (the sticky stacking context).
  await page.getByRole('button', { name: 'リスト' }).click();
  await page.getByRole('button', { name: '箇条書き' }).click();
  await expect(editor.locator('ul')).toHaveCount(1);
});
