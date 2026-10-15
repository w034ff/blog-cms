import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { TEST_ADMIN, TEST_AUTHOR, TEST_DB_PATH } from './constants';

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
      if (!row) throw new Error(`no user ${username} in the test database`);
      return row.id;
    };
    return { adminId: idOf(TEST_ADMIN.username), authorId: idOf(TEST_AUTHOR.username) };
  } finally {
    db.close();
  }
}

// The account's bookmark rows for one post. Polled by callers: the icon flips before the Action's
// write lands (docs/library-requirements.md §6.2), so one read right after the click can race it.
function bookmarkCount(userId: number, postId: number): number {
  const db = getDb();
  try {
    const row = db
      .prepare<[number, number], { count: number }>(
        'SELECT COUNT(*) AS count FROM bookmarks WHERE user_id = ? AND post_id = ?',
      )
      .get(userId, postId);
    return row?.count ?? 0;
  } finally {
    db.close();
  }
}

function insertPost({
  title,
  kind = 'post',
  draft = false,
  authorId,
  date = '2026-10-15T09:00:00.000Z',
}: {
  title: string;
  kind?: 'post' | 'scribble';
  draft?: boolean;
  authorId: number;
  date?: string;
}): { id: number; slug: string; title: string } {
  const db = getDb();
  try {
    const slug = randomHexSlug();
    const stmt = db.prepare(`
      INSERT INTO posts (
        slug, title, date, description, category, tags, draft, body,
        thumbnail, unlisted, edited_at, kind, created_at, updated_at, author_id
      ) VALUES (
        ?, ?, ?, '', 'uncategorized', '[]', ?, '本文です。',
        '', 0, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?
      )
    `);
    const result = stmt.run(slug, title, date, draft ? 1 : 0, kind, authorId);
    return { id: Number(result.lastInsertRowid), slug, title };
  } finally {
    db.close();
  }
}

test.describe.serial('Admin Library', () => {
  test('empty tabs show illustrations and messages without a creation button', async ({ page }) => {
    const { adminId } = getUserIds();
    const db = getDb();
    try {
      db.prepare('DELETE FROM bookmarks WHERE user_id = ?').run(adminId);
      db.prepare('DELETE FROM likes WHERE user_id = ?').run(adminId);
      db.prepare('DELETE FROM post_views WHERE user_id = ?').run(adminId);
    } finally {
      db.close();
    }

    await page.goto('/admin/library');
    await expect(page.getByRole('heading', { level: 1, name: 'ライブラリ' })).toBeVisible();

    // Bookmarks empty state
    await expect(page.getByRole('heading', { level: 2, name: /読み返したい記事を/ })).toBeVisible();
    await expect(page.getByText(/記事や走り書きのページでブックマークすると/)).toBeVisible();
    await expect(page.getByRole('link', { name: '新規作成' })).toHaveCount(0);

    // Likes empty state
    await page.getByRole('link', { name: /いいね/ }).click();
    await expect(page).toHaveURL(/\/admin\/library\?tab=likes$/);
    await expect(page.getByRole('heading', { level: 2, name: /心に残った記事を/ })).toBeVisible();
    await expect(page.getByText(/ほかの人の記事や走り書きにいいねすると/)).toBeVisible();
    await expect(page.getByRole('link', { name: '新規作成' })).toHaveCount(0);

    // History empty state
    await page.getByRole('link', { name: /閲覧履歴/ }).click();
    await expect(page).toHaveURL(/\/admin\/library\?tab=history$/);
    await expect(page.getByRole('heading', { level: 2, name: /読んだ記事を/ })).toBeVisible();
    await expect(page.getByText(/新しい順に 100 件まで残ります。/)).toBeVisible();
    await expect(page.getByRole('link', { name: '新規作成' })).toHaveCount(0);
  });

  test('left menu navigates to /admin/library with bookmarks selected by default', async ({
    page,
  }) => {
    await page.goto('/admin');
    const sideNav = page.getByRole('navigation', { name: '管理' });
    await sideNav.getByRole('link', { name: 'ライブラリ' }).click();
    await expect(page).toHaveURL(/\/admin\/library$/);
    await expect(page.getByRole('heading', { level: 1, name: 'ライブラリ' })).toBeVisible();

    const bookmarksTab = page
      .getByRole('navigation', { name: 'ライブラリ' })
      .getByRole('link', { name: /ブックマーク/ });
    await expect(bookmarksTab).toHaveAttribute('aria-current', 'page');
  });

  test('each tab shows entries newest first, title links to public page, and chips show kind', async ({
    page,
  }) => {
    const { adminId, authorId } = getUserIds();

    const article1 = insertPost({
      title: `Author Article 1 ${randomHexSlug()}`,
      kind: 'post',
      authorId,
    });
    const scribble1 = insertPost({
      title: `Author Scribble 1 ${randomHexSlug()}`,
      kind: 'scribble',
      authorId,
    });
    const article2 = insertPost({
      title: `Author Article 2 ${randomHexSlug()}`,
      kind: 'post',
      authorId,
    });
    const scribble2 = insertPost({
      title: `Author Scribble 2 ${randomHexSlug()}`,
      kind: 'scribble',
      authorId,
    });

    const now = Date.now();
    const db = getDb();
    try {
      // Bookmarks: scribble1 newer than article1
      db.prepare('INSERT INTO bookmarks (user_id, post_id, created_at) VALUES (?, ?, ?)').run(
        adminId,
        article1.id,
        now - 10000,
      );
      db.prepare('INSERT INTO bookmarks (user_id, post_id, created_at) VALUES (?, ?, ?)').run(
        adminId,
        scribble1.id,
        now - 5000,
      );

      // Likes: article2 newer than scribble1
      db.prepare('INSERT INTO likes (user_id, post_id, created_at) VALUES (?, ?, ?)').run(
        adminId,
        scribble1.id,
        now - 8000,
      );
      db.prepare('INSERT INTO likes (user_id, post_id, created_at) VALUES (?, ?, ?)').run(
        adminId,
        article2.id,
        now - 2000,
      );

      // Post views: scribble2 newer than article2
      db.prepare('INSERT INTO post_views (user_id, post_id, viewed_at) VALUES (?, ?, ?)').run(
        adminId,
        article2.id,
        now - 6000,
      );
      db.prepare('INSERT INTO post_views (user_id, post_id, viewed_at) VALUES (?, ?, ?)').run(
        adminId,
        scribble2.id,
        now - 1000,
      );
    } finally {
      db.close();
    }

    // 1. Check bookmarks tab
    await page.goto('/admin/library');
    const bookmarkRows = page.locator('ul.divide-y > li');
    await expect(bookmarkRows.first()).toContainText(scribble1.title);
    await expect(bookmarkRows.nth(1)).toContainText(article1.title);

    const scribbleBookmarkLink = bookmarkRows.first().getByRole('link', { name: scribble1.title });
    await expect(scribbleBookmarkLink).toHaveAttribute('href', `/scribbles/${scribble1.slug}`);
    await expect(bookmarkRows.first().getByText('走り書き')).toBeVisible();

    const articleBookmarkLink = bookmarkRows.nth(1).getByRole('link', { name: article1.title });
    await expect(articleBookmarkLink).toHaveAttribute('href', `/posts/${article1.slug}`);
    await expect(bookmarkRows.nth(1).getByText('記事')).toBeVisible();

    // 2. Check likes tab
    await page.getByRole('link', { name: /いいね/ }).click();
    await expect(page).toHaveURL(/\/admin\/library\?tab=likes$/);
    const likeRows = page.locator('ul.divide-y > li');
    await expect(likeRows.first()).toContainText(article2.title);
    await expect(likeRows.nth(1)).toContainText(scribble1.title);
    await expect(likeRows.first().getByRole('link', { name: article2.title })).toHaveAttribute(
      'href',
      `/posts/${article2.slug}`,
    );
    await expect(likeRows.first().getByText('記事')).toBeVisible();
    await expect(likeRows.nth(1).getByRole('link', { name: scribble1.title })).toHaveAttribute(
      'href',
      `/scribbles/${scribble1.slug}`,
    );
    await expect(likeRows.nth(1).getByText('走り書き')).toBeVisible();

    // 3. Check history tab
    await page.getByRole('link', { name: /閲覧履歴/ }).click();
    await expect(page).toHaveURL(/\/admin\/library\?tab=history$/);
    const historyRows = page.locator('ul.divide-y > li');
    await expect(historyRows.first()).toContainText(scribble2.title);
    await expect(historyRows.nth(1)).toContainText(article2.title);
    await expect(historyRows.first().getByRole('link', { name: scribble2.title })).toHaveAttribute(
      'href',
      `/scribbles/${scribble2.slug}`,
    );
    await expect(historyRows.first().getByText('走り書き')).toBeVisible();
    await expect(historyRows.nth(1).getByRole('link', { name: article2.title })).toHaveAttribute(
      'href',
      `/posts/${article2.slug}`,
    );
    await expect(historyRows.nth(1).getByText('記事')).toBeVisible();
  });

  test('a post returned to draft does not appear in the library list', async ({ page }) => {
    const { adminId, authorId } = getUserIds();
    const draftPost = insertPost({
      title: `Draft Post In Library ${randomHexSlug()}`,
      kind: 'post',
      draft: false,
      authorId,
    });

    const db = getDb();
    try {
      db.prepare('INSERT INTO bookmarks (user_id, post_id, created_at) VALUES (?, ?, ?)').run(
        adminId,
        draftPost.id,
        Date.now(),
      );
    } finally {
      db.close();
    }

    await page.goto('/admin/library');
    await expect(page.getByText(draftPost.title)).toBeVisible();

    // Return post to draft
    const db2 = getDb();
    try {
      db2.prepare('UPDATE posts SET draft = 1 WHERE id = ?').run(draftPost.id);
    } finally {
      db2.close();
    }

    await page.reload();
    await expect(page.getByText(draftPost.title)).toHaveCount(0);
  });

  test('clicking unmark icon removes row from database but keeps it in DOM; clicking again restores it', async ({
    page,
  }) => {
    const { adminId, authorId } = getUserIds();
    const post = insertPost({
      title: `Toggle Bookmark ${randomHexSlug()}`,
      kind: 'post',
      authorId,
    });

    const db = getDb();
    try {
      db.prepare('INSERT INTO bookmarks (user_id, post_id, created_at) VALUES (?, ?, ?)').run(
        adminId,
        post.id,
        Date.now(),
      );
    } finally {
      db.close();
    }

    await page.goto('/admin/library');
    const row = page.locator('li', { hasText: post.title });
    await expect(row).toBeVisible();

    const button = row.getByRole('button');
    await expect(button).toHaveAttribute('aria-label', 'ブックマークを外す');
    await expect(button).toHaveAttribute('aria-pressed', 'true');

    // Click to unmark
    await button.click();
    await expect(button).toHaveAttribute('aria-label', 'ブックマークし直す');
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    // Row remains in DOM
    await expect(row).toBeVisible();

    await expect.poll(() => bookmarkCount(adminId, post.id)).toBe(0);

    // Click again to restore
    await button.click();
    await expect(button).toHaveAttribute('aria-label', 'ブックマークを外す');
    await expect(button).toHaveAttribute('aria-pressed', 'true');

    await expect.poll(() => bookmarkCount(adminId, post.id)).toBe(1);
  });

  test('post list shows like count only on posts with at least one like', async ({ page }) => {
    const { authorId } = getUserIds();
    const likedPost = insertPost({
      title: `Liked Post For Count ${randomHexSlug()}`,
      kind: 'post',
      authorId,
    });
    const unlikedPost = insertPost({
      title: `Unliked Post For Count ${randomHexSlug()}`,
      kind: 'post',
      authorId,
    });

    const db = getDb();
    try {
      // 2 likes for likedPost
      db.prepare('INSERT OR IGNORE INTO likes (user_id, post_id, created_at) VALUES (1, ?, ?)').run(
        likedPost.id,
        Date.now(),
      );
      db.prepare('INSERT OR IGNORE INTO likes (user_id, post_id, created_at) VALUES (2, ?, ?)').run(
        likedPost.id,
        Date.now(),
      );
    } finally {
      db.close();
    }

    await page.goto('/admin');
    const likedRow = page.locator('li', { hasText: likedPost.title });
    const unlikedRow = page.locator('li', { hasText: unlikedPost.title });

    await expect(likedRow).toBeVisible();
    await expect(likedRow.locator('span.text-\\(--accent\\)')).toContainText('2');

    await expect(unlikedRow).toBeVisible();
    await expect(unlikedRow.locator('span.text-\\(--accent\\)')).toHaveCount(0);
  });

  test('e2e-author sees ライブラリ in left menu', async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const page = await context.newPage();
      await page.goto('/login');
      await page.getByLabel('ユーザー名').fill(TEST_AUTHOR.username);
      await page.getByLabel('パスワード').fill(TEST_AUTHOR.password);
      await page.getByRole('button', { name: 'ログイン' }).click();
      await expect(page).toHaveURL(/\/admin$/);

      const nav = page.getByRole('navigation', { name: '管理' });
      await expect(nav.getByRole('link', { name: 'ライブラリ' })).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
