import { test, expect } from '@playwright/test';
import { expectCanonicalSelection, pressKeyUntil, settle } from './editor-probe';

// Regressions for blockquote Backspace joins, both served by components/editor/blockquote-extension.ts.
// @tiptap/extension-blockquote@3.27.1 bundles its own copy of prosemirror-state into its dist and
// its Backspace join is single-level only; we replace it. Browser-only — the duplicate class and
// the join behaviour only exist in the bundled runtime, so tsc/vitest can't observe them.

// The original bug: the extension's join built the caret with a *duplicate* TextSelection class,
// which failed `instanceof TextSelection` in prosemirror-view and left the next Backspace dead.
test('Backspace still deletes text after joining a paragraph into a blockquote', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  // `> ` fires the blockquote input rule; type the quote body.
  await page.keyboard.type('> quote1');
  const quote = editor.locator('blockquote');
  await expect(quote).toContainText('quote1');

  // Enter → a new empty line inside the quote; Enter again → escapes to an empty paragraph
  // directly below the blockquote, caret at its start.
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');

  // Backspace at the start of that empty paragraph joins it back into the quote — the join that
  // used to leave a "foreign" TextSelection at the end of "quote1".
  await page.keyboard.press('Backspace');
  await settle(page);
  // Precondition: the join happened — one blockquote holding "quote1", nothing below it.
  await expect(editor.locator('blockquote')).toHaveCount(1);
  await expect(quote).toContainText('quote1');
  // The caret is a canonical selection (not the bundler-renamed duplicate) — the actual root cause.
  await expectCanonicalSelection(page);

  // The killer Backspace: with the fix it deletes the trailing "1"; with the bug it was dead.
  await page.keyboard.press('Backspace');

  await expect(quote).toContainText('quote');
  await expect(quote).not.toContainText('quote1');
});

// Nested-quote follow-up: the extension used to `lift` an empty line out of its quote while
// ProseMirror's default kept pulling it back in, so Backspace toggled the line in and out of the
// quote forever and never reached the text. The join now descends the preceding quote's trailing
// edge to its deepest textblock, so Backspace walks the caret to the end of that line.
test('Backspace merges a nested-quote line up to the previous line instead of oscillating', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  // Build three progressively nested quotes: blockquote("aaa" > blockquote("bbb" > blockquote("ccc"))).
  // A `> ` at the start of a line already inside a quote wraps it in another quote.
  for (const line of ['> aaa', '> bbb', '> ccc']) {
    if (line !== '> aaa') {
      await page.keyboard.press('Enter');
      await settle(page);
    }
    await page.keyboard.type(line);
    await settle(page);
  }
  await expect(editor.locator('blockquote blockquote blockquote')).toContainText('ccc');

  // Backspace must collapse the innermost "ccc" quote and land the caret at the END of "bbb"
  // (offset 3) — the merge. The pre-fix oscillation never reached "bbb@3", so pressKeyUntil would
  // exhaust its budget and this assertion would fail instead of the caret converging.
  expect(await pressKeyUntil(page, 'Backspace', 'bbb@3')).toBe('bbb@3');
  await expect(editor).not.toContainText('ccc');

  // The caret really sits inside the "bbb" text (not a foreign/empty selection): one more Backspace
  // deletes from it, and typing appends to it.
  await page.keyboard.press('Backspace');
  await page.keyboard.type('X');
  await expect(editor.locator('blockquote blockquote')).toContainText('bbX');
});
