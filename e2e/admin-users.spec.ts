import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { TEST_ADMIN, TEST_AUTHOR, TEST_DB_PATH, TEST_SESSION_SECRET } from './constants';
import { hashEmailWithSecret } from '../lib/email-hash-rules';

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
    const inviteBadge = inviteRow.getByText('招待中');
    await expect(inviteBadge).toBeVisible();
    expect(await inviteBadge.evaluate((el) => window.getComputedStyle(el).fontSize)).toBe('12px');
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
    const inviteBadge = inviteRow.getByText('招待中');
    expect(await inviteBadge.evaluate((el) => window.getComputedStyle(el).fontSize)).toBe('12px');

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

// docs/multi-author-requirements.md §10.7 criteria 25, 28, 34.
test('shows 招待で参加 badge, filters by email without query in URL, and links previous names (criteria 25, 28, 34)', async ({
  page,
}) => {
  const db = getDb();
  let inviteUserId = 0;
  let openUserId = 0;
  const inviteEmail = 'invite-user-e2e@example.com';
  const openEmail = 'open-user-e2e@example.com';
  const inviteHash = hashEmailWithSecret(TEST_SESSION_SECRET, inviteEmail);
  const openHash = hashEmailWithSecret(TEST_SESSION_SECRET, openEmail);

  try {
    const inviteRes = db
      .prepare(
        `INSERT INTO users (role, display_name, google_sub, email_hash, joined_via, created_at)
         VALUES ('author', '招待著者E2E', 'google-sub-invite-e2e', ?, 'invite', '2026-10-14T00:00:00.000Z')`,
      )
      .run(inviteHash);
    inviteUserId = Number(inviteRes.lastInsertRowid);

    const openRes = db
      .prepare(
        `INSERT INTO users (role, display_name, google_sub, email_hash, joined_via, created_at)
         VALUES ('author', 'オープン著者E2E', 'google-sub-open-e2e', ?, 'open', '2026-10-15T00:00:00.000Z')`,
      )
      .run(openHash);
    openUserId = Number(openRes.lastInsertRowid);

    // 4 history rows for invite user: initial + 3 changes
    db.prepare(
      `INSERT INTO display_name_history (user_id, display_name, kind, changed_at)
       VALUES (?, '旧名A', 'initial', '2026-10-14T01:00:00.000Z')`,
    ).run(inviteUserId);
    db.prepare(
      `INSERT INTO display_name_history (user_id, display_name, kind, changed_at)
       VALUES (?, '旧名B', 'change', '2026-10-15T01:00:00.000Z')`,
    ).run(inviteUserId);
    db.prepare(
      `INSERT INTO display_name_history (user_id, display_name, kind, changed_at)
       VALUES (?, '旧名C', 'change', '2026-10-16T01:00:00.000Z')`,
    ).run(inviteUserId);
    db.prepare(
      `INSERT INTO display_name_history (user_id, display_name, kind, changed_at)
       VALUES (?, '招待著者E2E', 'change', '2026-10-17T01:00:00.000Z')`,
    ).run(inviteUserId);
  } finally {
    db.close();
  }

  try {
    await loginAsAdmin(page);
    await page.goto('/admin/users');

    // 1. Badge check (criterion 25)
    const inviteRow = page.locator('li', { hasText: '招待著者E2E' });
    const openRow = page.locator('li', { hasText: 'オープン著者E2E' });
    await expect(inviteRow).toBeVisible();
    await expect(openRow).toBeVisible();

    const inviteBadge = inviteRow.getByText('招待で参加');
    await expect(inviteBadge).toBeVisible();
    expect(await inviteBadge.evaluate((el) => window.getComputedStyle(el).fontSize)).toBe('12px');
    await expect(openRow.getByText('招待で参加')).toHaveCount(0);

    // 2. Display name link & previous names history on list (criteria 34)
    const nameLink = inviteRow.getByRole('link', { name: '招待著者E2E' });
    await expect(nameLink).toHaveAttribute('href', `/admin/users/${inviteUserId}`);

    // The previous 3 names newest-first: 旧名C → 旧名B → 旧名A, plus すべて見る（4 件）
    await expect(inviteRow.getByText('以前の表示名: 旧名C → 旧名B → 旧名A')).toBeVisible();
    const allHistoryLink = inviteRow.getByRole('link', { name: 'すべて見る（4 件）' });
    await expect(allHistoryLink).toBeVisible();
    await expect(allHistoryLink).toHaveAttribute('href', `/admin/users/${inviteUserId}`);

    // 3. Email search (criterion 28)
    const searchInput = page.getByLabel('メールで探す');
    await searchInput.fill(inviteEmail);
    await searchInput.press('Enter');

    // Email is NOT in the URL
    expect(page.url()).not.toContain(inviteEmail);
    expect(new URL(page.url()).search).toBe('');

    // Matched state: count line appears, only inviteRow is visible
    await expect(page.getByText(`「${inviteEmail}」に一致する利用者：1 件`)).toBeVisible();
    await expect(inviteRow).toBeVisible();
    await expect(openRow).toHaveCount(0);

    // Clear search
    await page.getByRole('button', { name: '条件をクリア' }).click();
    await expect(searchInput).toHaveValue('');
    await expect(inviteRow).toBeVisible();
    await expect(openRow).toBeVisible();
    await expect(page.getByText(`「${inviteEmail}」に一致する利用者：1 件`)).toHaveCount(0);

    // Search with non-matching email
    await searchInput.fill('nobody-matched@example.com');
    await searchInput.press('Enter');

    expect(page.url()).not.toContain('nobody-matched');
    expect(new URL(page.url()).search).toBe('');

    await expect(page.getByText('条件に合う利用者はいません。')).toBeVisible();
    await expect(inviteRow).toHaveCount(0);
    await expect(openRow).toHaveCount(0);

    // Clear again
    await page.getByRole('button', { name: '条件をクリア' }).click();
    await expect(searchInput).toHaveValue('');
    await expect(inviteRow).toBeVisible();
    await expect(openRow).toBeVisible();

    // 4. Click すべて見る link to navigate to detail page
    await allHistoryLink.click();
    await expect(page).toHaveURL(new RegExp(`/admin/users/${inviteUserId}$`));
  } finally {
    const dbClean = getDb();
    try {
      dbClean
        .prepare(`DELETE FROM display_name_history WHERE user_id IN (?, ?)`)
        .run(inviteUserId, openUserId);
      dbClean.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(inviteUserId, openUserId);
    } finally {
      dbClean.close();
    }
  }
});

// docs/multi-author-requirements.md §10.7 criteria 33.
test('user detail page access, history, writings, and suspension (criteria 33)', async ({
  page,
}) => {
  const db = getDb();
  let authorUserId = 0;
  let postArticleId = 0;
  let draftArticleId = 0;
  let scribbleId = 0;

  try {
    const res = db
      .prepare(
        `INSERT INTO users (role, display_name, google_sub, joined_via, created_at)
         VALUES ('author', '詳細テスト著者', 'google-sub-detail-test', 'invite', '2026-10-10T00:00:00.000Z')`,
      )
      .run();
    authorUserId = Number(res.lastInsertRowid);

    // 4 history rows
    db.prepare(
      `INSERT INTO display_name_history (user_id, display_name, kind, changed_at)
       VALUES (?, '初期名', 'initial', '2026-10-10T01:00:00.000Z')`,
    ).run(authorUserId);
    db.prepare(
      `INSERT INTO display_name_history (user_id, display_name, kind, changed_at)
       VALUES (?, '変遷1', 'change', '2026-10-11T01:00:00.000Z')`,
    ).run(authorUserId);
    db.prepare(
      `INSERT INTO display_name_history (user_id, display_name, kind, changed_at)
       VALUES (?, '変遷2', 'change', '2026-10-12T01:00:00.000Z')`,
    ).run(authorUserId);
    db.prepare(
      `INSERT INTO display_name_history (user_id, display_name, kind, changed_at)
       VALUES (?, '詳細テスト著者', 'change', '2026-10-13T01:00:00.000Z')`,
    ).run(authorUserId);

    // Seed posts: 1 published article, 1 draft article, 1 scribble
    const p1 = db
      .prepare(
        `INSERT INTO posts (slug, title, date, kind, draft, author_id, created_at)
         VALUES ('detail-post-1', '公開記事1', '2026-10-11', 'post', 0, ?, '2026-10-11T00:00:00.000Z')`,
      )
      .run(authorUserId);
    postArticleId = Number(p1.lastInsertRowid);

    const p2 = db
      .prepare(
        `INSERT INTO posts (slug, title, date, kind, draft, author_id, created_at)
         VALUES ('detail-post-2', '下書き記事2', '2026-10-12', 'post', 1, ?, '2026-10-12T00:00:00.000Z')`,
      )
      .run(authorUserId);
    draftArticleId = Number(p2.lastInsertRowid);

    const p3 = db
      .prepare(
        `INSERT INTO posts (slug, title, date, kind, draft, author_id, created_at)
         VALUES ('detail-scribble-1', 'テスト走り書き', '2026-10-13', 'scribble', 0, ?, '2026-10-13T00:00:00.000Z')`,
      )
      .run(authorUserId);
    scribbleId = Number(p3.lastInsertRowid);
  } finally {
    db.close();
  }

  try {
    // 1. Author gets 404
    await loginAsAuthor(page);
    const authorResponse = await page.goto(`/admin/users/${authorUserId}`);
    expect(authorResponse?.status()).toBe(404);

    // 2. Admin gets 404 for non-existent id
    await loginAsAdmin(page);
    const missingResponse = await page.goto('/admin/users/999999');
    expect(missingResponse?.status()).toBe(404);

    // 3. Admin visits valid user detail page
    const okResponse = await page.goto(`/admin/users/${authorUserId}`);
    expect(okResponse?.status()).toBe(200);

    // Title metadata is account name
    await expect(page).toHaveTitle(/^詳細テスト著者 \| /);

    // Back link
    await expect(page.getByRole('link', { name: '← 利用者' })).toBeVisible();

    // Heading and badges
    await expect(page.getByRole('heading', { level: 1, name: '詳細テスト著者' })).toBeVisible();

    // Line 2
    await expect(page.getByText('Google でログイン')).toBeVisible();
    await expect(page.getByText('招待で参加')).toBeVisible();
    await expect(page.getByText('登録 2026年10月10日')).toBeVisible();

    // 4. Display name history (all 4 items shown)
    const historySection = page.getByRole('heading', { name: '表示名の履歴' }).locator('..');
    await expect(historySection.getByText('詳細テスト著者')).toBeVisible();
    await expect(historySection.getByText('いまの表示名')).toBeVisible();
    await expect(historySection.getByText('変遷2')).toBeVisible();
    await expect(historySection.getByText('変遷1')).toBeVisible();
    await expect(historySection.getByText('初期名')).toBeVisible();

    // 5. Writings section
    const writingsSection = page.getByRole('heading', { name: '書いたもの' }).locator('..');
    await expect(writingsSection.getByRole('button', { name: '記事 2' })).toBeVisible();
    await expect(writingsSection.getByRole('button', { name: '走り書き 1' })).toBeVisible();

    // Articles tab is active by default
    const pubArticleLink = writingsSection.getByRole('link', { name: '公開記事1' });
    await expect(pubArticleLink).toBeVisible();
    await expect(pubArticleLink).toHaveAttribute('href', `/admin/posts/${postArticleId}/edit`);

    const draftArticleLink = writingsSection.getByRole('link', { name: '下書き記事2' });
    await expect(draftArticleLink).toBeVisible();
    await expect(draftArticleLink).toHaveAttribute('href', `/admin/posts/${draftArticleId}/edit`);
    await expect(writingsSection.getByText('下書き', { exact: true })).toBeVisible();

    // Switch to scribbles tab
    await writingsSection.getByRole('button', { name: '走り書き 1' }).click();
    const scribbleLink = writingsSection.getByRole('link', { name: 'テスト走り書き' });
    await expect(scribbleLink).toBeVisible();
    await expect(scribbleLink).toHaveAttribute('href', `/admin/posts/${scribbleId}/edit`);

    // 6. Suspend and unsuspend round trip
    await page.getByRole('button', { name: '停止する' }).click();
    await expect(
      page.getByText(
        'このアカウントを停止します。ログインと書き込みができなくなり、公開中の記事と走り書きはサイトから外れます。解除すると元に戻ります。',
      ),
    ).toBeVisible();
    await page.getByRole('button', { name: '停止する' }).click();

    // Now suspended: badge appears, button becomes 停止を解除
    await expect(page.getByText('停止中')).toBeVisible();
    await expect(page.getByRole('button', { name: '停止を解除' })).toBeVisible();

    // Unsuspend
    await page.getByRole('button', { name: '停止を解除' }).click();
    await expect(page.getByText('停止中')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '停止する' })).toBeVisible();

    // 7. Width 360px overflow check
    await page.setViewportSize({ width: 360, height: 640 });
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  } finally {
    const dbClean = getDb();
    try {
      dbClean
        .prepare(`DELETE FROM posts WHERE id IN (?, ?, ?)`)
        .run(postArticleId, draftArticleId, scribbleId);
      dbClean.prepare(`DELETE FROM display_name_history WHERE user_id = ?`).run(authorUserId);
      dbClean.prepare(`DELETE FROM users WHERE id = ?`).run(authorUserId);
    } finally {
      dbClean.close();
    }
  }
});
