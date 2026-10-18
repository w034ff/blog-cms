import { test, expect, type Page } from '@playwright/test';
import { ensureCategory, expectAutosaved, expectPublished } from './editor-authoring';
import { publishedPath } from './published-post';

// The home page and the category pages (docs/home-requirements.md). What only a browser answers:
// the tabs' wiring and position, the pin round trip through the admin list, and the 404 past the
// last page. Paging and the pin's selection are lib/post-list.test.ts; who may pin is
// app/actions/settings.test.ts.

async function publish(page: Page, title: string): Promise<string> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill(title);
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('ピックアップの説明文になる本文。');
  await expectAutosaved(page);
  await ensureCategory(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);
  return publishedPath(page);
}

const tabs = (page: Page) => page.getByRole('navigation', { name: 'カテゴリ' });

test('the tabs link to the category pages, mark the current one and stay put (HOME-1)', async ({
  page,
}) => {
  await page.goto('/');
  await expect(tabs(page).getByRole('link', { name: 'すべて' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const before = (await tabs(page).boundingBox())!;

  await tabs(page).getByRole('link', { name: '技術記事' }).click();
  await expect(page).toHaveURL(/\/categories\/tech$/);
  const current = tabs(page).getByRole('link', { name: '技術記事' });
  await expect(current).toHaveAttribute('aria-current', 'page');
  await expect(tabs(page).getByRole('link', { name: 'すべて' })).not.toHaveAttribute(
    'aria-current',
    'page',
  );
  // Above the pinned post, which only すべて shows, so switching does not move them (§2).
  expect((await tabs(page).boundingBox())!.y).toBeCloseTo(before.y, 0);
  // The tab names the page; the heading is for assistive tech only (§2).
  await expect(page.getByRole('heading', { level: 1, name: '技術記事' })).toHaveClass(/sr-only/);
});

test('a page past the last answers 404 (HOME-2)', async ({ page }) => {
  expect((await page.goto('/?page=9999'))?.status()).toBe(404);
  expect((await page.goto('/categories/tech?page=9999'))?.status()).toBe(404);
});

// One pin for the whole site, so this spec is the only one that sets it, and it takes it off again.
test('an admin pins a post from the list, the home page draws it once above the cards, and settings takes it off (HOME-3)', async ({
  page,
}) => {
  const title = `ピン留め ${Date.now()}`;
  const href = await publish(page, title);
  const row = page.locator(`li:has-text("${title}")`);

  try {
    await page.goto('/admin');
    await row.getByRole('button', { name: 'その他の操作' }).click();
    await row.getByRole('button', { name: 'トップに固定' }).click();
    await expect(row.getByText('ピックアップ', { exact: true })).toBeVisible();

    await page.goto('/');
    const pinned = page.locator('article', { hasText: 'ピックアップ' });
    await expect(pinned).toHaveCount(1);
    await expect(pinned.getByRole('link', { name: title })).toHaveAttribute('href', href);
    // Not again among the cards.
    await expect(page.locator(`article:has-text("${title}")`)).toHaveCount(1);
    await expect(pinned).toContainText('ピックアップの説明文になる本文');
    // Under the tabs, before the first card.
    expect((await pinned.boundingBox())!.y).toBeGreaterThan((await tabs(page).boundingBox())!.y);

    // Below `sm` the picture is left out (§3).
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(pinned.locator('.category-art, img')).toBeHidden();

    // A category page has no pinned slot.
    await page.goto('/categories/tech');
    await expect(page.locator('article', { hasText: 'ピックアップ' })).toHaveCount(0);

    // The settings screen shows the pin and takes it off (docs/site-settings-requirements.md §10).
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/admin/settings');
    const pickup = page.getByRole('region', { name: 'ピックアップ' });
    await expect(pickup.getByRole('link', { name: title })).toBeVisible();
    await pickup.getByRole('button', { name: '固定を外す' }).click();
    await expect(pickup.getByText('なし', { exact: true })).toBeVisible();
    await expect(pickup.getByRole('link', { name: title })).toHaveCount(0);
  } finally {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/admin');
    const menu = row.getByRole('button', { name: 'その他の操作' });
    if ((await row.getByText('ピックアップ', { exact: true }).count()) > 0) {
      await menu.click();
      await row.getByRole('button', { name: '固定を外す' }).click();
      await expect(row.getByText('ピックアップ', { exact: true })).toHaveCount(0);
    }
  }

  await page.goto('/');
  await expect(page.locator('article', { hasText: 'ピックアップ' })).toHaveCount(0);
});
