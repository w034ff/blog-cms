import { test, expect } from '@playwright/test';

// What refuses a logged-out visitor at /admin, and nothing else measured it.
//
// Two things refuse independently: `proxy.ts` (Next 16's middleware file, matcher
// `/admin/:path*`) and the `verifySession()` in app/admin/layout.tsx. Either one alone produces
// this redirect, so what is asserted here is the property — a session-less visitor never reaches
// an admin route — and not either mechanism. Measured 2026-09-12 by removing each in turn: green
// with only the proxy, green with only the layout, red with neither. A change that takes out one
// of them will not be caught here, and that is the honest limit of this file.
//
// Both paths are asked because the matcher's claim is that one pattern covers routes reached
// through different layouts: /admin resolves through app/admin/(list), /admin/posts/new through
// app/admin/posts.
//
// Logged out on purpose — the storageState the other specs share is the saved admin session
// (e2e/auth.setup.ts), which would make every assertion here vacuous.
test.use({ storageState: { cookies: [], origins: [] } });

for (const path of ['/admin', '/admin/posts/new']) {
  test(`${path} refuses a visitor with no session`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
    // The redirect landed on the form, rather than on a shell that merely looks like /login.
    await expect(page.getByLabel('ユーザー名')).toBeVisible();
    // And nothing behind the gate was rendered on the way past it.
    await expect(page.locator('.ProseMirror')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '記事一覧' })).toHaveCount(0);
  });
}
