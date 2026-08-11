import { test, expect } from '@playwright/test';
import { docString } from './editor-probe';

// Backspace right after a block shortcut typed at the *end* of the document must put back the
// characters that were typed, exactly as it does anywhere else in the document.
//
// Browser-only, and specifically an end-of-document story: the trailing paragraph that used to
// break this is appended by a plugin, in a transaction of its own, which nothing but a running
// editor produces. See trailing-node-extension.ts for why that transaction cost the input rule its
// undo record, and editor-details-insert.spec.ts (the `:::details ` undo spec, which had to build
// a paragraph *below* the accordion to have something to measure) for what this looked like before.

// Every block shortcut in the editor, with the literal text Backspace has to bring back and the
// node it produces. The trigger's trailing space is what commits the rule, and it is part of what
// comes back — the author typed it.
const SHORTCUTS = [
  { name: '囲み枠', trigger: ':::info ', produces: 'callout' },
  { name: 'アコーディオン', trigger: ':::details ', produces: 'details' },
  { name: '引用', trigger: '> ', produces: 'blockquote' },
  { name: '見出し', trigger: '## ', produces: 'heading' },
  { name: '箇条書き', trigger: '- ', produces: 'bulletList' },
  { name: 'コードブロック', trigger: '``` ', produces: 'codeBlock' },
] as const;

for (const { name, trigger, produces } of SHORTCUTS) {
  test(`Backspace takes back the ${name} shortcut at the end of the document`, async ({ page }) => {
    await page.goto('/admin/posts/new');
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();

    await editor.click();
    await page.keyboard.type(trigger);
    expect(await docString(page)).toContain(produces);

    // The accordion opens itself a frame after the rule fires (openInsertedDetails), and the
    // official toggle answers that click with `editor.commands.focus(…)` — an empty transaction,
    // dispatched all the same. Waiting for the open state puts the Backspace *after* it, which is
    // the case that broke a round-scoped fix; for every other shortcut this resolves immediately.
    if (produces === 'details') {
      await expect(page.locator('.ProseMirror div[data-type="details"] > button')).toHaveAttribute(
        'aria-label',
        'アコーディオンを閉じる',
      );
    }

    await page.keyboard.press('Backspace');
    // The whole document, not `toContain`: the undo must leave the text *and nothing else* — no
    // half-dissolved block, and no empty paragraph left over from the append it deferred.
    expect(await docString(page)).toBe(`doc(paragraph("${trigger}"))`);
  });
}

// The other half of the deal: the escape hatch below the block is deferred, not dropped. Without a
// paragraph after a final callout/accordion/table there is nowhere below it to put the caret, which
// is the entire reason TrailingNode exists.
test('the paragraph below the block still arrives once the undo window closes', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.keyboard.type(':::info ');
  // While Backspace can still take the shortcut back, the callout is the last node.
  expect(await docString(page)).toBe('doc(callout(paragraph))');

  // Typing closes that window — and the paragraph lands in the very same transaction.
  await page.keyboard.type('本文');
  expect(await docString(page)).toBe('doc(callout(paragraph("本文")), paragraph)');
});

// Ctrl+Z has to end up where it did before the paragraph was ever deferred: an append that rides
// an *undo* survives the next Ctrl+Z (history remaps the older event's inverted steps around it),
// so the block would go and its empty line would stay. Both presses are asserted as whole
// documents — the leftover this rules out is exactly one empty paragraph.
test('undo after a shortcut at the end of the document leaves no empty line behind', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.keyboard.type(':::info ');
  await page.keyboard.type('本文');
  expect(await docString(page)).toBe('doc(callout(paragraph("本文")), paragraph)');

  await page.keyboard.press('Control+z');
  expect(await docString(page)).toBe('doc(callout(paragraph))');
  await page.keyboard.press('Control+z');
  expect(await docString(page)).toBe('doc(paragraph)');

  // And redo puts back everything undo took, the deferred paragraph included — it was part of the
  // transaction the author's typing produced, so it rides that event rather than being re-derived.
  await page.keyboard.press('Control+y');
  await page.keyboard.press('Control+y');
  expect(await docString(page)).toBe('doc(callout(paragraph("本文")), paragraph)');
});

// A click closes the window just as typing does (`tr.selectionSet`), so an author who inserts a
// block and reaches for the mouse still gets the paragraph — no keystroke required.
test('clicking away also releases the paragraph below the block', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.keyboard.type('段落');
  await page.keyboard.press('Enter');
  await page.keyboard.type(':::info ');
  expect(await docString(page)).toBe('doc(paragraph("段落"), callout(paragraph))');

  await page.locator('.ProseMirror p').first().click();
  await expect
    .poll(() => docString(page))
    .toBe('doc(paragraph("段落"), callout(paragraph), paragraph)');
});
