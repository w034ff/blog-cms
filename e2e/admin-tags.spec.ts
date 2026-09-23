import { test, expect, type Page } from '@playwright/test';
import {
  addTag,
  closePostSettings,
  expectAutosaved,
  expectPublished,
  openPostSettings,
  tagCombobox,
  tagsField,
} from './editor-authoring';

// /admin/tags (docs/editor-requirements.md §12.33): the wiring of its forms, and that a display
// name, a changed identifier, a merge and a delete each reach the post. The rules themselves —
// the three copies rewritten, `updatedAt` untouched — are lib/tags.test.ts. The tags here are made
// by the spec: the seeded ones are shared with every other spec running against the same DB.

// Opens a tag's row for editing and returns its two fields. One row is open at a time, so the
// labels are unambiguous — `exact`, since the add form's 新しいタグの識別子 contains 識別子.
async function edit(page: Page, slug: string) {
  await page.getByRole('button', { name: `「${slug}」を編集` }).click();
  return {
    slug: page.getByLabel('識別子', { exact: true }),
    name: page.getByLabel('表示名', { exact: true }),
  };
}

async function tagsOf(page: Page, editPath: string): Promise<string> {
  await page.goto(editPath);
  await expect(page.locator('.ProseMirror')).toBeVisible();
  return tagsField(page).inputValue();
}

test('a tag is added, given a display name, moved to another identifier, merged and deleted', async ({
  page,
}) => {
  const stamp = Date.now();
  // Identifiers are 18 characters at most; these are 14.
  const first = `a${stamp}`;
  const moved = `c${stamp}`;
  const other = `b${stamp}`;
  // A display name may carry what an identifier may not — spaces here, as `Next.js` would a dot.
  const shown = `E2E 管理 ${stamp}`;
  const editButton = (slug: string) => page.getByRole('button', { name: `「${slug}」を編集` });
  const add = async (slug: string) => {
    await page.getByLabel('新しいタグの識別子').fill(slug);
    await page.getByRole('button', { name: '追加', exact: true }).click();
    await expect(editButton(slug)).toBeVisible();
  };

  await page.goto('/admin/tags');
  await add(first);
  // Symbols are refused as they are typed, as in the editor.
  await page.getByLabel('新しいタグの識別子').fill('C#');
  await expect(page.getByRole('alert').filter({ hasText: '記号やスペース' })).toBeVisible();
  await expect(page.getByRole('button', { name: '追加', exact: true })).toBeDisabled();
  // The same identifier again is refused, not added twice.
  await page.getByLabel('新しいタグの識別子').fill(first.toUpperCase());
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '既にあります' })).toHaveText(
    `「${first}」は既にあります。`,
  );

  // A published post carrying it.
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill(`E2E admin tags ${stamp}`);
  await openPostSettings(page);
  await addTag(page, first);
  await closePostSettings(page);
  await expectAutosaved(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);
  const editPath = new URL(page.url()).pathname;

  // A display name: the row shows it beside the identifier, the tag page keeps its URL and takes
  // the name, and the editor's list shows it beside the identifier.
  await page.goto('/admin/tags');
  let fields = await edit(page, first);
  await fields.name.fill(shown);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(fields.name).toHaveCount(0);
  await expect(page.locator('li').filter({ has: editButton(first) })).toContainText(shown);
  await page.goto(`/tags/${first}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`#${shown}`);
  await page.goto('/admin/posts/new');
  await openPostSettings(page);
  await tagCombobox(page).fill(first);
  await expect(page.getByRole('option', { name: `${first} ${shown}` })).toBeVisible();

  // A new identifier: the note says what happens before it is sent, the post follows it, the
  // display name stays, and the old URL is gone.
  await page.goto('/admin/tags');
  fields = await edit(page, first);
  await fields.slug.fill(moved);
  await expect(page.getByText(`URL が /tags/${moved} に変わります。`)).toBeVisible();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editButton(moved)).toBeVisible();
  await expect(page.locator('li').filter({ has: editButton(moved) })).toContainText(shown);
  expect((await page.goto(`/tags/${first}`))?.status()).toBe(404);
  await page.goto(`/tags/${moved}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`#${shown}`);
  expect(await tagsOf(page, editPath)).toBe(moved);

  // An identifier that is already a tag: the note and the button both say merge, and the post
  // moves onto it.
  await page.goto('/admin/tags');
  await add(other);
  fields = await edit(page, moved);
  await fields.slug.fill(other);
  await expect(page.getByText(`${other} に統合され、このタグは削除されます。`)).toBeVisible();
  await page.getByRole('button', { name: '統合して保存' }).click();
  await expect(editButton(moved)).toHaveCount(0);
  expect(await tagsOf(page, editPath)).toBe(other);

  // Deleted: a tag in use asks once more, naming the count, and then leaves the post.
  await page.goto('/admin/tags');
  await edit(page, other);
  await page.getByRole('button', { name: '削除', exact: true }).click();
  await page.getByRole('button', { name: '1 件の記事から外して削除' }).click();
  await expect(editButton(other)).toHaveCount(0);
  expect((await page.goto(`/tags/${other}`))?.status()).toBe(404);
  expect(await tagsOf(page, editPath)).toBe('');
});
