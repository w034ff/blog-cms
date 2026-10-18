import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { TEST_ADMIN, TEST_DB_PATH } from './constants';
import { withdrawalDueAt, withdrawalLastDay } from '../lib/withdrawal-rules';

test.use({ storageState: { cookies: [], origins: [] } });

function getDb(): Database.Database {
  return new Database(TEST_DB_PATH);
}

function createAuthorUser(prefix: string = 'del-author'): {
  id: number;
  username: string;
  password: string;
} {
  const username = `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
  const password = 'test-password-1234';
  const db = getDb();
  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = db
      .prepare(
        `INSERT INTO users (username, password_hash, role, display_name, created_at)
         VALUES (?, ?, 'author', ?, CURRENT_TIMESTAMP)`,
      )
      .run(username, hash, `著者 ${username}`);
    return { id: Number(result.lastInsertRowid), username, password };
  } finally {
    db.close();
  }
}

function insertPost({
  title,
  slug,
  kind = 'post',
  draft = false,
  authorId,
}: {
  title: string;
  slug?: string;
  kind?: 'post' | 'scribble';
  draft?: boolean;
  authorId: number;
}): { id: number; slug: string; title: string } {
  const db = getDb();
  try {
    const postSlug = slug ?? crypto.randomBytes(10).toString('hex');
    const result = db
      .prepare(
        `
        INSERT INTO posts (
          slug, title, date, description, category, tags, draft, body,
          thumbnail, unlisted, edited_at, kind, author_id, created_at, updated_at
        ) VALUES (
          ?, ?, '2026-10-15T09:00:00.000Z', '', 'tech', '[]', ?, '本文です。',
          '', 0, CURRENT_TIMESTAMP, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `,
      )
      .run(postSlug, title, draft ? 1 : 0, kind, authorId);
    return { id: Number(result.lastInsertRowid), slug: postSlug, title };
  } finally {
    db.close();
  }
}

function cleanupUser(userId: number) {
  const db = getDb();
  try {
    db.prepare('DELETE FROM posts WHERE author_id = ?').run(userId);
    db.prepare('DELETE FROM display_name_history WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  } finally {
    db.close();
  }
}

async function loginAsUser(
  page: import('@playwright/test').Page,
  credentials: { username: string; password: string },
) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('ユーザー名').fill(credentials.username);
  await page.getByLabel('パスワード').fill(credentials.password);
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

// docs/multi-author-requirements.md §12.8 row 43.
test('author withdraws from account settings and cancels from /withdrawal (row 43)', async ({
  page,
}) => {
  const author = createAuthorUser('del-43');
  const post = insertPost({
    title: `退会テスト記事 ${crypto.randomBytes(4).toString('hex')}`,
    draft: false,
    kind: 'post',
    authorId: author.id,
  });

  try {
    const initialRes = await page.goto(`/posts/${post.slug}`);
    expect(initialRes?.status()).toBe(200);

    await loginAsUser(page, author);
    await page.goto('/admin/account');

    await expect(page.getByRole('heading', { name: '退会' })).toBeVisible();
    await page.getByRole('button', { name: '退会する' }).click();

    const expectedDate = withdrawalLastDay(withdrawalDueAt(new Date()).toISOString());
    const expectedConfirm = `退会は${expectedDate}まで取り消せます。`;
    await expect(page.getByText(expectedConfirm)).toBeVisible();
    await expect(page.getByRole('button', { name: 'やめる' })).toBeFocused();

    const confirmForm = page.locator('form').filter({ hasText: expectedConfirm });
    await confirmForm.getByRole('button', { name: '退会する' }).click();

    await expect(page).toHaveURL(/\/withdrawal$/);
    await expect(page.getByRole('heading', { name: '退会の手続き中' })).toBeVisible();

    const expectedNotice = `退会は${expectedDate}まで取り消せます。その後、アカウントと、記事 1 本・走り書き 0 本を消します。`;
    await expect(page.getByText(expectedNotice)).toBeVisible();

    const postRes = await page.goto(`/posts/${post.slug}`);
    expect(postRes?.status()).toBe(404);

    await page.goto('/withdrawal');
    await page.getByRole('button', { name: '退会を取り消す' }).click();

    await expect(page).toHaveURL(/\/admin$/);

    const restoredRes = await page.goto(`/posts/${post.slug}`);
    expect(restoredRes?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: post.title })).toBeVisible();
  } finally {
    cleanupUser(author.id);
  }
});

// docs/multi-author-requirements.md §12.8 row 44.
test('withdrawing author session redirects to /withdrawal and rejects writes (row 44)', async ({
  page,
}) => {
  const author = createAuthorUser('del-44');
  const due = withdrawalDueAt(new Date()).toISOString();
  const db = getDb();
  try {
    db.prepare('UPDATE users SET withdrawal_due_at = ? WHERE id = ?').run(due, author.id);
  } finally {
    db.close();
  }

  try {
    await page.context().clearCookies();
    await page.goto('/login');
    await page.getByLabel('ユーザー名').fill(author.username);
    await page.getByLabel('パスワード').fill(author.password);
    await page.getByRole('button', { name: 'ログイン' }).click();
    await expect(page).toHaveURL(/\/withdrawal$/);

    const adminRes = await page.goto('/admin');
    await expect(page).toHaveURL(/\/withdrawal$/);
    expect(adminRes?.request().redirectedFrom()?.url()).toMatch(/\/admin$/);

    await page.goto('/login');
    await expect(page).toHaveURL(/\/withdrawal$/);

    const draftRes = await page.request.post('/api/drafts', { data: {} });
    expect(draftRes.status()).toBe(401);

    await page.getByRole('button', { name: 'ログアウト' }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto('/withdrawal');
    await expect(page).toHaveURL(/\/login$/);
  } finally {
    cleanupUser(author.id);
  }
});

// docs/multi-author-requirements.md §12.8 row 46.
test('admin account settings does not show withdrawal box (row 46)', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/admin/account');
  await expect(page.getByRole('heading', { name: 'アカウントの設定' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '退会' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '退会する' })).toHaveCount(0);
});

// docs/multi-author-requirements.md §12.8 row 42.
test('admin can delete suspended author with all posts and scribbles (row 42)', async ({
  page,
}) => {
  const author = createAuthorUser('del-42');
  insertPost({
    title: `著者記事42 ${crypto.randomBytes(4).toString('hex')}`,
    kind: 'post',
    draft: false,
    authorId: author.id,
  });
  insertPost({
    title: `走り書き42 ${crypto.randomBytes(4).toString('hex')}`,
    kind: 'scribble',
    draft: false,
    authorId: author.id,
  });

  try {
    await loginAsAdmin(page);
    await page.goto('/admin/users');

    const authorRow = page.locator('li', { hasText: author.username });
    await expect(authorRow).toBeVisible();

    await authorRow.getByRole('button', { name: 'その他の操作' }).click();
    await expect(authorRow.getByRole('button', { name: '削除する' })).toHaveCount(0);
    await expect(authorRow.getByRole('button', { name: '停止する' })).toBeVisible();

    await authorRow.getByRole('button', { name: '停止する' }).click();
    const suspendForm = authorRow.locator('form').filter({ hasText: 'このアカウントを停止します' });
    await suspendForm.getByRole('button', { name: '停止する' }).click();
    await expect(authorRow.getByText('停止中')).toBeVisible();

    await authorRow.getByRole('button', { name: 'その他の操作' }).click();
    await expect(authorRow.getByRole('button', { name: '停止を解除' })).toBeVisible();
    const deleteButton = authorRow.getByRole('button', { name: '削除する' });
    await expect(deleteButton).toBeVisible();
    await deleteButton.click();

    const expectedConfirm = '記事 1 本と走り書き 1 本も消えます。元に戻せません。';
    await expect(authorRow.getByText(expectedConfirm)).toBeVisible();
    await expect(authorRow.getByRole('button', { name: 'やめる' })).toBeFocused();

    const deleteForm = authorRow.locator('form').filter({ hasText: expectedConfirm });
    await deleteForm.getByRole('button', { name: '削除する' }).click();

    await expect(authorRow).toHaveCount(0);

    const dbCheck = getDb();
    try {
      const userRow = dbCheck.prepare('SELECT id FROM users WHERE id = ?').get(author.id);
      expect(userRow).toBeUndefined();
      const postsCount = dbCheck
        .prepare('SELECT count(*) as count FROM posts WHERE author_id = ?')
        .get(author.id) as { count: number };
      expect(postsCount.count).toBe(0);
    } finally {
      dbCheck.close();
    }
  } finally {
    cleanupUser(author.id);
  }
});

// docs/multi-author-requirements.md §12.8 row 42, from the detail page (§12.4).
test('admin can delete a suspended author from the detail page and lands on the list (row 42)', async ({
  page,
}) => {
  const author = createAuthorUser('del-42d');
  insertPost({
    title: `詳細から削除 ${crypto.randomBytes(4).toString('hex')}`,
    authorId: author.id,
  });
  const db = getDb();
  try {
    db.prepare('UPDATE users SET suspended_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      author.id,
    );
  } finally {
    db.close();
  }

  try {
    await loginAsAdmin(page);
    await page.goto(`/admin/users/${author.id}`);
    await page.getByRole('button', { name: '削除する' }).click();

    const expectedConfirm = '記事 1 本と走り書き 0 本も消えます。元に戻せません。';
    await expect(page.getByText(expectedConfirm)).toBeVisible();
    await expect(page.getByRole('button', { name: 'やめる' })).toBeFocused();
    await page
      .locator('form')
      .filter({ hasText: expectedConfirm })
      .getByRole('button', { name: '削除する' })
      .click();

    await expect(page).toHaveURL(/\/admin\/users$/);
    await expect(page.locator('li', { hasText: author.username })).toHaveCount(0);
  } finally {
    cleanupUser(author.id);
  }
});

test('withdrawal and account settings withdrawal box do not overflow at 360px viewport', async ({
  page,
}) => {
  const author = createAuthorUser('del-width');
  try {
    await page.setViewportSize({ width: 360, height: 800 });
    await loginAsUser(page, author);

    await page.goto('/admin/account');
    const withdrawalSection = page.getByRole('heading', { name: '退会' });
    await expect(withdrawalSection).toBeVisible();

    const accountOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(accountOverflow).toBe(false);

    const due = withdrawalDueAt(new Date()).toISOString();
    const db = getDb();
    try {
      db.prepare('UPDATE users SET withdrawal_due_at = ? WHERE id = ?').run(due, author.id);
    } finally {
      db.close();
    }

    await page.goto('/withdrawal');
    await expect(page.getByRole('heading', { name: '退会の手続き中' })).toBeVisible();

    const withdrawalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(withdrawalOverflow).toBe(false);
  } finally {
    cleanupUser(author.id);
  }
});
