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

  const beforeContent = await quotePara.evaluate(
    (el) => getComputedStyle(el, '::before').content,
  );
  // `content: none` computes to the string "none"; an open-quote would compute
  // to the actual quote character instead.
  expect(beforeContent).toBe('none');
});
