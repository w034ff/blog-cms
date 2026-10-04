import { test, expect } from '@playwright/test';
import { expectAutosaved } from './editor-authoring';

// The wiring of 記事一覧's tabs, category, sort and search (app/admin/(list)/ListControls.tsx): each
// reaches the URL and the list follows it. Which post belongs to which tab, and the orders, are the
// vitest's (lib/admin-post-list.test.ts).
test('the tabs, the search and the category menu narrow the list through the URL', async ({
  page,
}) => {
  const title = `E2E list controls ${Date.now()}`;
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill(title);
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('本文です。');
  await expectAutosaved(page);

  const row = page.getByRole('link', { name: title, exact: true });
  const tabs = page.getByRole('navigation', { name: '状態' });

  // A draft with no category: in 作業中, not in 公開中.
  await page.goto('/admin');
  await tabs.getByRole('link', { name: /作業中/ }).click();
  await expect(page).toHaveURL(/\/admin\?status=working$/);
  await expect(row).toBeVisible();
  await tabs.getByRole('link', { name: /公開中/ }).click();
  await expect(page).toHaveURL(/\/admin\?status=published$/);
  await expect(row).toHaveCount(0);

  // The search keeps the tab it was typed under.
  await tabs.getByRole('link', { name: /すべて/ }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole('searchbox', { name: 'タイトルで検索' }).fill(title);
  await page.getByRole('searchbox', { name: 'タイトルで検索' }).press('Enter');
  await expect(page).toHaveURL(/[?&]q=/);
  await expect(page.locator('main section li')).toHaveCount(1);
  await expect(row).toBeVisible();

  // A category the draft lacks leaves nothing, and says so.
  await page.getByRole('button', { name: /カテゴリ/ }).click();
  await page.getByRole('link', { name: '技術記事', exact: true }).click();
  await expect(page).toHaveURL(/category=tech/);
  await expect(page.getByText('条件に合う記事はありません。')).toBeVisible();
});
