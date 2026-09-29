import { test, expect, type Page } from '@playwright/test';
import {
  addTag,
  closePostSettings,
  expectAutosaved,
  expectPublished,
  openPostSettings,
  tagCombobox,
  tagsField,
  ensureCategory,
} from './editor-authoring';

// /admin/tags (docs/editor-requirements.md §12.33): the forms' wiring, and that a display name, a
// changed identifier, a merge and a delete each reach the post (the rules: lib/tags.test.ts). Tags
// are made here, since the seeded ones are shared with every spec.

// Opens a row (one at a time, so labels are unambiguous; `exact`, since 新しいタグの識別子 contains
// 識別子) and returns its two fields.
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
    await page.getByLabel('タグを検索・追加').fill(slug);
    await page.getByRole('button', { name: '追加', exact: true }).click();
    await expect(editButton(slug)).toBeVisible();
  };

  await page.goto('/admin/tags');
  await add(first);
  // Symbols are refused as typed, said only when nothing matched. No real tag contains `qz`.
  await page.getByLabel('タグを検索・追加').fill('qz#');
  await expect(page.getByRole('alert').filter({ hasText: '記号やスペース' })).toBeVisible();
  await expect(page.getByRole('button', { name: '追加', exact: true })).toBeDisabled();
  // A tag that already is the word shows as the search result, and 追加 stays shut.
  await page.getByLabel('タグを検索・追加').fill(first.toUpperCase());
  await expect(editButton(first)).toBeVisible();
  await expect(page.getByRole('button', { name: '追加', exact: true })).toBeDisabled();

  // A published post carrying it.
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill(`E2E admin tags ${stamp}`);
  await openPostSettings(page);
  await addTag(page, first);
  await closePostSettings(page);
  await expectAutosaved(page);
  await ensureCategory(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);
  const editPath = new URL(page.url()).pathname;

  // A display name shows beside the identifier in the row, on the tag page (same URL) and in the
  // editor.
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

  // A new identifier: the note warns first, the post follows, the name stays, and the old one becomes a
  // redirecting alias.
  await page.goto('/admin/tags');
  fields = await edit(page, first);
  await fields.slug.fill(moved);
  await expect(page.getByText(`URL が /tags/${moved} に変わります。`)).toBeVisible();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editButton(moved)).toBeVisible();
  await expect(page.locator('li').filter({ has: editButton(moved) })).toContainText(shown);
  await expect(page.locator('li').filter({ has: editButton(moved) })).toContainText(
    `別名 ${first}`,
  );
  await page.goto(`/tags/${first}`);
  await expect(page).toHaveURL(new RegExp(`/tags/${moved}$`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`#${shown}`);
  expect(await tagsOf(page, editPath)).toBe(moved);

  // An identifier that is already a tag: the note and the button both say merge, and the post
  // moves onto it.
  await page.goto('/admin/tags');
  await add(other);
  // The text stays after an add, leaving the table narrowed to the new tag; clear it to reach others.
  await page.getByLabel('タグを検索・追加').fill('');
  fields = await edit(page, moved);
  await fields.slug.fill(other);
  await expect(page.getByText(`${other} に統合され、このタグは削除されます。`)).toBeVisible();
  await page.getByRole('button', { name: '統合して保存' }).click();
  await expect(editButton(moved)).toHaveCount(0);
  expect(await tagsOf(page, editPath)).toBe(other);
  // Both old identifiers lead to the merged tag, in the editor (its own row, no second offer) and by
  // URL. A new post, since the one above already carries it.
  await page.goto('/admin/posts/new');
  await openPostSettings(page);
  await tagCombobox(page).fill(first);
  await expect(page.getByRole('option', { name: other, exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: /を新しいタグとして追加$/ })).toHaveCount(0);
  await page.goto(`/tags/${moved}`);
  await expect(page).toHaveURL(new RegExp(`/tags/${other}$`));

  // An alias added by hand, and taken off again.
  const extra = `x${stamp}`;
  await page.goto('/admin/tags');
  await edit(page, other);
  await page.getByLabel('別名', { exact: true }).fill(extra);
  await page.getByRole('button', { name: '追加', exact: true }).last().click();
  await expect(page.getByRole('button', { name: `別名「${extra}」を外す` })).toBeVisible();
  await page.goto(`/tags/${extra}`);
  await expect(page).toHaveURL(new RegExp(`/tags/${other}$`));
  await page.goto('/admin/tags');
  await edit(page, other);
  await page.getByRole('button', { name: `別名「${extra}」を外す` }).click();
  await expect(page.getByRole('button', { name: `別名「${extra}」を外す` })).toHaveCount(0);
  expect((await page.goto(`/tags/${extra}`))?.status()).toBe(404);

  // Deleted: a tag in use asks once more, naming the count, and then leaves the post.
  await page.goto('/admin/tags');
  await edit(page, other);
  await page.getByRole('button', { name: '削除', exact: true }).click();
  await page.getByRole('button', { name: '1 件の記事から外して削除' }).click();
  await expect(editButton(other)).toHaveCount(0);
  // Its aliases go with it: none of the three words leads anywhere now.
  for (const word of [other, moved, first]) {
    expect((await page.goto(`/tags/${word}`))?.status()).toBe(404);
  }
  expect(await tagsOf(page, editPath)).toBe('');
});

test('the field narrows the table by identifier, display name or alias, and 記事 sorts by count', async ({
  page,
}) => {
  await page.goto('/admin/tags');
  const search = page.getByLabel('タグを検索・追加');
  const editOf = (slug: string) => page.getByRole('button', { name: `「${slug}」を編集` });

  // An alias finds its tag, and the rest of the table goes.
  await search.fill('golang');
  await expect(editOf('go')).toBeVisible();
  await expect(editOf('python')).toHaveCount(0);
  // A display name with a symbol finds it too: `C#` is `csharp`'s.
  await search.fill('C#');
  await expect(editOf('csharp')).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: '記号やスペース' })).toHaveCount(0);
  await search.fill('');
  await expect(editOf('python')).toBeVisible();

  // An inactive heading shows ↕, so it reads as a control; the active 識別子, which has one
  // direction, shows none. The arrow stays out of the name.
  const bySlug = page.getByRole('button', { name: '識別子', exact: true });
  await expect(bySlug).toHaveText('識別子');
  await expect(page.getByRole('button', { name: '記事', exact: true })).toHaveText('記事 ↕');

  // By count: most-used first, then pressed again, least-used first.
  const counts = async () =>
    (await page.locator('ul > li > div > span.tabular-nums').allInnerTexts()).map(Number);
  await page.getByRole('button', { name: '記事', exact: true }).click();
  await expect(bySlug).toHaveText('識別子 ↕');
  await expect(page.getByRole('button', { name: '記事（多い順）' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const descending = await counts();
  expect(descending.length).toBeGreaterThan(1);
  expect(descending).toEqual([...descending].sort((a, b) => b - a));
  await page.getByRole('button', { name: '記事（多い順）' }).click();
  await expect(page.getByRole('button', { name: '記事（少ない順）' })).toBeVisible();
  const ascending = await counts();
  expect(ascending).toEqual([...ascending].sort((a, b) => a - b));
});
