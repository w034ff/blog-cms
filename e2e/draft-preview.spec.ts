import { test, expect } from '@playwright/test';
import { expectAutosaved, expectDraft, expectPublished, ensureCategory } from './editor-authoring';
import { STORAGE_STATE } from './constants';

// A draft is served at its `/posts/<slug>` only to an admin session: the session is the credential,
// unlike 限定公開. The refusal is the claim, and needs a context without the suite's saved session
// (e2e/auth.setup.ts).

// Publishes a post, takes it back to a draft, and returns its public address.
async function draftWithSlug(page: import('@playwright/test').Page, title: string) {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill(title);
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('本文です。');
  await expectAutosaved(page);

  // Published, then unpublished: where a stale public address could be in someone's hands.
  await ensureCategory(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);
  await page.getByRole('button', { name: '記事の設定' }).click();
  await page.getByRole('switch', { name: '公開' }).click();
  await expectDraft(page);

  await page.goto('/admin');
  const row = page.locator('li', { hasText: title });
  const href = await row.getByRole('link', { name: '表示' }).getAttribute('href');
  expect(href).toMatch(/^\/posts\/[0-9a-f]+$/);
  return href as string;
}

test('an author previewing a draft gets the post, marked as a preview', async ({ page }) => {
  const path = await draftWithSlug(page, `E2E draft preview ${Date.now()}`);

  await page.goto(path);
  // The post itself rendered — not a shell that merely failed to 404.
  await expect(page.locator('#post-body')).toContainText('本文です。');
  // And it says what it is. Without this the page is indistinguishable from the live post.
  await expect(page.getByRole('status')).toContainText('下書きのプレビュー');
  await expect(page.getByRole('link', { name: '編集に戻る' })).toBeVisible();
});

test('the 記事一覧 row links a draft to the same 表示 a published post gets', async ({ page }) => {
  const title = `E2E preview label ${Date.now()}`;
  const path = await draftWithSlug(page, title);
  const row = page.locator('li', { hasText: title });

  // One 表示 for both states; the 下書き badge distinguishes them, not the date (kept through an
  // unpublish).
  await expect(row.getByRole('link', { name: '表示' })).toHaveAttribute('href', path);
  await expect(row).toContainText('下書き');
});

test.describe('with no session', () => {
  // Without the saved session, or the assertions say nothing.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the same draft address 404s, and says nothing about the post', async ({
    page,
    browser,
  }) => {
    // The draft is created in a context that *does* have the session, then read from this one.
    const authed = await browser.newContext({ storageState: STORAGE_STATE });
    let path: string;
    try {
      path = await draftWithSlug(await authed.newPage(), `E2E draft refusal ${Date.now()}`);
    } finally {
      await authed.close();
    }

    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    // Nothing leaked: no body, no banner confirming a draft exists.
    await expect(page.locator('#post-body')).toHaveCount(0);
    await expect(page.getByText('下書きのプレビュー')).toHaveCount(0);
  });
});
