import { test, expect } from '@playwright/test';

// The AlertHighlight extension tints a `> [!NOTE]`-style blockquote in the editor
// via a ProseMirror decoration (no storage change). Browser-only behavior, so a
// real editor is the only place to observe the decoration class + the resulting
// tint actually landing on the <blockquote>.
test('a [!WARNING] blockquote is tinted as a callout in the editor', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.keyboard.type('> [!WARNING]');
  await page.keyboard.press('Enter');
  await page.keyboard.type('注意事項です。');

  const quote = editor.locator('blockquote').first();
  await expect(quote).toHaveClass(/markdown-alert markdown-alert-warning/);

  // The tint (background from the alert CSS) must actually apply, not just the class.
  const bg = await quote.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(bg).not.toBe('transparent');
});

test('an ordinary blockquote is not tinted', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.keyboard.type('> ただの引用です。');

  const quote = editor.locator('blockquote').first();
  await expect(quote).toBeVisible();
  await expect(quote).not.toHaveClass(/markdown-alert/);
});
