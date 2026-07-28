import { test, expect } from '@playwright/test';
import { docString } from './editor-probe';

// Drives the real editor: the "強調" toolbar button / Mod-Shift-E shortcut toggle the
// accentEmphasis mark (bold + red accent as one), and it round-trips as raw
// `<span class="accent-emphasis">` in the markdown mirrored into the hidden body input.
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

  // The shortcut toggles the same mark back off.
  await page.keyboard.press('Control+Shift+E');
  await expect(button).not.toHaveClass(/bg-zinc-200/);
  await expect(page.locator('input[name="body"]')).toHaveValue('accent me');
});

// Regression (found via manual testing 2026-07-25): layering bold/italic/strike onto only
// part of an already accent-emphasized range used to serialize as an independent
// `**…**`/`*…*`/`~~…~~` overlapping a `<span>…</span>` at a boundary — e.g.
// `xx**<span class="accent-emphasis">aa</span>**<span class="accent-emphasis">aa</span>yy` —
// where the delimiter could land directly between plain text and the span's `<` with no
// separating space. CommonMark's emphasis flanking rule then rejects that delimiter as a
// valid opener/closer, and it survives as literal text into the published page. Fixed by
// declaring `excludes: 'bold italic strike code'` on the mark (accent-emphasis-extension.ts)
// so none of them can structurally coexist with accentEmphasis on the same range. (Code has
// a related but distinct failure — see lib/render.test.ts — so it isn't re-tested here.)
// Only this toggle order is blocked; the reverse — accent-emphasizing text that is already
// bold/italic/struck — goes through and replaces the other mark by design (the reasoning is
// in accent-emphasis-extension.ts at `excludes`), so it isn't a case to test for here.
// Selection is set via editor commands (not keyboard Home/Arrow counting) — driving
// ProseMirror's selection with real key events raced with the toolbar's React re-render in
// this suite, occasionally landing the second selection on the wrong text.
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
      // Accent-emphasize the middle run of a's (positions 5–17, no whitespace on either
      // side of it — 0 is doc start, 1 is the paragraph's first text position).
      editorInstance.chain().setTextSelection({ from: 6, to: 18 }).run();
      editorInstance.commands.toggleAccentEmphasis();
      // Now try to layer the other mark onto just the first half of that accented run.
      editorInstance.chain().setTextSelection({ from: 6, to: 12 }).run();
      editorInstance.commands[cmd]();
      return editorInstance.storage.markdown.getMarkdown();
    }, command);

    // The accent-emphasis span must be left fully intact — excludes forbids the other mark
    // from ever attaching to (part of) its range, so nothing here changes.
    expect(body).toBe('xxxxx<span class="accent-emphasis">aaaaaaaaaaaa</span>yyyyy');
  });
}

// Mod-Shift-B (the shortcut the 引用 toolbar button advertises) used to apply *bold* instead:
// @tiptap/extension-bold registers `Mod-b` and `Mod-B`, and prosemirror-keymap's second lookup
// retries the pressed name with Shift stripped — so `Ctrl-B` matched bold before blockquote's own
// keymap was ever asked (bold sits later in PostEditor's extensions array, which ExtensionManager
// reverses). guarded-toggle-marks.ts drops `Mod-B`; the reasoning lives there. These three pin the
// keymap routes that reasoning depends on — the bold ones because dropping a bold binding must not
// cost bold anything, the blockquote one because it is the behaviour being bought.
test('Mod-B is free for blockquote without costing bold its own shortcut', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  // 1. Plain Ctrl+B still bolds. It matches `Ctrl-b` at the first lookup and never reaches the
  //    keyCode fallback the other two routes below depend on.
  await page.keyboard.type('太字にする');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+b');
  expect(await docString(page)).toContain('bold("太字にする")');
  await page.keyboard.press('Control+b');
  expect(await docString(page)).not.toContain('bold(');

  // 2. Ctrl+B with Caps Lock on — `key: "B"` with shiftKey *false*, the shape that made `Mod-B`
  //    look load-bearing. No Playwright keyboard call produces it (an uppercase key always sets
  //    shiftKey), so drive CDP directly; modifiers 2 = Ctrl alone. Bold survives here through the
  //    keyCode fallback: base[66] is "b", which differs from "B", so the lookup retries as `Ctrl-b`.
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

  // 3. And what the removal buys: Ctrl+Shift+B reaches blockquote instead of applying bold.
  //
  //    The chord is spelled with an uppercase B on purpose. Playwright sends `Control+Shift+b`
  //    with `key: "b"` and shiftKey true — a combination a physical keyboard never produces, and
  //    one that still lands on bold, because stripping Shift from "b" gives `Ctrl-b` outright.
  //    Only the uppercase spelling produces the real `key: "B"`.
  await page.keyboard.press('Control+Shift+B');
  const after = await docString(page);
  expect(after).toContain('blockquote(');
  expect(after).not.toContain('bold(');
});
