import { test as setup, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { STORAGE_STATE, TEST_ADMIN } from './constants';

// Log in through the real /login form once and persist the session cookie, so the
// spec projects start already authenticated (the editor sits behind admin auth).
setup('authenticate as admin', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('ユーザー名').fill(TEST_ADMIN.username);
  await page.getByLabel('パスワード').fill(TEST_ADMIN.password);
  await page.getByRole('button', { name: 'ログイン' }).click();

  // A successful login redirects to /admin; reaching it (past verifySession's
  // /login redirect) proves the session cookie was set and is valid.
  await page.waitForURL('**/admin');
  await expect(page).toHaveURL(/\/admin$/);

  fs.mkdirSync(path.dirname(STORAGE_STATE), { recursive: true });
  await page.context().storageState({ path: STORAGE_STATE });
});
