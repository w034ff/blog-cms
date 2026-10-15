import { test, expect } from '@playwright/test';
import { expectAutosaved, expectPublished, loadMarkdown, ensureCategory } from './editor-authoring';
import { postSlug } from './published-post';
import Database from 'better-sqlite3';
import { TEST_DB_PATH } from './constants';
import { SITE_NAME } from '../app/shared-metadata';

// What does `revalidateBlog()` (`revalidatePath('/', 'layout')`, app/actions/posts.ts) invalidate?
// Not the Data Cache, which only `fetch()` uses (docs/cms-features.md「RSS/Atom フィード」§7.1), nor
// the Full Route Cache (every public route is `force-dynamic`). What remains is the browser's Client
// Cache (node_modules/next/dist/docs/01-app/04-glossary.md, "Client Cache"): if that is it, removing
// the call hides a fresh edit on an already-visited surface. So every hop is a <Link>, with one
// `page.goto` at the start; a reload would clear the cache.
//
// MUST run against a production server (`next build && next start`, E2E_EXTERNAL_SERVER=1):
// prefetching "runs only in production" (…/02-guides/prefetching.md).
test('a published edit is visible on every surface reached by <Link> alone', async ({ page }) => {
  const stamp = Date.now();
  const before = `RC before ${stamp}`;
  const after = `RC after ${stamp}`;

  // ---- create and publish, so there is a live post on every listing ----
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await page.getByLabel('タイトル').fill(before);
  await loadMarkdown(page, 'Body before.');
  await expectAutosaved(page);
  await ensureCategory(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);
  const slug = await postSlug(page);

  // ---- warm the client cache: visit each surface once, by <Link> ----
  await page.getByRole('link', { name: '記事一覧' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('link', { name: before })).toBeVisible();

  await page.getByRole('link', { name: SITE_NAME }).click();
  await expect(page.getByRole('heading', { name: before })).toBeVisible();

  await page.getByRole('link', { name: before }).first().click();
  await expect(page).toHaveURL(new RegExp(`/posts/${slug}$`));
  await expect(page.getByText('Body before.')).toBeVisible();

  await page.getByRole('button', { name: 'アカウントのメニュー' }).click();
  await page.getByRole('link', { name: '管理画面' }).click();
  await expect(page).toHaveURL(/\/admin$/);

  // ---- edit the live post and push it public ----
  await page.getByRole('link', { name: before }).click();
  await expect(page).toHaveURL(/\/admin\/posts\/\d+\/edit$/);
  await expect(editor).toBeVisible();
  await page.getByLabel('タイトル').fill(after);
  await loadMarkdown(page, 'Body after.');
  await expectAutosaved(page);
  await page.getByRole('button', { name: '更新' }).click();
  await expectPublished(page);

  // ---- observe the three cached surfaces, still without a reload ----
  await page.getByRole('link', { name: '記事一覧' }).click();
  await expect(page.getByRole('link', { name: after }), '/admin is stale').toBeVisible();

  await page.getByRole('link', { name: SITE_NAME }).click();
  await expect(page.getByRole('heading', { name: after }), '/ is stale').toBeVisible();

  await page.getByRole('link', { name: after }).first().click();
  await expect(page).toHaveURL(new RegExp(`/posts/${slug}$`));
  await expect(page.getByText('Body after.'), `/posts/${slug} is stale`).toBeVisible();
});

// The control: if the Client Cache never held these pages, the test above passes regardless. So the
// post is changed behind the server's back (a direct SQLite UPDATE, no Server Action) and the same
// <Link> path is walked:
//   - stale titles → the cache retains routes, and `revalidatePath` has something to clear
//   - fresh titles → it does not, and `revalidateBlog()` is inert
// Measured against a production build: fresh on all three. The final reload proves the write.
test('what the client cache does with a change no Server Action announced', async ({ page }) => {
  const stamp = Date.now();
  const before = `CC before ${stamp}`;
  const after = `CC after ${stamp}`;

  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await page.getByLabel('タイトル').fill(before);
  await loadMarkdown(page, 'Control body.');
  await expectAutosaved(page);
  await ensureCategory(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);
  const id = await page.locator('input[name="id"]').inputValue();
  const slug = await postSlug(page);

  // Warm all three surfaces by <Link>.
  await page.getByRole('link', { name: '記事一覧' }).click();
  await expect(page.getByRole('link', { name: before })).toBeVisible();
  await page.getByRole('link', { name: SITE_NAME }).click();
  await expect(page.getByRole('heading', { name: before })).toBeVisible();
  await page.getByRole('link', { name: before }).first().click();
  await expect(page).toHaveURL(new RegExp(`/posts/${slug}$`));
  await page.getByRole('button', { name: 'アカウントのメニュー' }).click();
  await page.getByRole('link', { name: '管理画面' }).click();
  await expect(page).toHaveURL(/\/admin$/);

  // Change the row with no Server Action involved.
  const db = new Database(TEST_DB_PATH);
  try {
    db.prepare('UPDATE posts SET title = ? WHERE id = ?').run(after, Number(id));
  } finally {
    db.close();
  }

  // No reload, hops by href: a locator named after the new title would fail on "stale". Assertions,
  // not a recording: a `staleTimes` or `loading.tsx` change that makes the cache retain routes turns
  // one red, and `revalidateBlog()` stops being inert.
  const stale = 'the client cache served a stale payload — revalidateBlog() is no longer inert';

  await page.locator('a[href="/"]').first().click();
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  await expect(page.getByRole('heading', { name: after }), `/ ${stale}`).toBeVisible();

  await page.locator(`a[href="/posts/${slug}"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`/posts/${slug}$`));
  await expect(page.getByRole('heading', { name: after }), `/posts ${stale}`).toBeVisible();

  await page.getByRole('button', { name: 'アカウントのメニュー' }).click();
  await page.getByRole('link', { name: '管理画面' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('link', { name: after }), `/admin ${stale}`).toBeVisible();

  // The write landed, so "fresh" above is a real observation.
  await page.goto('/admin');
  await expect(page.getByRole('link', { name: after })).toBeVisible();
});
