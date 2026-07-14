import { test, expect } from '@playwright/test';

// The code block NodeView (components/editor/code-block-extension.ts) surfaces the block's
// `language` (a <select>) and `filename` (a text field) in the editor. Browser-only — the
// NodeView and the ` ```lang ` / ` ```lang:filename ` input rules only exist in the live editor.

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

test('typing ```` ```ts:index.ts ```` sets the language and the filename (Zenn/Qiita style)', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  // The `:filename` rule extends the base backtick rule, which can't match a colon.
  await page.keyboard.type('```ts:index.ts '); // trailing space commits it

  const block = editor.locator('.code-block');
  await expect(block.locator('.code-block-lang')).toHaveValue('ts');
  await expect(block.locator('.code-block-filename')).toHaveValue('index.ts');

  // The caret is left in the code body, same as the plain ```lang rule.
  await page.keyboard.type('const x = 1;');
  await expect(block.locator('code')).toContainText('const x = 1;');
});

test('typing ```` ```:memo.txt ```` sets a filename with no language', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  await page.keyboard.type('```:memo.txt ');

  const block = editor.locator('.code-block');
  await expect(block.locator('.code-block-lang')).toHaveValue('');
  await expect(block.locator('.code-block-filename')).toHaveValue('memo.txt');
});

test('Backspace right after a fence conversion restores the literal text', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  await page.keyboard.type('```ts:index.ts ');
  await expect(editor.locator('.code-block')).toHaveCount(1);

  // Regression, two layers deep: CodeBlock's own Backspace keymap (empty → clear) used to
  // eat this keypress before core's undoInputRule could run — and at the end of the document
  // (this doc) even undoInputRule is dead, because TrailingNode's appended paragraph-insert
  // wipes its record. The extension's own fence-undo (fenceUndoKey) covers that.
  await page.keyboard.press('Backspace');
  await expect(editor.locator('.code-block')).toHaveCount(0);
  await expect(editor).toContainText('```ts:index.ts');
});

test('the fence undo expires once the block has been edited', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  await page.keyboard.type('```ts:index.ts ');
  // Let the NodeView mount and the selection sync before typing on (ProseMirror syncs
  // the DOM caret on a 20ms debounce; outrun it and keystrokes land astray — same
  // caveat as editor-codeblock-boundary.spec.ts's caretAtLineStart).
  const code = editor.locator('.code-block code');
  await expect(editor.locator('.code-block-filename')).toHaveValue('index.ts');

  await page.keyboard.type('x'); // editing the block expires the fence undo
  await expect(code).toHaveText('x');
  await page.keyboard.press('Backspace'); // deletes the x — the block is empty again
  await expect(code).toHaveText('');
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

  // The block is no longer "just typed", so this Backspace clears it to an empty
  // paragraph (the inherited behaviour) instead of resurrecting the fence text.
  await page.keyboard.press('Backspace');
  await expect(editor.locator('.code-block')).toHaveCount(0);
  await expect(editor).not.toContainText('```');
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

test('the header controls keep their values across a form-action save (投稿/更新)', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  await page.getByLabel('タイトル').fill('E2E code block 更新');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  await page.keyboard.type('```ts ');
  await page.keyboard.type('const a = 1;');
  const block = editor.locator('.code-block');
  await block.hover();
  await block.locator('.code-block-filename').fill('index.ts');
  await block.locator('.code-block-filename').blur();

  // Submitting the post's <form> via a server action makes React auto-reset the form. The
  // header <input>/<select> are detached from that form (form attr → non-existent id), so
  // their displayed values must survive — regression: they used to blank in place while the
  // node's attrs stayed intact (no ProseMirror transaction fired to re-sync the NodeView).
  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '投稿' }).click();
  await expect(page.getByText('公開済み（最新）')).toBeVisible({ timeout: 20_000 });

  await expect(block.locator('.code-block-filename')).toHaveValue('index.ts');
  await expect(block.locator('.code-block-lang')).toHaveValue('ts');
  await expect(editor.locator('.code-block code')).toContainText('const a = 1;');
});
