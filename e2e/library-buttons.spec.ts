import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { TEST_ADMIN, TEST_AUTHOR, TEST_DB_PATH } from './constants';

function randomHexSlug(): string {
  return crypto.randomBytes(10).toString('hex');
}

function getUserId(username: string): number {
  const db = new Database(TEST_DB_PATH);
  try {
    const row = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as
      { id: number } | undefined;
    if (!row) throw new Error(`User not found: ${username}`);
    return row.id;
  } finally {
    db.close();
  }
}

type SeedOptions = {
  slug?: string;
  title?: string;
  date?: string;
  body?: string;
  draft?: boolean;
  kind?: 'post' | 'scribble';
  authorId?: number | null;
};

function seedDbPost(options: SeedOptions = {}): {
  id: number;
  slug: string;
  title: string;
} {
  const db = new Database(TEST_DB_PATH);
  try {
    const slug = options.slug ?? randomHexSlug();
    const title = options.title ?? `Post ${slug}`;
    const date = options.date ?? '2026-10-15T09:00:00.000Z';
    const body = options.body ?? '本文です。';
    const draft = options.draft ? 1 : 0;
    const kind = options.kind ?? 'post';
    const authorId = options.authorId ?? null;

    const stmt = db.prepare(`
      INSERT INTO posts (
        slug, title, date, description, category, tags, draft, body,
        thumbnail, unlisted, edited_at, kind, author_id, created_at, updated_at
      ) VALUES (
        ?, ?, ?, '', 'uncategorized', '[]', ?, ?,
        '', 0, CURRENT_TIMESTAMP, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `);

    const result = stmt.run(slug, title, date, draft, body, kind, authorId);
    return { id: Number(result.lastInsertRowid), slug, title };
  } finally {
    db.close();
  }
}

function countRows(
  table: 'bookmarks' | 'likes' | 'post_views',
  userId: number,
  postId: number,
): number {
  const db = new Database(TEST_DB_PATH);
  try {
    const row = db
      .prepare(`SELECT COUNT(*) as c FROM ${table} WHERE user_id = ? AND post_id = ?`)
      .get(userId, postId) as { c: number };
    return row.c;
  } finally {
    db.close();
  }
}

test('without session, neither like nor bookmark buttons appear on post or scribble pages (docs/library-requirements.md §8)', async ({
  browser,
}) => {
  const unauthed = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const authorId = getUserId(TEST_AUTHOR.username);
    const post = seedDbPost({ kind: 'post', authorId });
    const scribble = seedDbPost({ kind: 'scribble', authorId });
    const unauthedPage = await unauthed.newPage();

    await unauthedPage.goto(`/posts/${post.slug}`);
    await expect(unauthedPage.getByRole('button', { name: 'いいね' })).toHaveCount(0);
    await expect(unauthedPage.getByRole('button', { name: 'ブックマーク' })).toHaveCount(0);

    await unauthedPage.goto(`/scribbles/${scribble.slug}`);
    await expect(unauthedPage.getByRole('button', { name: 'いいね' })).toHaveCount(0);
    await expect(unauthedPage.getByRole('button', { name: 'ブックマーク' })).toHaveCount(0);
  } finally {
    await unauthed.close();
  }
});

test('on another author post, toggling like and bookmark updates UI and DB', async ({ page }) => {
  const authorId = getUserId(TEST_AUTHOR.username);
  const adminId = getUserId(TEST_ADMIN.username);
  const post = seedDbPost({ kind: 'post', authorId });

  await page.goto(`/posts/${post.slug}`);

  const likeButton = page.getByRole('button', { name: 'いいね' });
  const bookmarkButton = page.getByRole('button', { name: 'ブックマーク' });

  await expect(likeButton).toBeVisible();
  await expect(bookmarkButton).toBeVisible();
  await expect(likeButton).toHaveAttribute('aria-pressed', 'false');
  await expect(bookmarkButton).toHaveAttribute('aria-pressed', 'false');

  await likeButton.click();
  await expect(likeButton).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => countRows('likes', adminId, post.id)).toBe(1);

  await bookmarkButton.click();
  await expect(bookmarkButton).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => countRows('bookmarks', adminId, post.id)).toBe(1);

  await page.reload();
  await expect(page.getByRole('button', { name: 'いいね' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'ブックマーク' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByRole('button', { name: 'いいね' }).click();
  await expect(page.getByRole('button', { name: 'いいね' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect.poll(() => countRows('likes', adminId, post.id)).toBe(0);

  await page.getByRole('button', { name: 'ブックマーク' }).click();
  await expect(page.getByRole('button', { name: 'ブックマーク' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect.poll(() => countRows('bookmarks', adminId, post.id)).toBe(0);
});

test('on own post, only bookmark button appears and like button is absent', async ({ page }) => {
  const adminId = getUserId(TEST_ADMIN.username);
  const post = seedDbPost({ kind: 'post', authorId: adminId });

  await page.goto(`/posts/${post.slug}`);

  await expect(page.getByRole('button', { name: 'いいね' })).toHaveCount(0);
  const bookmarkButton = page.getByRole('button', { name: 'ブックマーク' });
  await expect(bookmarkButton).toBeVisible();
  await expect(bookmarkButton).toHaveAttribute('aria-pressed', 'false');

  await bookmarkButton.click();
  await expect(bookmarkButton).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => countRows('bookmarks', adminId, post.id)).toBe(1);
});

test('records views for other author post, but not for own post or draft preview (docs/library-requirements.md §8)', async ({
  page,
}) => {
  const authorId = getUserId(TEST_AUTHOR.username);
  const adminId = getUserId(TEST_ADMIN.username);
  const otherPost = seedDbPost({ kind: 'post', authorId });
  const ownPost = seedDbPost({ kind: 'post', authorId: adminId });
  const draftPost = seedDbPost({ kind: 'post', draft: true, authorId });
  const sentinelPost = seedDbPost({ kind: 'post', authorId });

  // 1. Another author's post records a view
  await page.goto(`/posts/${otherPost.slug}`);
  await expect.poll(() => countRows('post_views', adminId, otherPost.id)).toBe(1);

  // 2. Own post is visited
  await page.goto(`/posts/${ownPost.slug}`);
  await expect(page.locator('#post-body')).toBeVisible();

  // 3. Draft preview is visited
  await page.goto(`/posts/${draftPost.slug}`);
  await expect(page.locator('#post-body')).toBeVisible();

  // 4. Sentinel post is visited and its view recorded, proving the page views above had settled
  await page.goto(`/posts/${sentinelPost.slug}`);
  await expect.poll(() => countRows('post_views', adminId, sentinelPost.id)).toBe(1);

  expect(countRows('post_views', adminId, ownPost.id)).toBe(0);
  expect(countRows('post_views', adminId, draftPost.id)).toBe(0);
});

test('on another author scribble, liking updates UI and DB', async ({ page }) => {
  const authorId = getUserId(TEST_AUTHOR.username);
  const adminId = getUserId(TEST_ADMIN.username);
  const scribble = seedDbPost({ kind: 'scribble', authorId });

  await page.goto(`/scribbles/${scribble.slug}`);

  const likeButton = page.getByRole('button', { name: 'いいね' });
  await expect(likeButton).toBeVisible();
  await expect(likeButton).toHaveAttribute('aria-pressed', 'false');

  await likeButton.click();
  await expect(likeButton).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => countRows('likes', adminId, scribble.id)).toBe(1);
});
