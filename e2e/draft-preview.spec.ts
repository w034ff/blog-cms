import { test, expect } from '@playwright/test';
import { expectAutosaved, expectDraft, expectPublished, ensureCategory } from './editor-authoring';
import { STORAGE_STATE } from './constants';

// A draft is served at its own `/posts/<slug>` — the address every row gets at creation — but only
// to a request carrying an admin session. The session is the credential, not the URL, which is the
// whole difference from 限定公開, where knowing the address is enough.
//
// Both halves have to be measured here. The render is the easy one; the refusal is the claim, and
// it is only a claim in a context that has no session — the rest of the suite shares the saved
// admin storageState (e2e/auth.setup.ts), under which a 404 test would pass without proving
// anything.

// Publishes a post, takes it back to a draft, and returns its public address.
async function draftWithSlug(page: import('@playwright/test').Page, title: string) {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill(title);
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('本文です。');
  await expectAutosaved(page);

  // Published first, then unpublished: that is the state an author reaches by turning 公開 off, and it
  // is the one where a stale public address could still be in someone's hands.
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

  // One label for both states: the link can no longer land on a 404, so nothing has to be said
  // ahead of the click. What still separates the states is the 下書き badge — and not the date,
  // which is stamped at first publish and stays through an unpublish.
  await expect(row.getByRole('link', { name: '表示' })).toHaveAttribute('href', path);
  await expect(row).toContainText('下書き');
});

test.describe('with no session', () => {
  // The saved admin session is what every other spec runs under; dropping it is what makes the
  // assertions below say anything at all.
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
    // Nothing leaked on the way to the refusal: not the body, and not the banner that would
    // confirm a draft exists at this address.
    await expect(page.locator('#post-body')).toHaveCount(0);
    await expect(page.getByText('下書きのプレビュー')).toHaveCount(0);
  });
});
