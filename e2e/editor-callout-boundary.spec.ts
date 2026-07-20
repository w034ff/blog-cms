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

// The same 20ms selectionchange debounce (DOMObserver.flushSoon) that caretAtLineStart guards, but
// after a native ArrowUp/End move whose settled offset is line-dependent — there's no fixed value
// to poll for, so a flat wait past the debounce is the only option. Without it a Delete fired inside
// the debounce window acts on ProseMirror's stale selection and corrupts the doc. The natural gap
// between the End keypress and Delete usually clears the debounce on its own, but not reliably —
// this makes it deterministic rather than leaning on incidental timing margin.
async function caretSettled(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 70)));
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

// Unlike the non-empty case above, an *empty* line right after the callout carries nothing that
// could corrupt its body, so stepIntoPreviousIsolating deletes it outright (matching blockquote's
// plain join, where the empty line just disappears) instead of leaving it stranded. A second,
// non-empty paragraph below proves the delete really happened: with the doc's last block already
// a paragraph, StarterKit's TrailingNode has nothing to refill, so a stale line would otherwise
// still be there to count.
test('Backspace on an empty line after a callout deletes that line', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.getByRole('button', { name: '囲み枠' }).click();
  await page.getByRole('button', { name: '情報', exact: true }).click();
  await page.keyboard.type('囲み枠の本文');
  // Escaping the isolating callout downward lands on a gap cursor (see the test above), so
  // typing here creates one paragraph holding '次の段落' directly after the callout — not yet
  // the empty-line-then-paragraph shape this test needs.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('次の段落');
  // splitBlock at the very start of that paragraph turns it into an empty paragraph followed by
  // one holding the original text, caret landing at the start of the second — exactly the
  // "isolating node, empty line, non-empty paragraph" shape, without depending on gap-cursor
  // Enter semantics.
  await page.keyboard.press('Home');
  await caretAtLineStart(page);
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowLeft'); // into the empty line above
  await caretAtLineStart(page); // same native-selection-sync race as Home, above

  const callout = editor.locator('div.markdown-alert.markdown-alert-note');
  // `p:not(.markdown-alert-title)` excludes the callout's own non-editable title chip (also a
  // <p>, see callout-extension.ts), leaving just: callout body + empty line + next paragraph.
  const bodyParagraphs = editor.locator('p:not(.markdown-alert-title)');
  await expect(bodyParagraphs).toHaveCount(3);

  await page.keyboard.press('Backspace');

  // The empty line is gone — only the callout body and the non-empty paragraph remain.
  await expect(editor.locator('div.markdown-alert')).toHaveCount(1);
  await expect(callout.locator('.markdown-alert-content')).toContainText('囲み枠の本文');
  await expect(bodyParagraphs).toHaveCount(2);
  await expect(editor).toContainText('次の段落');
  await expect(callout).not.toContainText('次の段落');

  // Caret landed at the callout body's end, same as the non-empty case.
  await page.keyboard.type('と追記');
  await expect(callout.locator('.markdown-alert-content')).toContainText('囲み枠の本文と追記');
});

// The Delete-direction mirror of the "not pulled in" test above: at the callout's own end,
// Delete must not pull in the following non-empty paragraph. `isolating` already blocks
// joinForward for this (prosemirror-commands' findCutAfter refuses to cross it), so it's a plain
// no-op with no custom command involved — but it's exactly the case stepIntoNextIsolating must
// also leave alone, so it's covered here alongside its empty-line counterpart below.
test('a block right after a callout is not pulled in by Delete at the callout end', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.getByRole('button', { name: '囲み枠' }).click();
  await page.getByRole('button', { name: '情報', exact: true }).click();
  await page.keyboard.type('囲み枠の本文');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('あとに続く段落');
  await page.keyboard.press('Home');
  await caretAtLineStart(page);
  await page.keyboard.press('ArrowUp'); // back onto the callout body's line
  await page.keyboard.press('End'); // its true end
  await caretSettled(page);

  const callout = editor.locator('div.markdown-alert.markdown-alert-note');
  await page.keyboard.press('Delete');

  // Nothing merged, nothing deleted: one callout, its body unchanged, the paragraph intact.
  await expect(editor.locator('div.markdown-alert')).toHaveCount(1);
  await expect(callout.locator('.markdown-alert-content')).toContainText('囲み枠の本文');
  await expect(editor).toContainText('あとに続く段落');
  await expect(callout).not.toContainText('あとに続く段落');

  // The caret is still at the callout body's end, so typing appends there.
  await page.keyboard.type('と追記');
  await expect(callout.locator('.markdown-alert-content')).toContainText('囲み枠の本文と追記');
});

// The Delete-direction mirror of the empty-line Backspace test above: at the callout's own end,
// an empty line right after it carries nothing that could corrupt its body, so
// stepIntoNextIsolating (isolating-boundary.ts) deletes it outright. A second, non-empty
// paragraph proves the delete happened (TrailingNode has nothing to refill, so a stale line
// would otherwise still be there to count).
test('Delete at a callout end deletes an empty line right after it', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.getByRole('button', { name: '囲み枠' }).click();
  await page.getByRole('button', { name: '情報', exact: true }).click();
  await page.keyboard.type('囲み枠の本文');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('次の段落');
  await page.keyboard.press('Home');
  await caretAtLineStart(page);
  await page.keyboard.press('Enter'); // splits into an empty paragraph + one holding the text
  await page.keyboard.press('ArrowUp'); // into the (still empty) paragraph
  await page.keyboard.press('ArrowUp'); // back onto the callout body's line
  await page.keyboard.press('End'); // its true end
  await caretSettled(page);

  const callout = editor.locator('div.markdown-alert.markdown-alert-note');
  const bodyParagraphs = editor.locator('p:not(.markdown-alert-title)');
  await expect(bodyParagraphs).toHaveCount(3);

  await page.keyboard.press('Delete');

  // The empty line is gone — only the callout body and the non-empty paragraph remain.
  await expect(editor.locator('div.markdown-alert')).toHaveCount(1);
  await expect(callout.locator('.markdown-alert-content')).toContainText('囲み枠の本文');
  await expect(bodyParagraphs).toHaveCount(2);
  await expect(editor).toContainText('次の段落');
  await expect(callout).not.toContainText('次の段落');

  // Caret stayed at the callout body's end, so typing appends there.
  await page.keyboard.type('と追記');
  await expect(callout.locator('.markdown-alert-content')).toContainText('囲み枠の本文と追記');
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
