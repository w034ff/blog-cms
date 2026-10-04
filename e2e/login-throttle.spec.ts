import { test, expect } from '@playwright/test';

// The guard in front of /login once public: the wiring, not the arithmetic
// (lib/login-throttle.test.ts). An unknown username: the absent-account branch (which still hashes),
// and the shared e2e-admin's per-username counter stays clean.
const UNKNOWN_USER = 'throttle-probe';

// The saved admin session would redirect /login straight to /admin.
test.use({ storageState: { cookies: [], origins: [] } });

test('a run of failed logins is refused with a wait, and says how long', async ({ page }) => {
  await page.goto('/login');

  const submit = async (): Promise<void> => {
    await page.getByLabel('ユーザー名').fill(UNKNOWN_USER);
    await page.getByLabel('パスワード').fill('not-the-password');
    await page.getByRole('button', { name: 'ログイン' }).click();
  };

  // Two failures are free; the wait starts on the third.
  for (let i = 0; i < 2; i++) {
    await submit();
    await expect(page.getByText('ユーザー名またはパスワードが違います。')).toBeVisible();
  }

  // The doubling cooldown. Retried, not a fixed attempt: the 1s wait and a form refill take about the
  // same time.
  await expect(async () => {
    await submit();
    await expect(page.getByText(/秒後に再試行してください/)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });

  // Bounded by the cap: nobody can lock the owner out.
  const message = await page.getByText(/秒後に再試行してください/).textContent();
  const seconds = Number(message?.match(/(\d+)秒後/)?.[1]);
  expect(seconds).toBeGreaterThan(0);
  expect(seconds).toBeLessThanOrEqual(30);
});
