import { test, expect } from '@playwright/test';
import {
  addTag,
  closePostSettings,
  expectAutosaved,
  expectDraft,
  expectPublished,
  openPostSettings,
  tagCombobox,
  tagsField,
} from './editor-authoring';

// 記事の設定 hides the metadata fields behind a toggle. Safe only if the fields still reach the server
// while closed, and Enter in one does not publish.

// Autosave and publish read `new FormData(form)`, so a field leaving the DOM leaves the payload.
// `hidden` keeps it; `{open && …}` would look equivalent and drop カテゴリ and the thumbnail.
// カテゴリ is the witness: dropped, it comes back unchosen and publish is refused (§12.32).
test('values set inside 記事の設定 survive a publish made while it is closed', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();

  await page.getByLabel('タイトル').fill('E2E settings disclosure');
  await openPostSettings(page);
  const blog = page.getByRole('radio', { name: 'ブログ', exact: true });
  await blog.check();
  // Two seeded dictionary tags (drizzle/0010).
  await addTag(page, 'rea', 'react');
  await addTag(page, 'rsc');

  // The modal drawer blocks the body, so close it before typing; also the state checked below.
  await closePostSettings(page);
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Collapsed publish.');

  await expect(page.getByLabel('カテゴリ')).toBeHidden();

  await expectAutosaved(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);
  // Before the reload too: React 19 resets the form after its action, and an unchecked radio would
  // send nothing on the next autosave. By selector: `getByRole` does not see the hidden drawer.
  await expect(page.locator('input[name="category"][value="blog"]')).toBeChecked();
  await expect(tagsField(page)).toHaveValue('react,rsc');

  // Through the server: a dropped payload returns no category or tags.
  await page.reload();
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await openPostSettings(page);
  await expect(blog).toBeChecked();
  await expect(tagsField(page)).toHaveValue('react,rsc');
  await expect(page.getByRole('button', { name: '「react」を外す' })).toBeVisible();
});

// A new post has no category, and 投稿 asks for it (§12.32): the refusal opens 記事の設定 with the
// message under the field; choosing one lets it publish.
test('a new post has no category until one is chosen, and 投稿 asks for it', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill('E2E category required');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('本文。');
  await expectAutosaved(page);
  await expect(page.locator('input[name="category"]:checked')).toHaveCount(0);

  await page.getByRole('button', { name: '投稿' }).click();
  await expectDraft(page);
  // It opens itself, the message under カテゴリ, not in the dimmed header.
  await expect(page.getByRole('button', { name: '記事の設定' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(page.locator('#post-settings-panel').getByRole('alert')).toHaveText(
    'カテゴリを選んでください。',
  );
  await expect(page.getByText('カテゴリを選んでください。')).toHaveCount(1);
  await expect(page.getByRole('radio', { name: '技術記事', exact: true })).not.toBeChecked();
  await page.getByRole('radio', { name: 'ブログ', exact: true }).check();
  // Choosing is an edit, clearing the refusal.
  await expect(page.locator('#post-settings-panel').getByRole('alert')).toHaveCount(0);
  await closePostSettings(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);
  await expect(page.locator('input[name="category"][value="blog"]')).toBeChecked();
});

// Enter in a field would implicitly submit via the form's first submit button, 投稿. The guard is on
// two wrappers now, the panel having left the first. タグ's text box: implicit submission starts
// from a text field.
test('Enter in a metadata field does not publish', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();

  await page.getByLabel('タイトル').fill('E2E enter guard');
  await page.getByLabel('タイトル').press('Enter');
  await openPostSettings(page);
  await tagCombobox(page).press('Enter');
  // And a カテゴリ button, a radio underneath.
  await page.getByRole('radio', { name: 'ブログ', exact: true }).press('Enter');

  // Still a draft: a submit would have relabelled it 更新.
  await expect(page.getByRole('button', { name: '投稿' })).toBeVisible();
  await expectDraft(page);
});
