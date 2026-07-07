import { test, expect } from '@playwright/test';

// The full publish lifecycle over the isolated DB: create → autosave materializes
// the row (URL sync) → 投稿 → edit the live post (pending changes) → 更新.
// This is the path that adopts the action result during render (acceptSaved in
// the useAutosave hook), so a regression there surfaces as a React render-phase
// error or a stuck status line — both asserted here.
test('a new post autosaves, publishes, and takes further edits', async ({ page }) => {
  // Render-phase violations ("Cannot update a component…", "Maximum update
  // depth…") arrive as console errors in dev, not page errors — watch both.
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /Cannot update|Maximum update depth/.test(message.text())) {
      pageErrors.push(message.text());
    }
  });

  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await page.getByLabel('タイトル').fill('E2E publish flow');
  await editor.click();
  await page.keyboard.type('Publish me.');

  // The first autosave materializes the row: the indicator flips to 保存済み ✓
  // and the address bar syncs to the new row's edit URL without a navigation.
  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/\/admin\/posts\/\d+\/edit$/);
  await expect(page.getByText('未公開', { exact: true })).toBeVisible();

  // Publish. The editor adopts the action result in place: status flips to
  // 公開済み（最新）, the button relabels to 更新, and the 表示 link carries the
  // server-assigned opaque slug.
  await page.getByRole('button', { name: '投稿' }).click();
  await expect(page.getByText('公開済み（最新）')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: '更新' })).toBeVisible();
  await expect(page.getByRole('link', { name: '表示' })).toHaveAttribute(
    'href',
    /^\/posts\/[0-9a-f]+$/,
  );

  // Editing the live post flags it as ahead of the public version and dirty.
  await editor.click();
  await page.keyboard.type(' More.');
  await expect(page.getByText('未公開の変更あり')).toBeVisible();
  await expect(page.getByText(/未保存/)).toBeVisible();

  // 更新 while the edit is still unsaved: submitting cancels the queued autosave
  // and the publish result itself must settle the dirty state (acceptSaved) —
  // the indicator flips to 保存済み ✓ without an autosave round-trip.
  await page.getByRole('button', { name: '更新' }).click();
  await expect(page.getByText('公開済み（最新）')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });

  expect(pageErrors).toEqual([]);
});
