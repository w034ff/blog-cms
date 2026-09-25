import { test, expect } from '@playwright/test';
import { expectAutosaved, expectPublished, loadMarkdown, ensureCategory } from './editor-authoring';
import { postSlug } from './published-post';
import Database from 'better-sqlite3';
import { TEST_DB_PATH } from './constants';

// What does `revalidateBlog()` actually invalidate?
//
// It is one line — `revalidatePath('/', 'layout')` in app/actions/posts.ts `revalidateBlog` — called from
// four sites (publish, create-and-publish, unpublish, delete), and nothing in the repo records
// what it buys. It cannot be the Data Cache: docs/cms-features.md:186 measured that
// `revalidatePath` reaches `fetch()`'s cache only, and every read on this site is a direct
// better-sqlite3 query. It cannot be the Full Route Cache either — all ten public routes are
// `force-dynamic`, so there is nothing stored to invalidate.
//
// The remaining candidate is the browser's Client Cache: an in-memory store of the RSC payload
// for "visited and prefetched routes", which `revalidatePath` is documented to invalidate
// (node_modules/next/dist/docs/01-app/04-glossary.md, "Client Cache"). If that is the mechanism,
// removing the call must make a just-published edit invisible on a surface the tab had already
// visited — until something forces a reload.
//
// So every hop below is a <Link> and there is exactly one `page.goto`, at the very start. A
// reload anywhere would clear the client cache and make the test vacuous.
//
// MUST run against a production server (`next build && next start`, reached with
// E2E_EXTERNAL_SERVER=1). Automatic prefetching "runs only in production"
// (node_modules/next/dist/docs/01-app/02-guides/prefetching.md), so `next dev` cannot answer it.
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

  await page.getByRole('link', { name: 'Tech Blog' }).click();
  await expect(page.getByRole('heading', { name: before })).toBeVisible();

  await page.getByRole('link', { name: before }).first().click();
  await expect(page).toHaveURL(new RegExp(`/posts/${slug}$`));
  await expect(page.getByText('Body before.')).toBeVisible();

  await page.getByRole('link', { name: '管理' }).click();
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

  await page.getByRole('link', { name: 'Tech Blog' }).click();
  await expect(page.getByRole('heading', { name: after }), '/ is stale').toBeVisible();

  await page.getByRole('link', { name: after }).first().click();
  await expect(page).toHaveURL(new RegExp(`/posts/${slug}$`));
  await expect(page.getByText('Body after.'), `/posts/${slug} is stale`).toBeVisible();
});

// The control for the test above, and the reason to trust either result.
//
// If the tab's Client Cache never held these pages, the test above passes whatever
// `revalidateBlog()` does — a green A/B would mean nothing. So this changes the post the same
// way, but BEHIND the server's back: a direct UPDATE on the harness's own SQLite copy, which runs
// no Server Action and therefore invalidates nothing anywhere.
//
// Then it walks the same <Link> path. What the three assertions see is what the client cache is
// actually doing on this site:
//   - stale titles  → the cache retains these routes, and `revalidatePath` has something to clear
//   - fresh titles  → it does not, and there is nothing for `revalidateBlog()` to invalidate
// Measured 2026-09-14 against a production build: fresh on all three. The reload at the end
// proves the write landed, so "fresh" cannot mean "nothing changed".
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
  await page.getByRole('link', { name: 'Tech Blog' }).click();
  await expect(page.getByRole('heading', { name: before })).toBeVisible();
  await page.getByRole('link', { name: before }).first().click();
  await expect(page).toHaveURL(new RegExp(`/posts/${slug}$`));
  await page.getByRole('link', { name: '管理' }).click();
  await expect(page).toHaveURL(/\/admin$/);

  // Change the row with no Server Action involved.
  const db = new Database(TEST_DB_PATH);
  try {
    db.prepare('UPDATE posts SET title = ? WHERE id = ?').run(after, Number(id));
  } finally {
    db.close();
  }

  // Same <Link> path, no reload, and every hop addressed by href rather than by title — a
  // locator named after the new title would itself fail when the answer is "stale".
  //
  // These are assertions, not a recording, because a red here is the signal that the question
  // this file answers has changed: if a future `staleTimes` config or a `loading.tsx` makes the
  // client cache start retaining these routes, one of them goes stale and `revalidateBlog()`
  // stops being inert.
  const stale = 'the client cache served a stale payload — revalidateBlog() is no longer inert';

  await page.locator('a[href="/"]').first().click();
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  await expect(page.getByRole('heading', { name: after }), `/ ${stale}`).toBeVisible();

  await page.locator(`a[href="/posts/${slug}"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`/posts/${slug}$`));
  await expect(page.getByRole('heading', { name: after }), `/posts ${stale}`).toBeVisible();

  await page.locator('a[href="/admin"]').first().click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('link', { name: after }), `/admin ${stale}`).toBeVisible();

  // The write landed — so a "fresh" reading above is a real observation, not a no-op update.
  await page.goto('/admin');
  await expect(page.getByRole('link', { name: after })).toBeVisible();
});
