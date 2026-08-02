import { test, expect } from '@playwright/test';

// The only guard standing in front of /login once the site is reachable from the
// internet, so the wiring is pinned here and not just the arithmetic (which
// lib/login-throttle.test.ts covers). What could break without either test
// noticing is exactly this seam: the action computing a verdict and never acting
// on it, or the message never reaching the form.
//
// A username that does not exist, deliberately. It exercises the absent-account
// branch (which still hashes, so the response reveals nothing by its timing) and
// keeps the real e2e-admin's counter untouched — throttling is per username, and
// souring the account the other specs share would be a fine way to make this file
// look like someone else's bug.
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

  // The first two failures are free — the wait starts on the third, so a person
  // who fat-fingers a password twice never meets this at all.
  for (let i = 0; i < 2; i++) {
    await submit();
    await expect(page.getByText('ユーザー名またはパスワードが違います。')).toBeVisible();
  }

  // Then the cooldown starts, and keeps doubling. Retried rather than asserted on
  // a fixed attempt number: the third failure only buys a 1s wait, and filling the
  // form again through a browser takes about that long, so which attempt first
  // lands inside the window depends on the machine. Every retry is another
  // failure, so the wait outgrows the loop within a few passes.
  await expect(async () => {
    await submit();
    await expect(page.getByText(/秒後に再試行してください/)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });

  // Bounded, not a lockout: however high the count goes, the wait it asks for
  // stays within the cap. This is the property that keeps the owner from being
  // locked out of their own site by someone else's failures.
  const message = await page.getByText(/秒後に再試行してください/).textContent();
  const seconds = Number(message?.match(/(\d+)秒後/)?.[1]);
  expect(seconds).toBeGreaterThan(0);
  expect(seconds).toBeLessThanOrEqual(30);
});
