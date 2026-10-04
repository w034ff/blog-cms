import { test, expect, type Page } from '@playwright/test';
import {
  addTag,
  closePostSettings,
  expectAutosaved,
  openPostSettings,
  tagCombobox,
  tagsField,
} from './editor-authoring';

// 記事の設定's タグ field (TagField.tsx, docs/editor-requirements.md §12.33): tags come from the
// dictionary (seeded by drizzle/0010: blog, mdx, nextjs, react, rsc), and new names only through
// their own row. Keys, list, chips and the form round trip here; the rules in lib/tags.test.ts.

// Matched on the identifier: display names in the real seeded DB can change.
const listbox = (page: Page) => page.getByRole('listbox', { name: 'タグ' });
const createRow = (page: Page) =>
  listbox(page).getByRole('option', { name: /を新しいタグとして追加$/ });

async function newPostWithSettings(page: Page, title: string): Promise<void> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill(title);
  await expectAutosaved(page);
  await openPostSettings(page);
}

test('a dictionary tag is found by part of its name, whatever the case, and is not offered twice', async ({
  page,
}) => {
  await newPostWithSettings(page, `E2E tag pick ${Date.now()}`);
  // A partial match finds it, and the typed text is still offered last, or `go` beside `golang`
  // could not be made.
  await tagCombobox(page).fill('rea');
  await expect(listbox(page).getByRole('option', { name: /^react\b/ })).toBeVisible();
  await expect(createRow(page)).toHaveText('「rea」を新しいタグとして追加');
  await expect(listbox(page).getByRole('option').last()).toHaveText(
    '「rea」を新しいタグとして追加',
  );
  // The whole name in another case is the tag, so no add row.
  await tagCombobox(page).fill('REACT');
  await expect(listbox(page).getByRole('option', { name: /^react\b/ })).toBeVisible();
  await expect(createRow(page)).toHaveCount(0);
  await tagCombobox(page).press('Enter');
  await expect(tagsField(page)).toHaveValue('react');

  // Chosen, it leaves the list; other matches may remain (`rsc` is React Server Components).
  await tagCombobox(page).fill('react');
  await expect(listbox(page).getByRole('option', { name: /^react\b/ })).toHaveCount(0);
  await expect(createRow(page)).toHaveCount(0);
});

test('a name the dictionary lacks is added only through its own row, and stays added', async ({
  page,
}) => {
  await newPostWithSettings(page, `E2E tag create ${Date.now()}`);
  // Capitals typed, a lowercase identifier; 14 of 18 characters.
  const name = `N${Date.now()}`;
  await tagCombobox(page).fill(name);
  await expect(createRow(page)).toHaveText(`「${name}」を新しいタグとして追加`);
  await createRow(page).click();
  const slug = name.toLowerCase();
  await expect(page.getByRole('button', { name: `「${slug}」を外す` })).toBeVisible();
  await expect(tagsField(page)).toHaveValue(slug);
  await expectAutosaved(page);

  // Saved, named by the dictionary.
  await page.reload();
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await openPostSettings(page);
  await expect(page.getByRole('button', { name: `「${slug}」を外す` })).toBeVisible();
  // Now a dictionary tag: offered, not added again.
  await closePostSettings(page);
  await page.goto('/admin/posts/new');
  await openPostSettings(page);
  await tagCombobox(page).fill(name.toUpperCase());
  await expect(listbox(page).getByRole('option', { name: slug, exact: true })).toBeVisible();
  await expect(createRow(page)).toHaveCount(0);
});

test('a name with a symbol is refused as it is typed, and the tag it was reaching for is offered', async ({
  page,
}) => {
  await newPostWithSettings(page, `E2E tag symbols ${Date.now()}`);
  const refusal = page.getByRole('alert').filter({ hasText: '記号やスペース' });
  await tagCombobox(page).fill('Next.js');
  await expect(refusal).toHaveText('タグに記号やスペースは使えません。');
  await expect(listbox(page).getByRole('option', { name: /^nextjs\b/ })).toBeVisible();
  await expect(createRow(page)).toHaveCount(0);
  await tagCombobox(page).press('Enter');
  await expect(tagsField(page)).toHaveValue('nextjs');
  await expect(refusal).toHaveCount(0);

  // Nothing to offer: the refusal, and Enter adds nothing. Text no real tag contains (`C#`'s `c` finds
  // `rsc`, `q` finds `sql`).
  await tagCombobox(page).fill('qz#');
  await expect(refusal).toBeVisible();
  await expect(listbox(page)).toBeHidden();
  await tagCombobox(page).press('Enter');
  await expect(tagsField(page)).toHaveValue('nextjs');
});

test('Escape closes the list and keeps the drawer; the next Escape closes the drawer', async ({
  page,
}) => {
  await newPostWithSettings(page, `E2E tag escape ${Date.now()}`);
  const drawer = page.getByRole('dialog', { name: '記事の設定' });
  await tagCombobox(page).fill('n');
  await expect(listbox(page)).toBeVisible();
  await tagCombobox(page).press('Escape');
  await expect(listbox(page)).toBeHidden();
  await expect(drawer).toBeVisible();
  await tagCombobox(page).press('Escape');
  await expect(drawer).toBeHidden();
});

test('Backspace in the empty box and a chip’s × both remove a tag, and the save carries it', async ({
  page,
}) => {
  await newPostWithSettings(page, `E2E tag remove ${Date.now()}`);
  await addTag(page, 'react');
  await addTag(page, 'rsc');
  await expectAutosaved(page);

  await tagCombobox(page).press('Backspace');
  await expect(tagsField(page)).toHaveValue('react');
  // Removing a chip is no `input` event: wait for the save itself, since 保存済み still shows.
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/drafts') &&
      (response.request().postData() ?? '').includes('"tags":[]'),
  );
  await page.getByRole('button', { name: '「react」を外す' }).click();
  await expect(tagsField(page)).toHaveValue('');
  await saved;

  await page.reload();
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await expect(tagsField(page)).toHaveValue('');
});

test('a sixth tag is refused as it is typed, and the refusal goes when the text or a chip does', async ({
  page,
}) => {
  await newPostWithSettings(page, `E2E tag limit ${Date.now()}`);
  await expect(tagCombobox(page)).toHaveAttribute('placeholder', 'タグを 5 つまで入力');
  for (const tag of ['blog', 'mdx', 'nextjs', 'react', 'rsc']) await addTag(page, tag);
  const limit = page.getByRole('alert').filter({ hasText: 'タグは 5 つまで設定できます。' });
  // Silent until a sixth is attempted.
  await expect(limit).toHaveCount(0);
  // Focus stays in the box.
  await expect(tagCombobox(page)).toBeFocused();

  // The list stays shut rather than offering to add 「n」.
  await tagCombobox(page).fill('n');
  await expect(limit).toBeVisible();
  await expect(listbox(page)).toBeHidden();
  await tagCombobox(page).press('Enter');
  await expect(tagsField(page)).toHaveValue('blog,mdx,nextjs,react,rsc');

  await tagCombobox(page).fill('');
  await expect(limit).toHaveCount(0);
  await tagCombobox(page).fill('n');
  await expect(limit).toBeVisible();
  await page.getByRole('button', { name: '「mdx」を外す' }).click();
  await expect(limit).toHaveCount(0);
  // × took focus away and shut the list; typing reopens it. Not `n` again: the same value is no change.
  await tagCombobox(page).fill('md');
  await expect(listbox(page)).toBeVisible();
});

test('an Enter that confirms an IME composition chooses nothing', async ({ page }) => {
  await newPostWithSettings(page, `E2E tag ime ${Date.now()}`);
  await tagCombobox(page).focus();
  // Composed over CDP: `keyboard.type` never composes, so a field ignoring `isComposing` would pass.
  // The text matches an existing tag, whose choice is synchronous, so a wrong Enter shows at once.
  const client = await page.context().newCDPSession(page);
  await client.send('Input.imeSetComposition', { text: 'rs', selectionStart: 2, selectionEnd: 2 });
  await expect(listbox(page).getByRole('option', { name: /^rsc\b/ })).toBeVisible();
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
  });
  await client.send('Input.insertText', { text: 'rs' });
  await expect(tagCombobox(page)).toHaveValue('rs');
  await expect(tagsField(page)).toHaveValue('');

  // After composing, Enter chooses again.
  await tagCombobox(page).press('Enter');
  await expect(tagsField(page)).toHaveValue('rsc');
});
