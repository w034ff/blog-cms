import { test, expect, type Page } from '@playwright/test';

// A keyboard `Home` moves the caret natively; ProseMirror syncs its internal selection from the
// `selectionchange` event on a 20ms debounce (DOMObserver.flushSoon). A Backspace inside that
// window bypasses every keymap and the browser's native edit corrupts the document (see the
// callout boundary spec for the full story). Wait for the DOM caret, then let a page-side 50ms
// timer outlast the pending flush — same event loop, so it fires after the 20ms flush timer.
async function caretAtLineStart(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.getSelection()?.anchorOffset ?? -1)).toBe(0);
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
}

// The code block is `isolating` (components/editor/code-block-extension.ts), so a block below it
// can't be merged into the code, and the shared Backspace shortcut steps the caret into the code
// block's end instead of node-selecting it. Browser-only — this is live-editor edit behavior.
test('a paragraph after a code block is not merged into it by Backspace at its start', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  // Code block, then a paragraph directly after it (ArrowDown exits the code block — exitOnArrowDown
  // must still work with `isolating` on).
  await page.keyboard.type('```ts ');
  await page.keyboard.type('const x = 1');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('あとの段落');

  const codeBody = editor.locator('.code-block code');
  // Precondition: exitOnArrowDown made a separate paragraph — the text is NOT in the code body.
  await expect(codeBody).toHaveText('const x = 1');
  await expect(editor).toContainText('あとの段落');

  await page.keyboard.press('Home');
  await caretAtLineStart(page);
  await page.keyboard.press('Backspace');

  // Not merged: one code block, its body unchanged, the paragraph still present.
  await expect(editor.locator('.code-block')).toHaveCount(1);
  await expect(codeBody).toHaveText('const x = 1');
  await expect(editor).toContainText('あとの段落');

  // The caret landed at the *end of the code body*, so typing appends there (into the code).
  await page.keyboard.type(';');
  await expect(codeBody).toHaveText('const x = 1;');
  await expect(editor).toContainText('あとの段落');
});

// Unlike the non-empty case above, an *empty* line right after the code block carries nothing
// that could corrupt the code, so stepIntoPreviousIsolating deletes it outright (matching
// blockquote's plain join, where the empty line just disappears) instead of leaving it stranded.
// A second, non-empty paragraph below proves the delete really happened: with the doc's last
// block already a paragraph, StarterKit's TrailingNode has nothing to refill, so a stale line
// would otherwise still be there to count.
test('Backspace on an empty line after a code block deletes that line', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  await page.keyboard.type('```ts ');
  await page.keyboard.type('const x = 1');
  await page.keyboard.press('ArrowDown'); // exits into a fresh empty paragraph
  await page.keyboard.press('Enter');
  await page.keyboard.type('次の段落');
  await page.keyboard.press('ArrowUp'); // back into the empty line

  const codeBody = editor.locator('.code-block code');
  await expect(codeBody).toHaveText('const x = 1');
  await expect(editor.locator('p')).toHaveCount(2);

  await page.keyboard.press('Backspace');

  // The empty line is gone — only the non-empty paragraph remains, directly after the code block.
  await expect(editor.locator('.code-block')).toHaveCount(1);
  await expect(codeBody).toHaveText('const x = 1');
  await expect(editor.locator('p')).toHaveCount(1);
  await expect(editor.locator('p')).toHaveText('次の段落');

  // Caret landed at the code body's end, same as the non-empty case.
  await page.keyboard.type(';');
  await expect(codeBody).toHaveText('const x = 1;');
});

// The Delete-direction mirror of the "not merged" test above: at the code block's own end,
// Delete must not pull in the following non-empty paragraph. `isolating` already blocks
// joinForward for this (prosemirror-commands' findCutAfter refuses to cross it), so this is a
// plain no-op with no custom command involved — but it's exactly the case stepIntoNextIsolating
// must also leave alone, so it's covered here alongside its empty-line counterpart below.
test('a paragraph after a code block is not merged into it by Delete at the code block end', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  await page.keyboard.type('```ts ');
  await page.keyboard.type('const x = 1');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('あとの段落');
  await page.keyboard.press('Home');
  await caretAtLineStart(page);
  await page.keyboard.press('ArrowUp'); // back onto the code block's line
  await page.keyboard.press('End'); // its true end

  const codeBody = editor.locator('.code-block code');
  await page.keyboard.press('Delete');

  // Nothing merged, nothing deleted: one code block, its body unchanged, the paragraph intact.
  await expect(editor.locator('.code-block')).toHaveCount(1);
  await expect(codeBody).toHaveText('const x = 1');
  await expect(editor).toContainText('あとの段落');

  // The caret is still at the code body's end, so typing appends there.
  await page.keyboard.type(';');
  await expect(codeBody).toHaveText('const x = 1;');
});

// The Delete-direction mirror of the empty-line Backspace test above: at the code block's own
// end, an empty line right after it carries nothing that could corrupt the code, so
// stepIntoNextIsolating (isolating-boundary.ts) deletes it outright. A second, non-empty
// paragraph proves the delete happened (TrailingNode has nothing to refill, so a stale line
// would otherwise still be there to count).
test('Delete at a code block end deletes an empty line right after it', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  await page.keyboard.type('```ts ');
  await page.keyboard.type('const x = 1');
  await page.keyboard.press('ArrowDown'); // exits into a fresh empty paragraph
  await page.keyboard.press('Enter'); // splits into two empty paragraphs
  await page.keyboard.type('次の段落'); // fills the second
  await page.keyboard.press('ArrowUp'); // into the (still empty) first paragraph
  await page.keyboard.press('ArrowUp'); // back onto the code block's line
  await page.keyboard.press('End'); // its true end

  const codeBody = editor.locator('.code-block code');
  await expect(editor.locator('p')).toHaveCount(2);

  await page.keyboard.press('Delete');

  // The empty line is gone — only the non-empty paragraph remains, directly after the code block.
  await expect(editor.locator('.code-block')).toHaveCount(1);
  await expect(codeBody).toHaveText('const x = 1');
  await expect(editor.locator('p')).toHaveCount(1);
  await expect(editor.locator('p')).toHaveText('次の段落');

  // Caret stayed at the code body's end, so typing appends there.
  await page.keyboard.type(';');
  await expect(codeBody).toHaveText('const x = 1;');
});

// Regression: `isolating` must not trap the code block — Backspace from inside an empty block
// must still remove it. Right after typing the fence it takes the fence-undo path (the literal
// ``` text comes back, see fenceUndoKey in the extension); once the record has expired, the
// inherited empty → clear kicks in instead (covered in editor-codeblock-language.spec.ts).
test('Backspace in a just-typed empty code block restores the fence text', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  await page.keyboard.type('``` '); // plain empty fence
  await expect(editor.locator('.code-block')).toHaveCount(1);

  await page.keyboard.press('Backspace');
  await expect(editor.locator('.code-block')).toHaveCount(0);
  await expect(editor).toContainText('```');
});

// Regression: deleting the block's final character used to be left to the browser, and
// Chrome's native edit folded the emptied <pre><code> into the ce=false header — removing
// the code body from the DOM while ignoreMutation hid the damage from ProseMirror (the
// header remained but the block was uneditable until a reload). deleteSoleCodeChar in the
// extension now performs that one deletion through ProseMirror.
test('deleting the last character keeps the code body editable', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  await page.keyboard.type('```ts ');
  await expect(editor.locator('.code-block-lang')).toHaveValue('ts');
  const code = editor.locator('.code-block code');
  await page.keyboard.type('x');
  await expect(code).toHaveText('x');

  await page.keyboard.press('Backspace');
  await expect(code).toHaveText(''); // the <code> survives, now empty

  await page.keyboard.type('y'); // …and still receives typing
  await expect(code).toHaveText('y');
});
