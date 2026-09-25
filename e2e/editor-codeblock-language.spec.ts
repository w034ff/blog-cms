import { test, expect } from '@playwright/test';
import { expectAutosaved, expectPublished, ensureCategory } from './editor-authoring';

// The code block NodeView (code-block-extension.ts) shows `language` (a <select>) and `filename`,
// set by the ` ```lang ` / ` ```lang:filename ` input rules.

test('typing ```` ```ts ```` sets the language on the block', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  // The inherited backtick rule captures the language.
  await page.keyboard.type('```ts '); // trailing space commits it

  const select = editor.locator('.code-block-lang');
  await expect(select).toHaveValue('ts');

  // The caret is in the code body.
  await page.keyboard.type('const x = 1;');
  await expect(editor.locator('.code-block code')).toContainText('const x = 1;');
});

test('typing ```` ```ts:index.ts ```` sets the language and the filename (Zenn/Qiita style)', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  // The `:filename` rule extends the base one, which cannot match a colon.
  await page.keyboard.type('```ts:index.ts '); // trailing space commits it

  const block = editor.locator('.code-block');
  await expect(block.locator('.code-block-lang')).toHaveValue('ts');
  await expect(block.locator('.code-block-filename')).toHaveValue('index.ts');

  // The caret is in the code body.
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
  // Let the NodeView mount and the 20ms selection sync settle (docs/editor-pitfalls.md §1.1).
  const code = editor.locator('.code-block code');
  await expect(editor.locator('.code-block-filename')).toHaveValue('index.ts');

  await page.keyboard.type('x'); // editing the block expires the fence undo
  await expect(code).toHaveText('x');
  await page.keyboard.press('Backspace'); // deletes the x — the block is empty again
  await expect(code).toHaveText('');
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

  // No longer just typed, so Backspace clears it to a paragraph.
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

  // `cpp` cannot match the `[a-z]+` rule; the dropdown is the only path.
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

  // Stored as a ```python fence; the reload re-parses it.
  await expectAutosaved(page);
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

  await expectAutosaved(page);
  await page.reload();

  await expect(page.locator('.ProseMirror .code-block-filename')).toHaveValue('index.ts');
  await expect(page.locator('.ProseMirror .code-block-lang')).toHaveValue('ts');
  await expect(page.locator('.ProseMirror .code-block code')).toContainText('const x = 1;');
});

// sanitizeFilename (code-block-extension.ts): only `[^\s`]+` survives the fence's info string, so
// these looked right until reopened, hence across a reload.
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

  // Corrected in the field too: fixing only the attr would show a name the document lacks.
  await expect(filename).toHaveValue('myfile.ts');

  await expectAutosaved(page);
  await page.reload();

  // markdown-it keeps the info string's first token, so ```ts:my file.ts came back as `my`.
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

  await expectAutosaved(page);
  await page.reload();

  // A backtick is illegal in a backtick fence's info string: the fence dissolved into text, hence the
  // count.
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

  // A server action resets the form, and the header <input>/<select> are detached from it (a `form`
  // attribute naming no element), so their values must survive; they used to blank with no
  // transaction to resync the NodeView.
  await expectAutosaved(page);
  await ensureCategory(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);

  await expect(block.locator('.code-block-filename')).toHaveValue('index.ts');
  await expect(block.locator('.code-block-lang')).toHaveValue('ts');
  await expect(editor.locator('.code-block code')).toContainText('const a = 1;');
});

// `diff` is independent of `language`: a header switch, or ```diff / ```diff_<lang>.

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

  // Without a language, Shiki's `diff` grammar colours the +/- text, so the editor paints diff-text-*.
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
  // With a language, row backgrounds only: the grammar colours the text.
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

  // Space re-activates the focused switch rather than typing.
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

  // Round-trip through renderHTML → parseHTML, as copy/paste does (never the NodeView DOM), where
  // attrs without a rendered form get lost. Via the API: headless Chrome's synthetic Ctrl+C/V skip
  // the OS clipboard.
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

  // HTML insertContent takes the pasted-HTML path, which skips updateCodeBlockDOM.
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

  await expectAutosaved(page);
  await page.reload();

  const block = page.locator('.ProseMirror .code-block');
  await expect(block.locator('.code-block-lang')).toHaveValue('ts');
  await expect(block.locator('.code-block-diff-toggle')).toHaveAttribute('aria-checked', 'true');
  await expect(block.locator('.diff-line-remove')).toHaveCount(1);
  await expect(block.locator('.diff-line-add')).toHaveCount(1);
});
