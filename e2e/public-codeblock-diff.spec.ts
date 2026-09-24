import { test, expect } from '@playwright/test';
import { expectAutosaved, expectPublished, ensureCategory } from './editor-authoring';
import { gotoPublished } from './published-post';

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

  // Regression guard: a bare ```diff (no `_<lang>`) must still highlight via Shiki's own `diff`
  // grammar, not fall back to plaintext — lib/rehype-code-filename.ts has to rewrite the class
  // back to `language-diff` in this no-real-language case specifically, or the grammar's
  // markup.inserted/deleted scopes (which give +/- lines this token *foreground* color, on top
  // of the *background* this spec already checked above) are silently lost.
  await expect(lines.nth(2).locator('span').first()).toHaveCSS('color', 'rgb(179, 29, 40)');
  await expect(lines.nth(3).locator('span').first()).toHaveCSS('color', 'rgb(34, 134, 58)');
});

// ```diff_<lang> (lib/rehype-code-filename.ts splits the `diff_` prefix back out to the real
// language) layers the diff row/text coloring on top of real Shiki syntax highlighting for that
// language — the `diff` flag now lives in the fence's meta string, not the Shiki language.
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

  // Shiki's `ts` grammar tokenizes a line into several per-token spans (keyword, identifier,
  // operator, …); a bare `diff` fence's grammar only marks whole +/- lines, with no such
  // per-token spans inside. More than one span per line confirms real TS syntax highlighting is
  // active on top of the diff coloring, not just the diff grammar.
  expect(await lines.nth(0).locator('span').count()).toBeGreaterThan(1);
  expect(await lines.nth(1).locator('span').count()).toBeGreaterThan(1);
});
