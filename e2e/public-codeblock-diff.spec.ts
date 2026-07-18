import { test, expect } from '@playwright/test';

// ```diff fences get a per-line class from lib/shiki-diff-line-transformer.ts (Shiki's diff
// grammar only sets a token *foreground* color, not the row background a real diff view needs).
// Guards: +/- lines get the translucent green/red row background; a +++/--- file-header line
// (unified diff convention) does NOT, matching git/GitHub's own diff rendering.
test('a public ```diff code block paints +/- rows, but not +++/--- header rows', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await page.getByLabel('タイトル').fill('Diff highlight spec');
  await editor.click();
  await page.keyboard.type('```diff ');
  await page.keyboard.type('--- a/example.js');
  await page.keyboard.press('Enter');
  await page.keyboard.type('+++ b/example.js');
  await page.keyboard.press('Enter');
  await page.keyboard.type('-old line');
  await page.keyboard.press('Enter');
  await page.keyboard.type('+new line');

  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '投稿' }).click();
  await expect(page.getByText('公開済み（最新）')).toBeVisible({ timeout: 20_000 });
  const href = await page.getByRole('link', { name: '表示' }).getAttribute('href');
  await page.goto(href!);

  const lines = page.locator('[data-rehype-pretty-code-figure] [data-line]');
  await expect(lines).toHaveCount(4);
  await expect(lines.nth(0)).not.toHaveClass(/diff-line-(add|remove)/); // --- a/example.js
  await expect(lines.nth(1)).not.toHaveClass(/diff-line-(add|remove)/); // +++ b/example.js
  await expect(lines.nth(2)).toHaveClass(/diff-line-remove/); // -old line
  await expect(lines.nth(3)).toHaveClass(/diff-line-add/); // +new line

  await expect(lines.nth(2)).toHaveCSS('background-color', 'rgba(248, 81, 73, 0.15)');
  await expect(lines.nth(3)).toHaveCSS('background-color', 'rgba(46, 160, 67, 0.15)');
});
