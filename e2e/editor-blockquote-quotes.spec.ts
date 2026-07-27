import { test, expect } from '@playwright/test';

// Guards the globals.css override that strips Tailwind Typography's decorative
// blockquote quotes (`blockquote p:first-of-type::before {content:open-quote}`).
// CSS-only, so only a real browser can observe it: the blockquote paragraph's
// ::before content must resolve to `none`, not an injected quote glyph.
test('blockquote renders without Typography decorative quotes', async ({ page }) => {
  await page.goto('/admin/posts/new');

  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  // `> ` at line start triggers ProseMirror's blockquote input rule.
  await page.keyboard.type('> quoted text');

  const quotePara = editor.locator('blockquote p').first();
  await expect(quotePara).toBeVisible();

  const beforeContent = await quotePara.evaluate((el) => getComputedStyle(el, '::before').content);
  // `content: none` computes to the string "none"; an open-quote would compute
  // to the actual quote character instead.
  expect(beforeContent).toBe('none');
});

// The same override must NOT reach a callout written inside a quote. The alert's
// title is a <p> (the only one directly under its <div>), so `blockquote
// p:first-of-type::before` matches it and outweighs `.markdown-alert-title::before`
// — and `content: none` there deletes the very pseudo-element the icon is drawn on.
// The `:not(.markdown-alert-title)` exclusion in globals.css is what keeps the icon.
// CSS-only and cascade-dependent, so again only a real browser can observe it.
test('a callout nested in a blockquote keeps its icon', async ({ page }) => {
  await page.goto('/admin/posts/new');

  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  // The nesting can't be authored any more — setCallout refuses inside a quote and the
  // typing shortcuts are top-level only (callout-extension.ts) — but it is still
  // *loadable*: `> > [!NOTE]` is valid markdown that a saved or pasted post can carry,
  // and lib/remark-github-alerts.ts renders it as a nested alert. So build the document
  // the way loading such a post does, straight into the live editor.
  await page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as
      | (Element & { editor?: { commands: { setContent(doc: unknown): boolean } } })
      | null;
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
  // The icon's own rule sets `content: ''`, which computes to the empty string —
  // "none" would mean the suppression rule above swallowed the icon.
  expect(beforeContent).toBe('""');
});
