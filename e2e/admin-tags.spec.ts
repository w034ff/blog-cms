import { test, expect } from '@playwright/test';
import {
  addTag,
  closePostSettings,
  expectAutosaved,
  expectPublished,
  openPostSettings,
  tagsField,
} from './editor-authoring';

// /admin/tags (docs/editor-requirements.md §12.33): the wiring of its three forms, and that a
// rename and a delete reach the posts. The rules themselves — slug kept on rename, all three
// copies rewritten on delete — are lib/tags.test.ts. The tags here are made by the spec: the
// seeded ones are shared with every other spec running against the same DB.
test('a tag is added, renamed where readers see it, and deleted from the post carrying it', async ({
  page,
}) => {
  const stamp = Date.now();
  // With a dot, as `Next.js` would slug to: the tag page is reached at `/tags/e2e.admin-…`.
  const name = `e2e.admin-${stamp}`;
  const renamed = `E2E 管理 ${stamp}`;

  await page.goto('/admin/tags');
  await page.getByLabel('新しいタグの名前').fill(name);
  await page.getByRole('button', { name: '追加', exact: true }).click();
  const field = page.getByLabel(`「${name}」の名前`);
  await expect(field).toBeVisible();
  // The same name again is refused, not added twice.
  await page.getByLabel('新しいタグの名前').fill(name.toUpperCase());
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '既にあります' })).toHaveText(
    `「${name}」は既にあります。`,
  );

  // A published post carrying it.
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill(`E2E admin tags ${stamp}`);
  await openPostSettings(page);
  await addTag(page, name);
  await closePostSettings(page);
  await expectAutosaved(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);
  const editPath = new URL(page.url()).pathname;

  // Renamed: the public tag page keeps its URL and takes the new name.
  await page.goto('/admin/tags');
  await field.fill(renamed);
  await page.locator('li').filter({ has: field }).getByRole('button', { name: '保存' }).click();
  await expect(page.getByLabel(`「${renamed}」の名前`)).toBeVisible();
  await page.goto(`/tags/${encodeURIComponent(name)}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`#${renamed}`);

  // Deleted: a tag in use asks once more, naming the count, and then leaves the post.
  await page.goto('/admin/tags');
  const row = page.locator('li').filter({ has: page.getByLabel(`「${renamed}」の名前`) });
  await row.getByRole('button', { name: '削除', exact: true }).click();
  await row.getByRole('button', { name: '1 件の記事から外して削除' }).click();
  await expect(page.getByLabel(`「${renamed}」の名前`)).toHaveCount(0);
  const tagPage = await page.goto(`/tags/${encodeURIComponent(name)}`);
  expect(tagPage?.status()).toBe(404);
  await page.goto(editPath);
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await expect(tagsField(page)).toHaveValue('');
});
