import { test, expect } from '@playwright/test';
import { TEST_AUTHOR } from './constants';

// What an author — signed in, but not an admin — is kept out of (docs/editor-requirements.md
// §12.33.1). The tag dictionary is shared by every author, so only an admin changes it: the list
// does not link to it, and the address typed by hand is a 404.
//
// Logged in as the author through the real form, not the saved admin session the other specs
// share (e2e/auth.setup.ts), which would pass every check here vacuously.
test.use({ storageState: { cookies: [], origins: [] } });

test('an author sees no tag dictionary', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('ユーザー名').fill(TEST_AUTHOR.username);
  await page.getByLabel('パスワード').fill(TEST_AUTHOR.password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page).toHaveURL(/\/admin$/);

  // The list rendered, so the link's absence is the gate and not a page that failed to load.
  await expect(page.getByRole('heading', { name: '記事一覧' })).toBeVisible();
  await expect(page.getByRole('link', { name: '新規記事' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'タグ', exact: true })).toHaveCount(0);

  const response = await page.goto('/admin/tags');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'タグ', exact: true })).toHaveCount(0);
});
