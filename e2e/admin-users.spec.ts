import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { TEST_ADMIN, TEST_AUTHOR, TEST_DB_PATH } from './constants';

test.use({ storageState: { cookies: [], origins: [] } });

function getDb(): Database.Database {
  return new Database(TEST_DB_PATH);
}

async function loginAsAuthor(page: import('@playwright/test').Page) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('ユーザー名').fill(TEST_AUTHOR.username);
  await page.getByLabel('パスワード').fill(TEST_AUTHOR.password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

async function loginAsAdmin(page: import('@playwright/test').Page) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('ユーザー名').fill(TEST_ADMIN.username);
  await page.getByLabel('パスワード').fill(TEST_ADMIN.password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

// docs/multi-author-requirements.md §9.9 row 18.
test('an author opening /admin/users gets a 404', async ({ page }) => {
  await loginAsAuthor(page);
  const response = await page.goto('/admin/users');
  expect(response?.status()).toBe(404);
});

test('an admin sees user rows and invite rows, including Google authors', async ({ page }) => {
  const db = getDb();
  let googleUserId: number;
  const inviteEmail = 'e2e-seed-invite@example.com';
  try {
    const res = db
      .prepare(
        `INSERT INTO users (role, display_name, google_sub) VALUES ('author', 'Google 著者E2E', 'google-sub-e2e-seed')`,
      )
      .run();
    googleUserId = Number(res.lastInsertRowid);
    db.prepare(
      `INSERT INTO author_allowlist (email, created_at) VALUES (?, CURRENT_TIMESTAMP)`,
    ).run(inviteEmail);
  } finally {
    db.close();
  }

  try {
    await loginAsAdmin(page);
    await page.goto('/admin/users');

    await expect(page.getByRole('heading', { name: '利用者' })).toBeVisible();

    // Side nav shows 利用者 link
    const sideNav = page.getByRole('navigation', { name: '管理' });
    await expect(sideNav.getByRole('link', { name: '利用者' })).toBeVisible();

    // Invite row appears with badge 招待中
    const inviteRow = page.locator('li', { hasText: inviteEmail });
    await expect(inviteRow).toBeVisible();
    await expect(inviteRow.getByText('招待中')).toBeVisible();
    await expect(inviteRow.getByText('まだログインしていません')).toBeVisible();

    // Google author row appears
    const googleUserRow = page.locator('li', { hasText: 'Google 著者E2E' });
    await expect(googleUserRow).toBeVisible();
    await expect(googleUserRow.getByText('Google でログイン')).toBeVisible();

    // Password user row appears with 管理者 badge
    const adminUserRow = page.locator('li', { hasText: TEST_ADMIN.username });
    if ((await adminUserRow.count()) > 0) {
      await expect(adminUserRow.getByText('管理者')).toBeVisible();
      await expect(adminUserRow.getByText('パスワードでログイン')).toBeVisible();
    }
  } finally {
    const dbClean = getDb();
    try {
      dbClean.prepare(`DELETE FROM users WHERE id = ?`).run(googleUserId);
      dbClean.prepare(`DELETE FROM author_allowlist WHERE email = ?`).run(inviteEmail);
    } finally {
      dbClean.close();
    }
  }
});

test('inviting and cancelling an invite round trips', async ({ page }) => {
  const testEmail = 'e2e-roundtrip-invite@example.com';
  await loginAsAdmin(page);
  await page.goto('/admin/users');

  // Fill and submit invite
  await page.getByLabel('招待する').fill(testEmail);
  await page.getByRole('button', { name: '招待する' }).click();

  // Invite row is visible
  const inviteRow = page.locator('li', { hasText: testEmail });
  await expect(inviteRow).toBeVisible();
  await expect(inviteRow.getByText('招待中')).toBeVisible();

  // Cancel invite via menu
  await inviteRow.getByRole('button', { name: 'その他の操作' }).click();
  await page.getByRole('button', { name: '招待を取り消す' }).click();

  // Invite row is removed
  await expect(page.locator('li', { hasText: testEmail })).toHaveCount(0);
});

test('suspending and unsuspending an author round trips', async ({ page }) => {
  const db = getDb();
  let authorUserId: number;
  try {
    const res = db
      .prepare(
        `INSERT INTO users (role, display_name, username, password_hash) VALUES ('author', '停止E2E著者', 'e2e-suspend-target', 'hash')`,
      )
      .run();
    authorUserId = Number(res.lastInsertRowid);
  } finally {
    db.close();
  }

  try {
    await loginAsAdmin(page);
    await page.goto('/admin/users');

    const authorRow = page.locator('li', { hasText: '停止E2E著者' });
    await expect(authorRow).toBeVisible();
    await expect(authorRow.getByText('停止中')).toHaveCount(0);

    // Open menu and choose 停止する
    await authorRow.getByRole('button', { name: 'その他の操作' }).click();
    await page.getByRole('button', { name: '停止する' }).click();

    // Confirmation shows cancel and confirm button
    await expect(
      page.getByText(
        'このアカウントを停止します。ログインと書き込みができなくなり、公開中の記事と走り書きはサイトから外れます。解除すると元に戻ります。',
      ),
    ).toBeVisible();
    await page.getByRole('button', { name: '停止する' }).click();

    // Author row now has 停止中 badge
    await expect(authorRow.getByText('停止中')).toBeVisible();

    // Open menu again and choose 停止を解除
    await authorRow.getByRole('button', { name: 'その他の操作' }).click();
    await page.getByRole('button', { name: '停止を解除' }).click();

    // 停止中 badge is gone
    await expect(authorRow.getByText('停止中')).toHaveCount(0);
  } finally {
    const dbClean = getDb();
    try {
      dbClean.prepare(`DELETE FROM users WHERE id = ?`).run(authorUserId);
    } finally {
      dbClean.close();
    }
  }
});

test('at 360px viewport, an invite with a long email does not cause horizontal overflow', async ({
  page,
}) => {
  const longEmail =
    'a-very-long-email-address-that-would-overflow-without-word-break@example-domain-with-a-very-long-name.com';
  const db = getDb();
  try {
    db.prepare(
      `INSERT INTO author_allowlist (email, created_at) VALUES (?, CURRENT_TIMESTAMP)`,
    ).run(longEmail);
  } finally {
    db.close();
  }

  try {
    await page.setViewportSize({ width: 360, height: 640 });
    await loginAsAdmin(page);
    await page.goto('/admin/users');

    const inviteRow = page.locator('li', { hasText: longEmail });
    await expect(inviteRow).toBeVisible();

    // Check that horizontal scrolling does not occur
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  } finally {
    const dbClean = getDb();
    try {
      dbClean.prepare(`DELETE FROM author_allowlist WHERE email = ?`).run(longEmail);
    } finally {
      dbClean.close();
    }
  }
});

// docs/multi-author-requirements.md §9.9 row 19.
test('login page has no Google button in E2E environment and shows ?error=not_invited message', async ({
  page,
}) => {
  await page.goto('/login?error=not_invited');
  await expect(page.getByRole('heading', { name: 'ログイン' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Google でログイン/ })).toHaveCount(0);
  await expect(page.getByText('このメールアドレスは招待されていません。')).toBeVisible();
});
