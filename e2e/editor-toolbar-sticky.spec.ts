import { test, expect } from '@playwright/test';

// The format toolbar is sticky (PostEditor wraps it in `sticky top-0`) so it stays
// reachable when editing far down a long post. Fill the editor past a screenful,
// scroll down, and assert the toolbar is still in the viewport, pinned near the top.
test('the format toolbar stays pinned when scrolling a long post', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await page.goto('/admin/posts/new');

  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  const heading = page.getByRole('button', { name: '大見出し' });
  await expect(heading).toBeInViewport();

  // Make the post taller than the viewport.
  await editor.click();
  for (let i = 0; i < 55; i++) {
    await page.keyboard.type(`line ${i}`);
    await page.keyboard.press('Enter');
  }

  // Scroll well past where the toolbar originally sat.
  await page.evaluate(() => window.scrollTo(0, 700));
  await expect
    .poll(async () => {
      const box = await heading.boundingBox();
      return box?.y ?? -1;
    })
    .toBeLessThan(80); // pinned near the top rather than scrolled off
  await expect(heading).toBeInViewport();

  // Not just visible — the toolbar's dropdowns must still open over the editor
  // content and be clickable while pinned (guards the sticky stacking context: a
  // click that landed behind the content would fail Playwright's actionability).
  await page.getByRole('button', { name: 'リスト' }).click();
  await page.getByRole('button', { name: '箇条書き' }).click();
  await expect(editor.locator('ul')).toHaveCount(1);
});
