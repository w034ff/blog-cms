import { test, expect, type Page } from '@playwright/test';

// A keyboard `Home` moves the caret natively: the DOM selection updates at once, but ProseMirror
// only learns of it from `selectionchange`, whose handler flushes on a 20ms debounce
// (DOMObserver.flushSoon). A Backspace inside that window bypasses every ProseMirror keymap (the
// internal selection still sits at the old spot, so no handler matches) and the browser's native
// edit mutates the DOM; re-parsing that mutation nests the following block *inside* the callout.
// So: wait for the DOM caret, then let a page-side 50ms timer outlast the pending flush — same
// event loop, so it provably fires after the already-scheduled 20ms flush timer.
async function caretAtLineStart(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.getSelection()?.anchorOffset ?? -1)).toBe(0);
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
}

// The callout node is `isolating` (components/editor/callout-extension.ts): its edges are
// hard boundaries, so a block sitting directly after it can't be joined into its body. Without
// that, ProseMirror's default joinBackward pulls the following block (e.g. a code block) into
// the callout when you Backspace at its start. Browser-only — this is live-editor edit behavior.
test('a block right after a callout is not pulled in by Backspace at its start', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  // Build: a callout with a body, then a paragraph directly after it. Escaping the isolating
  // callout downward lands on a gap cursor, so typing there creates a following top-level block
  // — which also confirms you can still add content after the callout (the isolating trade-off).
  await editor.click();
  await page.getByRole('button', { name: '囲み枠' }).click();
  await page.getByRole('button', { name: '情報', exact: true }).click();
  await page.keyboard.type('囲み枠の本文');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('あとに続く段落');

  const callout = editor.locator('div.markdown-alert.markdown-alert-note');
  await expect(callout).toBeVisible();
  // Precondition: the following text really is outside the callout.
  await expect(callout).not.toContainText('あとに続く段落');

  // Caret to the very start of that following paragraph, then Backspace.
  await page.keyboard.press('Home');
  await caretAtLineStart(page);
  await page.keyboard.press('Backspace');

  // The isolating boundary holds: the paragraph is not absorbed, there is still exactly one
  // callout, and its body is unchanged.
  await expect(editor.locator('div.markdown-alert')).toHaveCount(1);
  await expect(callout).not.toContainText('あとに続く段落');
  await expect(callout.locator('.markdown-alert-content')).toContainText('囲み枠の本文');

  // The caret lands at the *end of the callout body* (not a node selection, not the block below),
  // so typing appends there — while the following paragraph stays untouched.
  await page.keyboard.type('と追記');
  await expect(callout.locator('.markdown-alert-content')).toContainText('囲み枠の本文と追記');
  await expect(editor).toContainText('あとに続く段落');
  await expect(callout).not.toContainText('あとに続く段落');
});

// `isolating` otherwise traps an empty callout (can't be removed from inside, and there's no
// toolbar toggle to clear it), so the Callout Backspace shortcut unwraps an empty one to a plain
// paragraph. Insert a callout, leave it empty, Backspace at its start → the callout is gone.
test('Backspace at the start of an empty callout removes it', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.getByRole('button', { name: '囲み枠' }).click();
  await page.getByRole('button', { name: '情報', exact: true }).click();
  await expect(editor.locator('div.markdown-alert')).toHaveCount(1);

  await page.keyboard.press('Backspace');
  await expect(editor.locator('div.markdown-alert')).toHaveCount(0);
});

// The escape hatch is scoped to *empty* callouts: with text in it, Backspace at the start must
// not delete the box (you clear the text first). Guards against the shortcut eating content.
test('Backspace at the start of a non-empty callout keeps it', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.getByRole('button', { name: '囲み枠' }).click();
  await page.getByRole('button', { name: '情報', exact: true }).click();
  await page.keyboard.type('消えない本文');
  await page.keyboard.press('Home'); // caret to the start of the callout body
  await caretAtLineStart(page);

  await page.keyboard.press('Backspace');
  const callout = editor.locator('div.markdown-alert');
  await expect(callout).toHaveCount(1);
  await expect(callout.locator('.markdown-alert-content')).toContainText('消えない本文');
});
