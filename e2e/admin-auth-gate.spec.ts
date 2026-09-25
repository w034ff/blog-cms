import { test, expect } from '@playwright/test';

// A logged-out visitor never reaches /admin. `proxy.ts` (matcher `/admin/:path*`) and
// `verifySession()` in app/admin/layout.tsx each refuse alone, so this pins the property, and cannot
// catch losing one of them. Two paths, through app/admin/(list) and app/admin/posts, for the
// matcher's claim. Logged out: the shared storageState would make this vacuous.
test.use({ storageState: { cookies: [], origins: [] } });

for (const path of ['/admin', '/admin/posts/new']) {
  test(`${path} refuses a visitor with no session`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
    // The real form, not a look-alike shell.
    await expect(page.getByLabel('ユーザー名')).toBeVisible();
    // Nothing behind the gate rendered.
    await expect(page.locator('.ProseMirror')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '記事一覧' })).toHaveCount(0);
  });
}
