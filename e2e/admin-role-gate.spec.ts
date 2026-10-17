import { test, expect } from '@playwright/test';
import { TEST_AUTHOR } from './constants';

// An author who is not an admin is kept from the shared tag dictionary (docs/editor-requirements.md
// §12.33.1): no link, and a 404 by hand. Logged in through the real form; the shared admin session
// would pass everything.
test.use({ storageState: { cookies: [], origins: [] } });

test('an author sees no tag dictionary', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('ユーザー名').fill(TEST_AUTHOR.username);
  await page.getByLabel('パスワード').fill(TEST_AUTHOR.password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page).toHaveURL(/\/admin$/);

  // The list rendered, so the link's absence is the gate and not a page that failed to load.
  await expect(page.getByRole('heading', { name: '記事一覧' })).toBeVisible();
  await expect(page.getByRole('button', { name: '投稿する' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'タグの管理', exact: true })).toHaveCount(0);

  const response = await page.goto('/admin/tags');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'タグの管理', exact: true })).toHaveCount(0);
  // The (list) shell's own not-found.tsx, inside its header rather than under a second one.
  await expect(
    page.getByRole('heading', { level: 1, name: 'ページが見つかりません' }),
  ).toBeVisible();
  await expect(page.locator('header')).toHaveCount(1);
});
