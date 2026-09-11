import { test, expect } from '@playwright/test';
import { openPostSettings } from './editor-authoring';

// 記事の設定 collapses the metadata fields behind a <details>. Two things have to hold for
// that to be safe, and neither is visible from the markup: the fields must still reach the
// server while the group is closed, and the summary must report what they hold.

// useAutosave snapshots the live form (`new FormData(form)`) and publish reads the same DOM,
// so a field that leaves the document leaves the payload. A <details> only hides its
// children — this is the spec that would go red if it were ever rewritten as `{open && …}`,
// which looks equivalent and silently clears 限定公開 and the thumbnail.
test('values set inside 記事の設定 survive a publish made while it is closed', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();

  await page.getByLabel('タイトル').fill('E2E settings disclosure');
  await openPostSettings(page);
  await page.getByLabel('カテゴリ').fill('開発');
  await page.getByLabel('タグ（カンマ区切り）').fill('tiptap, prosemirror');
  await page.getByText('限定公開にする').click();
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Collapsed publish.');

  // Closed, the summary is the only report of what is set.
  const settings = page.locator('details');
  await settings.getByText('記事の設定').click();
  await expect(page.getByLabel('カテゴリ')).toBeHidden();
  await expect(settings.getByText('開発')).toBeVisible();
  await expect(settings.getByText('タグ 2')).toBeVisible();
  await expect(settings.getByText('限定公開', { exact: true })).toBeVisible();

  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '投稿' }).click();
  await expect(page.getByText('公開済み（最新）')).toBeVisible({ timeout: 20_000 });

  // Round-trip through the server: reload the edit page and read the fields back. A payload
  // that dropped them would come back with an empty category and the post listed publicly.
  await page.reload();
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await settings.getByText('記事の設定').click();
  await expect(page.getByLabel('カテゴリ')).toHaveValue('開発');
  await expect(page.getByLabel('タグ（カンマ区切り）')).toHaveValue('tiptap, prosemirror');
  await expect(page.getByText('限定公開にする')).toBeVisible();
  await expect(page.locator('input[name="unlisted"]')).toBeChecked();
});

// The publish button now sits in the pinned header, a keystroke away from the metadata
// fields. Enter in one of them would otherwise activate it — the browser's implicit
// submission picks the form's first submit button, which is 投稿.
test('Enter in a metadata field does not publish', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();

  await page.getByLabel('タイトル').fill('E2E enter guard');
  await page.getByLabel('タイトル').press('Enter');
  await openPostSettings(page);
  await page.getByLabel('カテゴリ').press('Enter');

  // Still a draft: the button would have relabelled to 更新 had the form gone through.
  await expect(page.getByRole('button', { name: '投稿' })).toBeVisible();
  await expect(page.getByText('未公開', { exact: true })).toBeVisible();
});
