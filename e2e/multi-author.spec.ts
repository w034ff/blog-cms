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

// docs/multi-author-requirements.md §7 row 11.
test('author display name appears in post and scribble date rows when set, disappears when empty, and updates via account settings', async ({
  page,
}) => {
  const { authorId } = getUserIds();
  const db = getDb();
  try {
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run('', authorId);
  } finally {
    db.close();
  }

  const authorPost = insertPost({
    title: `Author Post ${randomHexSlug()}`,
    kind: 'post',
    draft: false,
    authorId,
  });
  const authorScribble = insertPost({
    title: `Author Scribble ${randomHexSlug()}`,
    kind: 'scribble',
    draft: false,
    authorId,
  });

  // 1. Set display name in DB -> appears on post and scribble pages
  const db1 = getDb();
  try {
    db1.prepare('UPDATE users SET display_name = ? WHERE id = ?').run('テスト著者', authorId);
  } finally {
    db1.close();
  }

  // Post page: signature appears in the date row without '・'
  await page.goto(`/posts/${authorPost.slug}`);
  const postSignature = page.locator('article header [data-author-signature]');
  await expect(postSignature).toBeVisible();
  await expect(postSignature).toHaveText('テスト著者');
  await expect(postSignature).not.toContainText('・');

  // Scribble page: signature appears after date with '・'
  await page.goto(`/scribbles/${authorScribble.slug}`);
  const scribbleSignature = page.locator('article header [data-author-signature]');
  await expect(scribbleSignature).toBeVisible();
  await expect(scribbleSignature).toContainText('・');
  await expect(scribbleSignature).toContainText('テスト著者');

  // 2. Set display name to empty in DB -> disappears from both pages
  const db2 = getDb();
  try {
    db2.prepare('UPDATE users SET display_name = ? WHERE id = ?').run('', authorId);
  } finally {
    db2.close();
  }

  await page.goto(`/posts/${authorPost.slug}`);
  await expect(page.locator('article header [data-author-signature]')).toHaveCount(0);
  await expect(page.locator('article header')).not.toContainText('テスト著者');

  await page.goto(`/scribbles/${authorScribble.slug}`);
  await expect(page.locator('article header [data-author-signature]')).toHaveCount(0);
  await expect(page.locator('article header')).not.toContainText('・');
  await expect(page.locator('article header')).not.toContainText('テスト著者');

  // 3. Save display name via Account Settings screen (/admin/account) -> signature updates
  await loginAsAuthor(page);
  const accountNav = page.locator('header').getByRole('navigation', { name: 'アカウント' });
  await accountNav.getByRole('button', { name: 'アカウントのメニュー' }).click();
  await accountNav.getByRole('link', { name: 'アカウントの設定' }).click();
  await expect(page).toHaveURL(/\/admin\/account$/);
  await expect(page.getByRole('heading', { name: 'アカウントの設定' })).toBeVisible();

  const nameInput = page.getByLabel('表示名');
  await expect(nameInput).toHaveValue('');
  await nameInput.fill('画面著者');
  await expect(page.getByText('4 / 20')).toBeVisible();
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('status')).toHaveText('保存しました');

  // Signature now appears on post page
  await page.goto(`/posts/${authorPost.slug}`);
  await expect(page.locator('article header [data-author-signature]')).toHaveText('画面著者');

  // Clean up
  const db3 = getDb();
  try {
    db3.prepare('UPDATE users SET display_name = ? WHERE id = ?').run('', authorId);
  } finally {
    db3.close();
  }
});

// docs/multi-author-requirements.md §9.9 row 21.
test('author name appears in admin post and scribble lists for admin, but not for author', async ({
  page,
}) => {
  const { authorId } = getUserIds();

  const db = getDb();
  try {
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run('著者Alice', authorId);
  } finally {
    db.close();
  }

  const authorArticle = insertPost({
    title: `Author Article For Name Check ${randomHexSlug()}`,
    kind: 'post',
    draft: false,
    authorId,
  });
  const authorScribble = insertPost({
    title: `Author Scribble For Name Check ${randomHexSlug()}`,
    kind: 'scribble',
    draft: false,
    authorId,
  });

  // 1. Admin logs in
  await loginAsAdmin(page);

  // Admin in /admin sees author's name on author's article
  await page.goto('/admin');
  const adminArticleRow = page.locator('li', { hasText: authorArticle.title });
  await expect(adminArticleRow).toBeVisible();
  await expect(adminArticleRow).toContainText('著者Alice');

  // Admin in /admin/scribbles sees author's name on author's scribble
  await page.goto('/admin/scribbles');
  const adminScribbleRow = page.locator('li', { hasText: authorScribble.title });
  await expect(adminScribbleRow).toBeVisible();
  await expect(adminScribbleRow).toContainText('著者Alice');

  // 2. Author logs in
  await loginAsAuthor(page);

  // Author in /admin sees article but NOT author name
  await page.goto('/admin');
  const authorArticleRow = page.locator('li', { hasText: authorArticle.title });
  await expect(authorArticleRow).toBeVisible();
  await expect(authorArticleRow).not.toContainText('著者Alice');

  // Author in /admin/scribbles sees scribble but NOT author name
  await page.goto('/admin/scribbles');
  const authorScribbleRow = page.locator('li', { hasText: authorScribble.title });
  await expect(authorScribbleRow).toBeVisible();
  await expect(authorScribbleRow).not.toContainText('著者Alice');

  // Clean up
  const dbClean = getDb();
  try {
    dbClean.prepare('UPDATE users SET display_name = ? WHERE id = ?').run('', authorId);
  } finally {
    dbClean.close();
  }
});

// docs/multi-author-requirements.md §9.9 row 23.
test('a signed-in author who is then suspended lands on the login form, not in a redirect loop', async ({
  page,
}) => {
  await loginAsAuthor(page);
  // A valid session is still sent on from /login.
  await page.goto('/login');
  await expect(page).toHaveURL(/\/admin$/);

  const db = getDb();
  try {
    db.prepare("UPDATE users SET suspended_at = '2026-10-18T00:00:00.000Z' WHERE username = ?").run(
      TEST_AUTHOR.username,
    );
  } finally {
    db.close();
  }
  try {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel('ユーザー名').fill(TEST_AUTHOR.username);
    await page.getByLabel('パスワード').fill(TEST_AUTHOR.password);
    await page.getByRole('button', { name: 'ログイン' }).click();
    await expect(page.getByText('このアカウントは停止されています。')).toBeVisible();
  } finally {
    const restore = getDb();
    try {
      restore
        .prepare('UPDATE users SET suspended_at = NULL WHERE username = ?')
        .run(TEST_AUTHOR.username);
    } finally {
      restore.close();
    }
  }
});
