import { test, expect } from '@playwright/test';
import { expectCanonicalSelection, pressKeyUntil, settle } from './editor-probe';

// Blockquote Backspace joins (blockquote-extension.ts), replacing upstream's one-level join. The
// first case dates from @tiptap/extension-blockquote bundling its own prosemirror-state (through
// 3.27.x; test/no-inlined-prosemirror.test.ts guards that class) and stays as a canonical-selection
// check.

// The join built its caret from a duplicate TextSelection class, failing prosemirror-view's
// `instanceof` and killing the next Backspace.
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

  // Enter, Enter: out to an empty paragraph below the quote.
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');

  // Backspace joins it back, where the foreign TextSelection used to appear.
  await page.keyboard.press('Backspace');
  await settle(page);
  // Precondition: the join happened — one blockquote holding "quote1", nothing below it.
  await expect(editor.locator('blockquote')).toHaveCount(1);
  await expect(quote).toContainText('quote1');
  // The caret is a canonical selection (not the bundler-renamed duplicate) — the actual root cause.
  await expectCanonicalSelection(page);

  // With the bug this Backspace was dead.
  await page.keyboard.press('Backspace');

  await expect(quote).toContainText('quote');
  await expect(quote).not.toContainText('quote1');
});

// The extension lifted an empty line out while ProseMirror pulled it back, forever. The join now
// descends to the preceding quote's deepest trailing textblock.
test('Backspace merges a nested-quote line up to the previous line instead of oscillating', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  // Three nested quotes; `> ` inside a quote nests another.
  for (const line of ['> aaa', '> bbb', '> ccc']) {
    if (line !== '> aaa') {
      await page.keyboard.press('Enter');
      await settle(page);
    }
    await page.keyboard.type(line);
    await settle(page);
  }
  await expect(editor.locator('blockquote blockquote blockquote')).toContainText('ccc');

  // Converges to the end of "bbb"; the oscillation exhausts pressKeyUntil's budget instead.
  expect(await pressKeyUntil(page, 'Backspace', 'bbb@3')).toBe('bbb@3');
  await expect(editor).not.toContainText('ccc');

  // A real caret in "bbb": Backspace deletes, typing appends.
  await page.keyboard.press('Backspace');
  await page.keyboard.type('X');
  await expect(editor.locator('blockquote blockquote')).toContainText('bbX');
});
