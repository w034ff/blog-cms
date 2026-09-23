import { test, expect, type Page } from '@playwright/test';
import {
  addTag,
  closePostSettings,
  expectAutosaved,
  openPostSettings,
  tagCombobox,
  tagsField,
} from './editor-authoring';

// 記事の設定's タグ field (components/editor/TagField.tsx, docs/editor-requirements.md §12.33): tags
// are picked from the dictionary, and a name it lacks is added only through its own row. The
// seeded dictionary is the tags already in use when it was created (drizzle/0010): blog, mdx,
// nextjs, react, rsc. What only a browser answers is here — the keys, the list, the chips and the
// round trip through the form; the dictionary's own rules are lib/tags.test.ts.

// Options are matched on their identifier alone: one whose display name differs carries it after
// the identifier, and the seeded DB is the real one, whose names can be changed at any time.
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
  // Part of the name finds it, and the typed text is still offered as a tag of its own, last — even
  // when it is the start of a tag, or `go` beside `golang` could not be made here.
  await tagCombobox(page).fill('rea');
  await expect(listbox(page).getByRole('option', { name: /^react\b/ })).toBeVisible();
  await expect(createRow(page)).toHaveText('「rea」を新しいタグとして追加');
  await expect(listbox(page).getByRole('option').last()).toHaveText(
    '「rea」を新しいタグとして追加',
  );
  // The whole name in another case is the tag itself, so the row offering to add it is gone.
  await tagCombobox(page).fill('REACT');
  await expect(listbox(page).getByRole('option', { name: /^react\b/ })).toBeVisible();
  await expect(createRow(page)).toHaveCount(0);
  await tagCombobox(page).press('Enter');
  await expect(tagsField(page)).toHaveValue('react');

  // Chosen once, it leaves the list — and with nothing else matching, the list does not open.
  await tagCombobox(page).fill('react');
  await expect(listbox(page)).toBeHidden();
  await expect(tagCombobox(page)).toHaveAttribute('aria-expanded', 'false');
});

test('a name the dictionary lacks is added only through its own row, and stays added', async ({
  page,
}) => {
  await newPostWithSettings(page, `E2E tag create ${Date.now()}`);
  // Typed with capitals: the identifier, and so the chip, is lowercase. 14 characters of 18.
  const name = `N${Date.now()}`;
  await tagCombobox(page).fill(name);
  await expect(createRow(page)).toHaveText(`「${name}」を新しいタグとして追加`);
  await createRow(page).click();
  const slug = name.toLowerCase();
  await expect(page.getByRole('button', { name: `「${slug}」を外す` })).toBeVisible();
  await expect(tagsField(page)).toHaveValue(slug);
  await expectAutosaved(page);

  // Saved, and named by the dictionary rather than by what the field happened to hold.
  await page.reload();
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await openPostSettings(page);
  await expect(page.getByRole('button', { name: `「${slug}」を外す` })).toBeVisible();
  // Now a dictionary tag like any other: typing it offers it, not a second one.
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

  // With nothing to offer, the refusal alone: no row, and Enter adds nothing. Not `C#` — its key
  // `c` finds `rsc`, which is offered like any other match.
  await tagCombobox(page).fill('q++');
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
  // A chip leaving is not an `input` event. Waiting for the save it should cause, not for the
  // 保存済み state — that is still showing from the save above, and would pass with nothing sent.
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
  // Nothing says so until a sixth is attempted.
  await expect(limit).toHaveCount(0);
  // The fifth was added from the box, and focus stays there.
  await expect(tagCombobox(page)).toBeFocused();

  // `n` would otherwise offer 「n」を新しいタグとして追加 — the list stays shut instead.
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
  // Pressing × took focus out of the box, which shuts the list; typing again opens it — `md`, for
  // the tag just taken back. Something other than the `n` already there: filling the same value
  // changes nothing, so React reports no change and nothing opens.
  await tagCombobox(page).fill('md');
  await expect(listbox(page)).toBeVisible();
});

test('an Enter that confirms an IME composition chooses nothing', async ({ page }) => {
  await newPostWithSettings(page, `E2E tag ime ${Date.now()}`);
  await tagCombobox(page).focus();
  // Synthesized over CDP: `keyboard.type` never composes, so a spec written with it would pass
  // against a field that ignores `isComposing` (the keydown below arrives with it true — probed
  // 2026-09-23). The composed text matches a dictionary tag on purpose: choosing an existing row
  // is synchronous, so a wrongly taken Enter shows at once. A text that only matched the add row
  // would pass either way, the assertions below landing before the add's fetch did (measured).
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

  // The Enter after the composition is a choice again.
  await tagCombobox(page).press('Enter');
  await expect(tagsField(page)).toHaveValue('rsc');
});
