import { test, expect, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { TEST_ADMIN, TEST_DB_PATH } from './constants';

// The account's ID on the account settings screen, in the header and on the users screens
// (docs/multi-author-requirements.md §13). Each test makes its own author, so choosing an ID —
// which cannot be undone — never touches the shared TEST_AUTHOR.

test.use({ storageState: { cookies: [], origins: [] } });

const PASSWORD = 'test-password-1234';

function createAuthor(displayName: string): { id: number; username: string; handle: string } {
  const username = `handle-${crypto.randomBytes(4).toString('hex')}`;
  const db = new Database(TEST_DB_PATH);
  try {
    const id = Number(
      db
        .prepare(
          `INSERT INTO users (username, password_hash, role, display_name) VALUES (?, ?, 'author', ?)`,
        )
        .run(username, bcrypt.hashSync(PASSWORD, 10), displayName).lastInsertRowid,
    );
    db.prepare(`UPDATE users SET handle = 'user' || id WHERE id = ?`).run(id);
    return { id, username, handle: `user${id}` };
  } finally {
    db.close();
  }
}

function removeUser(id: number): void {
  const db = new Database(TEST_DB_PATH);
  try {
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  } finally {
    db.close();
  }
}

async function login(page: Page, username: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('ユーザー名').fill(username);
  await page.getByLabel('パスワード').fill(password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

// §13.6 row 52.
test('an author chooses an ID once, after which it is a line rather than a field', async ({
  page,
}) => {
  const author = createAuthor('ID 決め');
  const chosen = `yamada_${crypto.randomBytes(3).toString('hex')}`;
  try {
    await login(page, author.username, PASSWORD);
    await page.goto('/admin/account');

    const field = page.getByLabel('ID', { exact: true });
    await expect(field).toHaveValue(author.handle);
    await expect(page.getByText('一度決めると ID は変えられません。')).toBeVisible();
    await expect(page.getByText(`${author.handle.length} / 15`)).toBeVisible();

    await field.fill(`@${chosen.toUpperCase()}`);
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('保存しました')).toBeVisible();

    await expect(page.getByText(`ID: @${chosen}`)).toBeVisible();
    await expect(page.getByLabel('ID', { exact: true })).toHaveCount(0);
    await expect(page.getByText('一度決めると ID は変えられません。')).toHaveCount(0);
  } finally {
    removeUser(author.id);
  }
});

// §13.6 row 54.
test('an account with no display name is named by its ID in the header', async ({ page }) => {
  const author = createAuthor('');
  try {
    await login(page, author.username, PASSWORD);
    const button = page.getByRole('button', { name: 'アカウントのメニュー' });
    await expect(button).toHaveText('U');
    await button.click();
    await expect(page.getByText(`@${author.handle} でログイン中`)).toBeVisible();
  } finally {
    removeUser(author.id);
  }
});

// §13.6 row 53.
test('the users list and detail page show each ID, without overflowing at 360px', async ({
  page,
}) => {
  const author = createAuthor('ID を見る著者');
  try {
    await page.setViewportSize({ width: 360, height: 800 });
    await login(page, TEST_ADMIN.username, TEST_ADMIN.password);

    await page.goto('/admin/users');
    const row = page.locator('li', { hasText: 'ID を見る著者' });
    await expect(row.getByText(`@${author.handle}`, { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false);

    await page.goto(`/admin/users/${author.id}`);
    await expect(page.getByText(`@${author.handle}`, { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false);
  } finally {
    removeUser(author.id);
  }
});
