import { test, expect } from '@playwright/test';

// The strike button toggles the mark (active tint) and round-trips to `~~…~~` in the hidden body.
test('strikethrough button toggles strike and serializes to ~~', async ({ page }) => {
  await page.goto('/admin/posts/new');

  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await expect(page.getByRole('button', { name: '太字' })).toBeVisible();
  await expect(page.getByRole('button', { name: '斜体' })).toBeVisible();
  const strike = page.getByRole('button', { name: '取り消し線' });
  await expect(strike).toBeVisible();

  await editor.click();
  await page.keyboard.type('strike me');
  await page.keyboard.press('Control+a'); // select the paragraph text

  await strike.click();

  // Active state is the bg tint ToolbarButton applies when editor.isActive('strike').
  await expect(strike).toHaveClass(/bg-zinc-200/);

  // The hidden input mirrors editor.storage.markdown.getMarkdown().
  await expect(page.locator('input[name="body"]')).toHaveValue(/~~strike me~~/);
});
