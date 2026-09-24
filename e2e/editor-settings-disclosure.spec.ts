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

// 記事の設定 collapses the metadata fields behind a toggle on the editor's pinned bar. Two
// things have to hold for that to be safe, and neither is visible from the markup: the fields
// must still reach the server while the group is closed, and Enter in one must not publish.

// useAutosave snapshots the live form (`new FormData(form)`) and publish reads the same DOM, so
// a field that leaves the document leaves the payload. `hidden` only hides its children — this
// is the spec that would go red if it were ever rewritten as `{open && …}`, which looks
// equivalent and silently resets カテゴリ to not chosen and drops the thumbnail. カテゴリ is the
// witness because it is detectable: set to ブログ, a dropped field comes back unchosen and the
// publish is refused (§12.32).
test('values set inside 記事の設定 survive a publish made while it is closed', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();

  await page.getByLabel('タイトル').fill('E2E settings disclosure');
  await openPostSettings(page);
  const blog = page.getByRole('radio', { name: 'ブログ', exact: true });
  await blog.check();
  // Two tags the seeded dictionary has (drizzle/0010 admitted the ones already in use).
  await addTag(page, 'rea', 'react');
  await addTag(page, 'rsc');

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
  // Before the reload too: React 19 resets a form after its action runs, and a radio the reset
  // unchecked would send nothing on the next autosave, which the server files as not chosen —
  // the reload alone reads back what publish stored, not what the page now holds. By selector, not
  // by role: the drawer is closed, and `getByRole` does not see into a hidden subtree.
  await expect(page.locator('input[name="category"][value="blog"]')).toBeChecked();
  await expect(tagsField(page)).toHaveValue('react,rsc');

  // Round-trip through the server: reload the edit page and read the fields back. A payload
  // that dropped them would come back with no category and no tags.
  await page.reload();
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await openPostSettings(page);
  await expect(blog).toBeChecked();
  await expect(tagsField(page)).toHaveValue('react,rsc');
  await expect(page.getByRole('button', { name: '「react」を外す' })).toBeVisible();
});

// A new post starts with no category, and 投稿 is where it has to be chosen (§12.32). The refusal
// leaves the post a draft and opens 記事の設定 onto the field, with the message under it; choosing
// one lets the same post publish.
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
  // 記事の設定 opens by itself, with the message under カテゴリ and not in the header, where it
  // would sit dimmed behind the modal drawer, repeating it.
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
  // Choosing is an edit, which clears the refusal.
  await expect(page.locator('#post-settings-panel').getByRole('alert')).toHaveCount(0);
  await closePostSettings(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);
  await expect(page.locator('input[name="category"][value="blog"]')).toBeChecked();
});

// The publish button sits on the same pinned bar as the metadata fields' own toggle, a keystroke
// away from them. Enter in one of them would otherwise activate it — the browser's implicit
// submission picks the form's first submit button, which is 投稿. The guard is bound to two
// wrappers now, not one: the panel left the block that used to carry it. タグ's text box is the
// field pressed in the panel: a text field is what implicit submission starts from.
test('Enter in a metadata field does not publish', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();

  await page.getByLabel('タイトル').fill('E2E enter guard');
  await page.getByLabel('タイトル').press('Enter');
  await openPostSettings(page);
  await tagCombobox(page).press('Enter');
  // And on a カテゴリ button: it is a radio underneath, an input like the rest.
  await page.getByRole('radio', { name: 'ブログ', exact: true }).press('Enter');

  // Still a draft: the button would have relabelled to 更新 had the form gone through.
  await expect(page.getByRole('button', { name: '投稿' })).toBeVisible();
  await expectDraft(page);
});
