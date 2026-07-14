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

// Regression: `isolating` must not trap the code block. CodeBlock's own Backspace (empty → clear)
// still removes an empty block from inside.
test('Backspace in an empty code block still clears it to a paragraph', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  await page.keyboard.type('``` '); // plain empty fence
  await expect(editor.locator('.code-block')).toHaveCount(1);

  await page.keyboard.press('Backspace');
  await expect(editor.locator('.code-block')).toHaveCount(0);
});
