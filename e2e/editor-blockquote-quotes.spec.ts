import { test, expect } from '@playwright/test';

// Guards the globals.css override that strips Typography's decorative quotes
// (`blockquote p:first-of-type::before {content:open-quote}`): CSS only.
test('blockquote renders without Typography decorative quotes', async ({ page }) => {
  await page.goto('/admin/posts/new');

  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  // `> ` triggers the blockquote input rule.
  await page.keyboard.type('> quoted text');

  const quotePara = editor.locator('blockquote p').first();
  await expect(quotePara).toBeVisible();

  const beforeContent = await quotePara.evaluate((el) => getComputedStyle(el, '::before').content);
  // `content: none` computes to "none"; an open-quote to the glyph.
  expect(beforeContent).toBe('none');
});

// The override must not reach a callout in a quote: its title <p> matches
// `blockquote p:first-of-type::before` and outweighs `.markdown-alert-title::before`. The
// `:not(.markdown-alert-title)` exclusion in globals.css is what keeps the icon.
test('a callout nested in a blockquote keeps its icon', async ({ page }) => {
  await page.goto('/admin/posts/new');

  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  // No longer authorable (setCallout refuses in a quote), but `> > [!NOTE]` loads from stored markdown,
  // so the document is built as a load does.
  await page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as
      (Element & { editor?: { commands: { setContent(doc: unknown): boolean } } }) | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    el.editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'quoted text' }] },
            {
              type: 'callout',
              attrs: { type: 'note' },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'callout body' }] }],
            },
          ],
        },
      ],
    });
  });

  const callout = editor.locator('blockquote div.markdown-alert-note');
  await expect(callout).toBeVisible();

  const title = callout.locator('.markdown-alert-title');
  const beforeContent = await title.evaluate((el) => getComputedStyle(el, '::before').content);
  // The icon's `content: ''` computes to ""; "none" would mean it was swallowed.
  expect(beforeContent).toBe('""');
});
