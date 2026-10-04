import { test, expect } from '@playwright/test';
import { docString } from './editor-probe';

// The 強調 button and Mod-Shift-E toggle accentEmphasis (bold plus red), stored as raw
// `<span class="accent-emphasis">`.
test('accent-emphasis button and shortcut toggle the mark and serialize to a span', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  const button = page.getByRole('button', { name: '強調' });
  await expect(button).toBeVisible();

  await editor.click();
  await page.keyboard.type('accent me');
  await page.keyboard.press('Control+a');
  await button.click();

  await expect(button).toHaveClass(/bg-zinc-200/);
  await expect(page.locator('input[name="body"]')).toHaveValue(
    /<span class="accent-emphasis">accent me<\/span>/,
  );

  // The shortcut toggles it off.
  await page.keyboard.press('Control+Shift+E');
  await expect(button).not.toHaveClass(/bg-zinc-200/);
  await expect(page.locator('input[name="body"]')).toHaveValue('accent me');
});

// Bold/italic/strike over part of an accented range serialized overlapping a `<span>`, with a
// delimiter against `<` that CommonMark's flanking rule rejects, leaving it as literal text.
// `excludes: 'bold italic strike code'` (accent-emphasis-extension.ts) prevents it; the reverse
// order replaces the other mark by design. Selections by command: key-driven ones raced the
// toolbar's re-render.
for (const [command, mark] of [
  ['toggleBold', 'bold'],
  ['toggleItalic', 'italic'],
  ['toggleStrike', 'strike'],
] as const) {
  test(`${mark} cannot be layered onto part of an accent-emphasized range`, async ({ page }) => {
    await page.goto('/admin/posts/new');
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.type('xxxxxaaaaaaaaaaaayyyyy');

    const body = await page.evaluate((cmd) => {
      const el = document.querySelector('.ProseMirror');
      // @ts-expect-error runtime probe (TipTap 3 exposes the editor on the DOM node)
      const editorInstance = el?.editor;
      // The middle run of a's (5–17), no whitespace either side.
      editorInstance.chain().setTextSelection({ from: 6, to: 18 }).run();
      editorInstance.commands.toggleAccentEmphasis();
      // Layer the other mark over half of it.
      editorInstance.chain().setTextSelection({ from: 6, to: 12 }).run();
      editorInstance.commands[cmd]();
      return editorInstance.storage.markdown.getMarkdown();
    }, command);

    // The span is intact: excludes forbids the other mark on its range.
    expect(body).toBe('xxxxx<span class="accent-emphasis">aaaaaaaaaaaa</span>yyyyy');
  });
}

// Mod-Shift-B applied bold: @tiptap/extension-bold binds `Mod-b` and `Mod-B`, and prosemirror-keymap
// retries without Shift, so `Ctrl-B` hit bold first (bold sits later in the extensions array, which
// ExtensionManager reverses). guarded-toggle-marks.ts drops `Mod-B` and says why; these pin the
// routes that reasoning relies on.
test('Mod-B is free for blockquote without costing bold its own shortcut', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  // 1. Ctrl+B bolds at the first lookup (`Ctrl-b`).
  await page.keyboard.type('太字にする');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+b');
  expect(await docString(page)).toContain('bold("太字にする")');
  await page.keyboard.press('Control+b');
  expect(await docString(page)).not.toContain('bold(');

  // 2. Caps Lock: `key: "B"`, shiftKey false, which no Playwright call produces, so CDP (modifiers 2 =
  //    Ctrl). Bold survives via the keyCode fallback: base[66] is "b", retried as `Ctrl-b`.
  const cdp = await page.context().newCDPSession(page);
  for (const type of ['keyDown', 'keyUp'] as const) {
    await cdp.send('Input.dispatchKeyEvent', {
      type,
      key: 'B',
      code: 'KeyB',
      windowsVirtualKeyCode: 66,
      nativeVirtualKeyCode: 66,
      modifiers: 2,
    });
  }
  expect(await docString(page)).toContain('bold("太字にする")');
  await page.keyboard.press('Control+b');

  // 3. Ctrl+Shift+B reaches blockquote. Uppercase B on purpose: Playwright's `Control+Shift+b` sends
  //    `key: "b"` with Shift, which no keyboard produces and which still lands on bold.
  await page.keyboard.press('Control+Shift+B');
  const after = await docString(page);
  expect(after).toContain('blockquote(');
  expect(after).not.toContain('bold(');
});
