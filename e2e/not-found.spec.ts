import { test, expect } from '@playwright/test';
import { DEFAULT_SITE_NAME as SITE_NAME } from '../app/shared-metadata';

// Next renders the nearest not-found.tsx inside every layout above the segment that threw, so each
// shell has its own and only app/not-found.tsx brings the chrome (components/NotFoundContent.tsx).
// A wrong pairing does not fail to render: it draws a second header inside the first <main>, which
// is why the counts below are the claim.
const HEADING = 'ページが見つかりません';

test.describe('reader routes', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  const ROUTES = [
    { name: 'an unmatched URL', path: '/no-such-page' },
    { name: 'a notFound() route', path: '/posts/no-such-slug' },
  ];

  for (const { name, path } of ROUTES) {
    test(`${name} answers 404 inside one copy of the site's shell`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);

      await expect(page.getByRole('heading', { level: 1, name: HEADING })).toBeVisible();
      await expect(page).toHaveTitle(new RegExp(`^${HEADING} \\| ${SITE_NAME}`));
      await expect(page.locator('main')).toHaveCount(1);
      await expect(page.locator('header')).toHaveCount(1);
      await expect(page.locator('footer')).toHaveCount(1);
      await expect(page.getByRole('banner').getByRole('link', { name: SITE_NAME })).toBeVisible();

      await page.getByRole('main').getByRole('link', { name: 'ホームへ戻る' }).click();
      await expect(page).toHaveURL(/\/$/);
    });
  }
});

test('the editor shell 404s without borrowing the site chrome', async ({ page }) => {
  const response = await page.goto('/admin/posts/999999999/edit');
  expect(response?.status()).toBe(404);

  await expect(page.getByRole('heading', { level: 1, name: HEADING })).toBeVisible();
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('header')).toHaveCount(0);
});
