import { test, expect } from '@playwright/test';
import { expectAutosaved, expectPublished, ensureCategory } from './editor-authoring';
import { gotoPublished } from './published-post';

// ```diff fences get per-line classes (lib/shiki-diff-line-transformer.ts): +/- rows are tinted, a
// +++/--- header is not, as on GitHub.
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

  await expectAutosaved(page);
  await ensureCategory(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);
  await gotoPublished(page);

  const lines = page.locator('[data-rehype-pretty-code-figure] [data-line]');
  await expect(lines).toHaveCount(4);
  await expect(lines.nth(0)).not.toHaveClass(/diff-line-(add|remove)/); // --- a/example.js
  await expect(lines.nth(1)).not.toHaveClass(/diff-line-(add|remove)/); // +++ b/example.js
  await expect(lines.nth(2)).toHaveClass(/diff-line-remove/); // -old line
  await expect(lines.nth(3)).toHaveClass(/diff-line-add/); // +new line

  await expect(lines.nth(2)).toHaveCSS('background-color', 'rgba(248, 81, 73, 0.15)');
  await expect(lines.nth(3)).toHaveCSS('background-color', 'rgba(46, 160, 67, 0.15)');

  // A bare ```diff must keep Shiki's `diff` grammar: lib/rehype-code-filename.ts rewrites the class
  // back to `language-diff`, or the +/- foreground colours are lost.
  await expect(lines.nth(2).locator('span').first()).toHaveCSS('color', 'rgb(179, 29, 40)');
  await expect(lines.nth(3).locator('span').first()).toHaveCSS('color', 'rgb(34, 134, 58)');
});

// ```diff_<lang>: the prefix is split off (lib/rehype-code-filename.ts) and `diff` lives in the meta,
// so diff colouring layers on the language's highlighting.
test('a public ```diff_ts code block highlights TypeScript tokens alongside the +/- rows', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await page.getByLabel('タイトル').fill('Diff language highlight spec');
  await editor.click();
  await page.keyboard.type('```diff_ts ');
  await page.keyboard.type('-const x = 1;');
  await page.keyboard.press('Enter');
  await page.keyboard.type('+const x = 2;');

  await expectAutosaved(page);
  await ensureCategory(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);
  await gotoPublished(page);

  const lines = page.locator('[data-rehype-pretty-code-figure] [data-line]');
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(0)).toHaveClass(/diff-line-remove/);
  await expect(lines.nth(1)).toHaveClass(/diff-line-add/);

  // Several spans per line means real TS highlighting; the bare `diff` grammar marks whole lines.
  expect(await lines.nth(0).locator('span').count()).toBeGreaterThan(1);
  expect(await lines.nth(1).locator('span').count()).toBeGreaterThan(1);
});
