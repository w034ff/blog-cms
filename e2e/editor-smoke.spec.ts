import { test, expect } from '@playwright/test';

// End-to-end smoke over the whole harness at once: auth (via storageState) + the
// editor route + the client TipTap mount + server autosave to the isolated DB.
test('new-post editor loads and autosaves a draft', async ({ page }) => {
  await page.goto('/admin/posts/new');

  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await expect(page.getByRole('button', { name: '大見出し' })).toBeVisible();

  await page.getByLabel('タイトル').fill('E2E smoke post');
  await editor.click();
  await page.keyboard.type('Hello from the Playwright harness.');

  // Autosave debounces (~800ms) then POSTs /api/drafts; success flips the
  // indicator to 保存済み ✓.
  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });
});
