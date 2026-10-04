import { test, expect } from '@playwright/test';
import { docString } from './editor-probe';

// Backspace right after a block shortcut at the end of the document restores the typed text, as
// elsewhere. The trailing paragraph appended by a plugin cost the input rule its undo record
// (trailing-node-extension.ts says why).

// Every block shortcut, the text Backspace must restore (trailing space included), and its node.
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

    // The accordion opens a frame later (openInsertedDetails), and the toggle's `focus(…)`
    // dispatches an empty transaction; waiting puts Backspace after it, which broke a round-scoped fix.
    if (produces === 'details') {
      await expect(page.locator('.ProseMirror div[data-type="details"] > button')).toHaveAttribute(
        'aria-label',
        'アコーディオンを閉じる',
      );
    }

    await page.keyboard.press('Backspace');
    // The whole document: text and nothing else, no deferred empty paragraph.
    expect(await docString(page)).toBe(`doc(paragraph("${trigger}"))`);
  });
}

// The paragraph below is deferred, not dropped: without it there is nowhere below a final block for
// the caret.
test('the paragraph below the block still arrives once the undo window closes', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.keyboard.type(':::info ');
  // While Backspace can undo, the callout is last.
  expect(await docString(page)).toBe('doc(callout(paragraph))');

  // Typing closes the window, and the paragraph lands in that transaction.
  await page.keyboard.type('本文');
  expect(await docString(page)).toBe('doc(callout(paragraph("本文")), paragraph)');
});

// An append riding an undo survives the next Ctrl+Z (history remaps around it), leaving an empty
// line. Both presses asserted as whole documents.
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

  // Redo restores it all, the deferred paragraph riding the typing's event.
  await page.keyboard.press('Control+y');
  await page.keyboard.press('Control+y');
  expect(await docString(page)).toBe('doc(callout(paragraph("本文")), paragraph)');
});

// A click closes the window too (`tr.selectionSet`).
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
