import { test, expect, type Page } from '@playwright/test';
import {
  closePostSettings,
  expectAutosaved,
  expectDraft,
  expectPublished,
  openPostSettings,
} from './editor-authoring';

// 記事の設定 collapses the metadata fields behind a toggle on the editor's pinned bar. Two
// things have to hold for that to be safe, and neither is visible from the markup: the fields
// must still reach the server while the group is closed, and 限定公開 must still be reported.

// useAutosave snapshots the live form (`new FormData(form)`) and publish reads the same DOM, so
// a field that leaves the document leaves the payload. `hidden` only hides its children — this
// is the spec that would go red if it were ever rewritten as `{open && …}`, which looks
// equivalent and silently clears 限定公開 and the thumbnail.
test('values set inside 記事の設定 survive a publish made while it is closed', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();

  await page.getByLabel('タイトル').fill('E2E settings disclosure');
  await openPostSettings(page);
  await page.getByLabel('カテゴリ').fill('開発');
  await page.getByLabel('タグ（カンマ区切り）').fill('tiptap, prosemirror');
  await page.getByText('限定公開にする').click();

  // The drawer is modal (PostSettingsPanel.tsx): its own backdrop catches a click into the body
  // and closes the drawer rather than letting it through, so the panel has to be closed explicitly
  // before typing — closing it here is also the state the assertions right below want to check.
  await closePostSettings(page);
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Collapsed publish.');

  // Closed, 限定公開 is the one thing the top line still reports — カテゴリ and タグ always hold
  // a value, so a chip for them marked nothing and was dropped.
  const bar = page.locator('form > div').first();
  await expect(page.getByLabel('カテゴリ')).toBeHidden();
  await expect(bar.getByText('限定公開', { exact: true })).toBeVisible();

  await expectAutosaved(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);

  // Round-trip through the server: reload the edit page and read the fields back. A payload
  // that dropped them would come back with an empty category and the post listed publicly.
  await page.reload();
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await openPostSettings(page);
  await expect(page.getByLabel('カテゴリ')).toHaveValue('開発');
  await expect(page.getByLabel('タグ（カンマ区切り）')).toHaveValue('tiptap, prosemirror');
  await expect(page.getByText('限定公開にする')).toBeVisible();
  await expect(page.locator('input[name="unlisted"]')).toBeChecked();
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

// React 19 resets the form once a server action settles, and a reset restores each control to its
// default — which for a controlled checkbox is false however it is rendered. 限定公開 came back
// unchecked after 更新 while the state behind it still said true, so `new FormData(form)` (what
// autosave and publish both read) reported no `unlisted` at all until the next render touched it.
// Ctrl/⌘+S in that window wrote the working copy back as public.
//
// Only a browser answers this: the DOM property and the React prop disagree, so it is invisible
// to anything that reads the markup. The form payload is asserted, not just the box, because the
// box is the symptom and the payload is the damage.
test('更新 does not clear 限定公開', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();

  await page.getByLabel('タイトル').fill('E2E unlisted survives 更新');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Body.');
  await expectAutosaved(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);

  // Turn it on after the post is already live — the order the reset shows up in.
  await openPostSettings(page);
  await page.getByText('限定公開にする').click();
  await expectAutosaved(page);

  // The drawer is modal: its backdrop covers 更新 too, so it has to close before that click lands.
  await closePostSettings(page);
  await page.getByRole('button', { name: '更新' }).click();
  await expectPublished(page);
  await expect(page.locator('input[name="unlisted"]')).toBeChecked();
  expect(await unlistedInPayload(page)).toBe('on');
});

// What a save would send right now, read from the live form the way useAutosave reads it.
async function unlistedInPayload(page: Page): Promise<FormDataEntryValue | null> {
  return page.evaluate(() => {
    const form = document.querySelector('form');
    return form ? new FormData(form).get('unlisted') : null;
  });
}
