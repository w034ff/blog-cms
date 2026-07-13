import { test, expect } from '@playwright/test';

// The code block NodeView (components/editor/code-block-extension.ts) surfaces the block's
// `language` (a <select>) and `filename` (a text field) in the editor. Browser-only — the
// NodeView and the base ` ```lang ` input rule only exist in the live editor.

test('typing ```` ```ts ```` sets the language on the block', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  // The inherited backtick input rule captures the language after the fence.
  await page.keyboard.type('```ts '); // trailing space commits it

  const select = editor.locator('.code-block-lang');
  await expect(select).toHaveValue('ts');

  // The caret is left in the code body, so typing fills the <code> content hole.
  await page.keyboard.type('const x = 1;');
  await expect(editor.locator('.code-block code')).toContainText('const x = 1;');
});

test('choosing a language from the dropdown sets it (incl. ids the input rule can’t type)', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  await page.keyboard.type('``` '); // plain fence: no language
  const block = editor.locator('.code-block');
  const select = block.locator('.code-block-lang');
  await expect(select).toHaveValue('');

  // `cpp` (C++) is unreachable via the `[a-z]+` input rule — the dropdown is the only path.
  await block.hover();
  await select.selectOption('cpp');
  await expect(select).toHaveValue('cpp');
});

test('the code block language survives a save + reload (markdown round-trip)', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await page.getByLabel('タイトル').fill('E2E code block language');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  await page.keyboard.type('```python '); // Python fence
  await page.keyboard.type('print("hi")');
  await expect(editor.locator('.code-block-lang')).toHaveValue('python');

  // Autosave commits the draft (URL flips to /admin/posts/<id>/edit) and stores the
  // block as a ```python fence; reloading re-parses that markdown back into the editor.
  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });
  await page.reload();

  const reloaded = page.locator('.ProseMirror .code-block-lang');
  await expect(reloaded).toHaveValue('python');
  await expect(page.locator('.ProseMirror .code-block code')).toContainText('print("hi")');
});

test('the filename survives a save + reload (```lang:filename round-trip)', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await page.getByLabel('タイトル').fill('E2E code block filename');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  await page.keyboard.type('```ts '); // TS fence
  await page.keyboard.type('const x = 1;');

  const block = editor.locator('.code-block');
  await block.hover();
  const filename = block.locator('.code-block-filename');
  await filename.fill('index.ts');
  await filename.blur(); // commits on change → stored as ```ts:index.ts
  await expect(filename).toHaveValue('index.ts');

  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });
  await page.reload();

  await expect(page.locator('.ProseMirror .code-block-filename')).toHaveValue('index.ts');
  await expect(page.locator('.ProseMirror .code-block-lang')).toHaveValue('ts');
  await expect(page.locator('.ProseMirror .code-block code')).toContainText('const x = 1;');
});
