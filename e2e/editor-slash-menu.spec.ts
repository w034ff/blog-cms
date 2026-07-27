import { test, expect } from '@playwright/test';

// The `/` slash menu (components/editor/slash-command.ts) is built on the official
// @tiptap/suggestion utility with a custom popup (SlashList). Browser-only: the suggestion
// trigger, the floating popup, and the block-insert commands only run in the editor.
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

  // Choosing 警告 inserts a warning callout and removes the typed `/`.
  await menu.getByRole('button', { name: '警告' }).click();
  await expect(editor.locator('div.markdown-alert.markdown-alert-warning')).toBeVisible();
  await expect(editor).not.toContainText('/');
});

test('the slash menu inserts a code block', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  // `code` matches コードブロック only (no callout carries it), so the list narrows to one row.
  await page.keyboard.type('/code');
  const menu = page.locator('[data-slash-menu]');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button')).toHaveCount(1);
  await expect(menu).toContainText('コードブロック');

  await page.keyboard.press('Enter');
  // The code block's NodeView wrapper (its language <select>/filename chrome) confirms insertion.
  await expect(editor.locator('.code-block')).toBeVisible();
  await expect(editor).not.toContainText('/');
});

test('the slash menu filters by query and inserts with Enter', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  // `danger` is the keyword for 警告 only.
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

// The menu only offers rows whose command can actually run where the caret is
// (slash-command.ts asks each row via `editor.can()`). setCallout refuses inside a quote —
// a blockquote is someone else's words, a callout the author's own aside — so the three
// 囲み枠 rows drop there while コードブロック stays, since a fenced block nests fine in a
// quote. Browser-only: the availability check reads the live editor state.
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
  await expect(menu.getByRole('button')).toHaveCount(1);
  await expect(menu.getByRole('button')).toHaveText('コードブロック');
});

// The same check must not hide the rows where setCallout *does* work. Inside an existing
// callout it switches that callout's type in place, so all three stay offered.
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
  await expect(menu.getByRole('button')).toHaveCount(4); // 3 callout types + code block
});

// The `/` trigger is gated off inside a code block (slash-command.ts's `allow`): with
// `startOfLine` the trigger sits exactly where `// comment`, `</div>` and a leading path
// begin, so the menu would pop up over ordinary code. `/` must stay a plain character
// there, matching the block markdown shortcuts, which ProseMirror already leaves literal
// inside a `code` textblock.
test('the slash menu never opens inside a code block', async ({ page }) => {
  await page.goto('/admin/posts/new');

  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.keyboard.type('```js '); // trailing space commits the fence
  await expect(editor.locator('.code-block')).toBeVisible();

  await page.keyboard.type('// a comment');
  await expect(page.locator('[data-slash-menu]')).toHaveCount(0);
  // The slashes are ordinary text in the code, not a swallowed trigger.
  await expect(editor.locator('.code-block')).toContainText('// a comment');
});

// A table cell is paragraph-only (table-extensions.ts), so neither a callout nor a code block
// fits and every row's `available` predicate is false. The trigger's emptiness test then keeps
// the menu shut rather than opening it on an empty list — before that check it still opened,
// offering コードブロック as a row that did nothing when picked.
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
