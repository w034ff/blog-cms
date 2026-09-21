import { test, expect } from '@playwright/test';
import {
  closePostSettings,
  expectAutosaved,
  expectDraft,
  expectPublished,
  openPostSettings,
} from './editor-authoring';

// 記事の設定 collapses the metadata fields behind a toggle on the editor's pinned bar. Two
// things have to hold for that to be safe, and neither is visible from the markup: the fields
// must still reach the server while the group is closed, and Enter in one must not publish.

// useAutosave snapshots the live form (`new FormData(form)`) and publish reads the same DOM, so
// a field that leaves the document leaves the payload. `hidden` only hides its children — this
// is the spec that would go red if it were ever rewritten as `{open && …}`, which looks
// equivalent and silently resets カテゴリ to its default and drops the thumbnail. カテゴリ is the
// witness because it is detectable: a dropped field comes back as `uncategorized`, not '開発'.
test('values set inside 記事の設定 survive a publish made while it is closed', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();

  await page.getByLabel('タイトル').fill('E2E settings disclosure');
  await openPostSettings(page);
  await page.getByLabel('カテゴリ').fill('開発');
  await page.getByLabel('タグ（カンマ区切り）').fill('tiptap, prosemirror');

  // The drawer is modal (PostSettingsPanel.tsx): its own backdrop catches a click into the body
  // and closes the drawer rather than letting it through, so the panel has to be closed explicitly
  // before typing — closing it here is also the state the assertions right below want to check.
  await closePostSettings(page);
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Collapsed publish.');

  await expect(page.getByLabel('カテゴリ')).toBeHidden();

  await expectAutosaved(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);

  // Round-trip through the server: reload the edit page and read the fields back. A payload
  // that dropped them would come back with the default category and no tags.
  await page.reload();
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await openPostSettings(page);
  await expect(page.getByLabel('カテゴリ')).toHaveValue('開発');
  await expect(page.getByLabel('タグ（カンマ区切り）')).toHaveValue('tiptap, prosemirror');
});

// The publish button sits on the same pinned bar as the metadata fields' own toggle, a keystroke
// away from them. Enter in one of them would otherwise activate it — the browser's implicit
// submission picks the form's first submit button, which is 投稿. The guard is bound to two
// wrappers now, not one: the panel left the block that used to carry it.
test('Enter in a metadata field does not publish', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();

  await page.getByLabel('タイトル').fill('E2E enter guard');
  await page.getByLabel('タイトル').press('Enter');
  await openPostSettings(page);
  await page.getByLabel('カテゴリ').press('Enter');

  // Still a draft: the button would have relabelled to 更新 had the form gone through.
  await expect(page.getByRole('button', { name: '投稿' })).toBeVisible();
  await expectDraft(page);
});
