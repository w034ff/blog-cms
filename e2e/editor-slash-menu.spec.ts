import { test, expect } from '@playwright/test';

// The `/` menu (slash-command.ts), on @tiptap/suggestion with a custom popup (SlashList).
test('the slash menu opens on `/` and inserts the chosen callout', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  await page.keyboard.type('/');
  const menu = page.locator('[data-slash-menu]');
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('情報');
  await expect(menu).toContainText('警告');
  await expect(menu).toContainText('注意');

  // 警告 inserts a warning callout and removes the `/`.
  await menu.getByRole('button', { name: '警告' }).click();
  await expect(editor.locator('div.markdown-alert.markdown-alert-warning')).toBeVisible();
  await expect(editor).not.toContainText('/');
});

test('the slash menu inserts a code block', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  // `code` matches コードブロック and, through provider keywords (CodeSandbox, CodePen), リンク
  // (embed-requirements.md §24.2). **The declaration order keeps `/code` + Enter usable.**
  await page.keyboard.type('/code');
  const menu = page.locator('[data-slash-menu]');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button')).toHaveText(['コードブロック', 'リンク']);

  await page.keyboard.press('Enter');
  // The NodeView's chrome confirms the insertion.
  await expect(editor.locator('.code-block')).toBeVisible();
  await expect(editor).not.toContainText('/');
});

test('the slash menu filters by query and inserts with Enter', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  // `danger` finds 警告 only.
  await page.keyboard.type('/danger');
  const menu = page.locator('[data-slash-menu]');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button')).toHaveCount(1);
  await expect(menu).toContainText('警告');

  await page.keyboard.press('Enter');
  await expect(editor.locator('div.markdown-alert.markdown-alert-warning')).toBeVisible();
});

test('Escape closes the slash menu without inserting', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  await page.keyboard.type('/');
  const menu = page.locator('[data-slash-menu]');
  await expect(menu).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(editor.locator('div.markdown-alert')).toHaveCount(0);
});

// Rows are offered only where `editor.can()` says so. No callout in a quote; a code block, a card or
// an embed nests fine (`block+`).
test('the slash menu hides the callout rows inside a quote, keeping the code block', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');

  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.keyboard.type('> quoted text');
  await page.keyboard.press('Enter'); // second paragraph, still inside the blockquote
  await page.keyboard.type('/');

  const menu = page.locator('[data-slash-menu]');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button')).toHaveText(['コードブロック', 'リンク']);
});

// Inside a callout setCallout retypes it, so all three stay.
test('the slash menu still offers the callout rows inside an existing callout', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');

  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.getByRole('button', { name: '囲み枠' }).click();
  await page.getByRole('button', { name: '情報', exact: true }).click();
  await page.keyboard.type('/');

  const menu = page.locator('[data-slash-menu]');
  await expect(menu).toBeVisible();
  // 3 callout types + code block + the link/embed row.
  await expect(menu.getByRole('button')).toHaveCount(5);
});

// Gated off in a code block (`allow`): `startOfLine` is where `// comment`, `</div>` and paths
// begin.
test('the slash menu never opens inside a code block', async ({ page }) => {
  await page.goto('/admin/posts/new');

  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.keyboard.type('```js '); // trailing space commits the fence
  await expect(editor.locator('.code-block')).toBeVisible();

  await page.keyboard.type('// a comment');
  await expect(page.locator('[data-slash-menu]')).toHaveCount(0);
  // Ordinary text, not a swallowed trigger.
  await expect(editor.locator('.code-block')).toContainText('// a comment');
});

// A cell is paragraph-only, so every row is unavailable and the menu stays shut rather than
// opening on nothing.
test('the slash menu never opens inside a table cell', async ({ page }) => {
  await page.goto('/admin/posts/new');

  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.getByRole('button', { name: '表', exact: true }).click();
  await page.getByRole('button', { name: '2行2列の表を挿入' }).click();
  await editor.locator('td').first().click();

  await page.keyboard.type('/');
  await expect(page.locator('[data-slash-menu]')).toHaveCount(0);
  await expect(editor.locator('td').first()).toContainText('/');
});
