import { test, expect } from '@playwright/test';

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
