import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { TEST_ADMIN, TEST_AUTHOR, TEST_DB_PATH } from './constants';

test.use({ storageState: { cookies: [], origins: [] } });

function randomHexSlug(): string {
  return crypto.randomBytes(10).toString('hex');
}

function getDb(): Database.Database {
  return new Database(TEST_DB_PATH);
}

function getUserIds(): { adminId: number; authorId: number } {
  const db = getDb();
  try {
    const idOf = (username: string): number => {
      const row = db
        .prepare<[string], { id: number }>('SELECT id FROM users WHERE username = ?')
        .get(username);
      if (!row) throw new Error(`no user ${username} in test database`);
      return row.id;
    };
    return { adminId: idOf(TEST_ADMIN.username), authorId: idOf(TEST_AUTHOR.username) };
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
    const postSlug = slug ?? randomHexSlug();
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

// docs/multi-author-requirements.md §7 row 5.
test('an author opening another author’s edit, revisions, markdown export, or draft preview gets a 404', async ({
  page,
}) => {
  const { adminId } = getUserIds();
  const adminPost = insertPost({
    title: `Admin Post ${randomHexSlug()}`,
    kind: 'post',
    draft: false,
    authorId: adminId,
  });
  const adminDraft = insertPost({
    title: `Admin Draft ${randomHexSlug()}`,
    kind: 'post',
    draft: true,
    authorId: adminId,
  });

  await loginAsAuthor(page);

  // 1. Edit screen
  const editRes = await page.goto(`/admin/posts/${adminPost.id}/edit`);
  expect(editRes?.status()).toBe(404);

  // 2. Revisions screen
  const revRes = await page.goto(`/admin/posts/${adminPost.id}/revisions`);
  expect(revRes?.status()).toBe(404);

  // 3. Markdown export
  const mdRes = await page.request.get(`/admin/posts/${adminPost.id}/markdown`);
  expect(mdRes.status()).toBe(404);

  // 4. Draft preview
  const draftRes = await page.goto(`/posts/${adminDraft.slug}`);
  expect(draftRes?.status()).toBe(404);
});

// docs/multi-author-requirements.md §7 row 6.
test('an author sees only their own rows in post and scribble lists, while an admin sees all', async ({
  page,
}) => {
  const { adminId, authorId } = getUserIds();

  const authorArticle = insertPost({
    title: `Author Only Post ${randomHexSlug()}`,
    kind: 'post',
    draft: false,
    authorId,
  });
  const adminArticle = insertPost({
    title: `Admin Post For List ${randomHexSlug()}`,
    kind: 'post',
    draft: false,
    authorId: adminId,
  });

  const authorScribble = insertPost({
    title: `Author Only Scribble ${randomHexSlug()}`,
    kind: 'scribble',
    draft: false,
    authorId,
  });
  const adminScribble = insertPost({
    title: `Admin Scribble For List ${randomHexSlug()}`,
    kind: 'scribble',
    draft: false,
    authorId: adminId,
  });

  // Log in as author
  await loginAsAuthor(page);

  // Check /admin (記事一覧)
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: '記事一覧' })).toBeVisible();
  await expect(page.locator('li', { hasText: authorArticle.title })).toBeVisible();
  await expect(page.locator('li', { hasText: adminArticle.title })).toHaveCount(0);

  // Check /admin/scribbles (走り書き)
  await page.goto('/admin/scribbles');
  await expect(page.getByRole('heading', { name: '走り書き' })).toBeVisible();
  await expect(page.locator('li', { hasText: authorScribble.title })).toBeVisible();
  await expect(page.locator('li', { hasText: adminScribble.title })).toHaveCount(0);

  // Log in as admin
  await loginAsAdmin(page);

  // Admin sees all in /admin
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: '記事一覧' })).toBeVisible();
  await expect(page.locator('li', { hasText: authorArticle.title })).toBeVisible();
  await expect(page.locator('li', { hasText: adminArticle.title })).toBeVisible();

  // Admin sees all in /admin/scribbles
  await page.goto('/admin/scribbles');
  await expect(page.getByRole('heading', { name: '走り書き' })).toBeVisible();
  await expect(page.locator('li', { hasText: authorScribble.title })).toBeVisible();
  await expect(page.locator('li', { hasText: adminScribble.title })).toBeVisible();
});
