import { test, expect } from '@playwright/test';
import { loadMarkdown, selectInside } from './editor-authoring';
import { markdown, docString, caret } from './editor-probe';

// The accordion's two insertion routes and the one placement rule behind them
// (docs/accordion-requirements.md §6.3, §7). Browser-only: both routes run through the live
// editor, and the menu's own predicate reads editor state.
//
// The placement rule is worth its own coverage because the official setDetails has no such check
// — it inserts wherever `detailsContent` can hold the caret's block range, which includes a table
// cell's paragraph. Without the wrapper in details-extension.ts the menu offers the row there and
// running it splits the table.

const DETAILS = 'div[data-type="details"]';

test('the slash menu inserts an accordion with the caret in its title', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.keyboard.type('/折りたたみ');
  await page.locator('[data-slash-menu]').getByRole('button', { name: '折りたたみ' }).click();

  expect(await docString(page)).toContain('details(detailsSummary, detailsContent(paragraph))');
  await page.keyboard.type('タイトル');
  expect(await caret(page)).toBe('タイトル@4');
  expect(await markdown(page)).toBe('<details>\n<summary>タイトル</summary>\n\n</details>');
});

test('the `:::details ` shortcut converts the line and keeps what follows it', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.keyboard.type(':::details ');
  expect(await docString(page)).toContain('details(detailsSummary, detailsContent(paragraph))');

  // The caret is in the title, as with the menu route.
  await page.keyboard.type('タイトル');
  expect(await markdown(page)).toBe('<details>\n<summary>タイトル</summary>\n\n</details>');
});

test('the shortcut carries text typed after the trigger into the body', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  // Type the tail first, then go back and complete the trigger in front of it.
  await page.keyboard.type(':::details本文');
  for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.type(' ');

  expect(await docString(page)).toContain('detailsContent(paragraph("本文"))');
});

// Every container refuses both routes. The menu hides its row (the predicate asks the wrapped
// command); the input rule declines and leaves the text alone.
const CONTAINERS: Record<string, { source: string; node: string }> = {
  引用: { source: '> 引用文\n', node: 'blockquote' },
  callout: { source: '> [!NOTE]\n>\n> 本文\n', node: 'callout' },
  リスト項目: { source: '- 項目\n', node: 'listItem' },
  アコーディオン: {
    source: '<details>\n<summary>t</summary>\n\n本文\n\n</details>\n',
    node: 'detailsContent',
  },
};

for (const [where, { source, node }] of Object.entries(CONTAINERS)) {
  test(`neither route offers an accordion inside a ${where}`, async ({ page }) => {
    await page.goto('/admin/posts/new');
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();

    await loadMarkdown(page, source);
    // Click first: the selection below is set through the editor's own commands, which does not
    // give the DOM node focus, and without focus the keystrokes go nowhere.
    await editor.click();
    // Place the caret inside the container, then open a fresh empty line there — the input rule
    // needs the trigger at the start of a line, so without one the test would pass vacuously.
    // Programmatic rather than by keyboard: a closed accordion's body is `hidden`, so arrow keys
    // cannot reach it at all.
    await selectInside(page, node);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');

    await page.keyboard.type('/');
    const menu = page.locator('[data-slash-menu]');
    if (await menu.isVisible()) {
      await expect(menu.getByRole('button', { name: '折りたたみ' })).toHaveCount(0);
      await page.keyboard.press('Escape');
    }
    await page.keyboard.type(':::details ');

    // The shortcut stayed literal, and no new accordion exists: the one the アコーディオン case
    // loaded is the only detailsSummary allowed in the document.
    const summaries = (await docString(page)).split('detailsSummary').length - 1;
    expect(summaries).toBe(node === 'detailsContent' ? 1 : 0);
    expect(await docString(page)).toContain(':::details');
  });
}

test('inside a table cell the row is hidden and the table survives', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await loadMarkdown(page, '| a | b |\n| --- | --- |\n| 1 | 2 |\n');
  await editor.locator('td').first().click();

  const before = await markdown(page);
  await page.keyboard.type('/');
  const menu = page.locator('[data-slash-menu]');
  if (await menu.isVisible()) {
    await expect(menu.getByRole('button', { name: '折りたたみ' })).toHaveCount(0);
    await page.keyboard.press('Escape');
  }

  expect(await editor.locator(DETAILS).count()).toBe(0);
  expect(await markdown(page)).toContain('| a | b |');
  expect(before).toContain('| a | b |');
});
