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

// The filename field's normalization (sanitizeFilename in code-block-extension.ts). Only
// `[^\s`]+` survives the ```lang:filename fence, and the field used to accept anything —
// so both cases below looked correct right up until the post was reopened. That delay is why
// they are asserted across a reload rather than at the edit: the pre-fix field passed every
// in-editor check.
test('a filename typed with whitespace is normalized in place and survives a reload', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  await page.getByLabel('タイトル').fill('E2E code block filename 空白');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  await page.keyboard.type('```ts ');
  await page.keyboard.type('const x = 1;');

  const block = editor.locator('.code-block');
  await block.hover();
  const filename = block.locator('.code-block-filename');
  await filename.fill('my file.ts');
  await filename.blur();

  // Corrected where the author can see it. Repairing only the stored attr would reproduce the
  // shape of the bug — a field showing a name the document doesn't hold.
  await expect(filename).toHaveValue('myfile.ts');

  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });
  await page.reload();

  // The regression: ```ts:my file.ts re-parses as `language-ts:my` (markdown-it keeps only the
  // info string's first token), so the filename came back as `my` — extension and all, gone.
  await expect(page.locator('.ProseMirror .code-block-filename')).toHaveValue('myfile.ts');
  await expect(page.locator('.ProseMirror .code-block-lang')).toHaveValue('ts');
  await expect(page.locator('.ProseMirror .code-block code')).toContainText('const x = 1;');
});

test('a filename typed with a backtick is normalized and the fence still parses', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  await page.getByLabel('タイトル').fill('E2E code block filename バッククォート');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  await page.keyboard.type('```ts ');
  await page.keyboard.type('const x = 1;');

  const block = editor.locator('.code-block');
  await block.hover();
  const filename = block.locator('.code-block-filename');
  await filename.fill('a`b.ts');
  await filename.blur();
  await expect(filename).toHaveValue('ab.ts');

  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });
  await page.reload();

  // Worse than truncation before the fix: a backtick is illegal in a backtick fence's info
  // string, so ```ts:a`b.ts stopped being a fence at all — the code came back as literal
  // paragraph text with an empty code block below it. Hence the count, not just the value.
  await expect(page.locator('.ProseMirror .code-block')).toHaveCount(1);
  await expect(page.locator('.ProseMirror .code-block-filename')).toHaveValue('ab.ts');
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

// `diff` is an attribute independent of `language` (components/editor/code-block-extension.ts):
// a header toggle switch, plus a ```diff/```diff_<lang> typing shortcut that sets it directly.

test('typing ```` ```diff_ts ```` sets the language and turns the diff toggle on', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  await page.keyboard.type('```diff_ts '); // trailing space commits it

  const block = editor.locator('.code-block');
  await expect(block.locator('.code-block-lang')).toHaveValue('ts');
  await expect(block.locator('.code-block-diff-toggle')).toHaveAttribute('aria-checked', 'true');
});

test('typing ```` ```diff ```` (bare) turns the diff toggle on with no language', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  await page.keyboard.type('```diff ');

  const block = editor.locator('.code-block');
  await expect(block.locator('.code-block-lang')).toHaveValue('');
  await expect(block.locator('.code-block-diff-toggle')).toHaveAttribute('aria-checked', 'true');

  // With no real language the public page highlights via Shiki's own `diff` grammar, which
  // colors the +/- TEXT — so the editor mirror paints diff-text-* alongside the row classes.
  await page.keyboard.type('-old');
  await page.keyboard.press('Enter');
  await page.keyboard.type('+new');
  await expect(block.locator('.diff-text-remove.diff-line-remove')).toHaveCount(1);
  await expect(block.locator('.diff-text-add.diff-line-add')).toHaveCount(1);
});

test('clicking the diff toggle colors existing +/- lines without changing the language', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  await page.keyboard.type('```ts '); // plain TS fence: toggle is off by default
  await page.keyboard.type('-old line');
  await page.keyboard.press('Enter');
  await page.keyboard.type('+new line');

  const block = editor.locator('.code-block');
  const toggle = block.locator('.code-block-diff-toggle');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(block.locator('.diff-line-add, .diff-line-remove')).toHaveCount(0);

  await block.hover(); // the header sits behind the code area's own hover chrome
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(block.locator('.code-block-lang')).toHaveValue('ts'); // unchanged by the toggle
  await expect(block.locator('.diff-line-remove')).toHaveCount(1);
  await expect(block.locator('.diff-line-add')).toHaveCount(1);
  // With a real language the public page shows that grammar's token colors, so the editor
  // must NOT paint the green/red diff text — row backgrounds only.
  await expect(block.locator('.diff-text-add, .diff-text-remove')).toHaveCount(0);
});

test('the diff toggle keeps focus, so a keyboard user can flip it again', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.keyboard.type('```ts ');
  await page.keyboard.type('const x = 1;');

  const block = editor.locator('.code-block');
  const toggle = block.locator('.code-block-diff-toggle');
  await block.hover();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(toggle).toBeFocused();

  // Space re-activates the still-focused switch instead of typing into the document.
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(editor.locator('.code-block code')).toHaveText('const x = 1;');
});

test('in-editor copy/paste keeps the diff toggle and filename', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  await page.keyboard.type('```diff_ts:index.ts ');
  await page.keyboard.type('-old');

  // Duplicate the block through the schema's renderHTML → parseHTML round-trip — the same
  // pair an in-editor copy/paste uses (ProseMirror serializes a copy via the schema's
  // DOMSerializer, never the NodeView DOM), which is exactly where attrs without a rendered
  // form get lost. Driven via the editor API because headless Chrome doesn't route synthetic
  // Ctrl+C/Ctrl+V through the OS clipboard.
  await page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as
      | (Element & {
          editor?: {
            getHTML(): string;
            commands: { focus(pos: 'end'): boolean; insertContent(html: string): boolean };
          };
        })
      | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    const html = el.editor.getHTML();
    el.editor.commands.focus('end');
    el.editor.commands.insertContent(html);
  });

  const blocks = editor.locator('.code-block');
  await expect(blocks).toHaveCount(2);
  const copy = blocks.nth(1);
  await expect(copy.locator('.code-block-lang')).toHaveValue('ts');
  await expect(copy.locator('.code-block-filename')).toHaveValue('index.ts');
  await expect(copy.locator('.code-block-diff-toggle')).toHaveAttribute('aria-checked', 'true');
  await expect(copy.locator('.diff-line-remove')).toHaveCount(1);
});

test('pasted external HTML with class="language-diff" folds into the diff attr', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  // insertContent with an HTML string takes ProseMirror's DOM-parse path — the same one
  // pasted text/html takes, which never runs the markdown parse hook (updateCodeBlockDOM).
  await page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as
      | (Element & { editor?: { commands: { insertContent: (html: string) => boolean } } })
      | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    el.editor.commands.insertContent('<pre><code class="language-diff">-old\n+new</code></pre>');
  });

  const block = editor.locator('.code-block');
  await expect(block.locator('.code-block-lang')).toHaveValue(''); // not a stray 'diff' entry
  await expect(block.locator('.code-block-diff-toggle')).toHaveAttribute('aria-checked', 'true');
  await expect(block.locator('.diff-line-remove')).toHaveCount(1);
  await expect(block.locator('.diff-line-add')).toHaveCount(1);
});

test('a diff-toggled block with no +/- lines gets no row decoration', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  await page.keyboard.type('```diff_ts ');
  await page.keyboard.type('const x = 1;');

  const block = editor.locator('.code-block');
  await expect(block.locator('.code-block-diff-toggle')).toHaveAttribute('aria-checked', 'true');
  await expect(block.locator('.diff-line-add, .diff-line-remove')).toHaveCount(0);
});

test('the diff toggle and language survive a save + reload (```diff_lang round-trip)', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  await page.getByLabel('タイトル').fill('E2E code block diff toggle');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  await page.keyboard.type('```diff_ts ');
  await page.keyboard.type('-old');
  await page.keyboard.press('Enter');
  await page.keyboard.type('+new');

  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });
  await page.reload();

  const block = page.locator('.ProseMirror .code-block');
  await expect(block.locator('.code-block-lang')).toHaveValue('ts');
  await expect(block.locator('.code-block-diff-toggle')).toHaveAttribute('aria-checked', 'true');
  await expect(block.locator('.diff-line-remove')).toHaveCount(1);
  await expect(block.locator('.diff-line-add')).toHaveCount(1);
});
