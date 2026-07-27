import { test, expect } from '@playwright/test';
import { docString } from './editor-probe';
import { loadMarkdown, selectInside } from './editor-authoring';

// Converting a code block into a heading or a list destroys it: TipTap's toggleHeading and
// toggleList both run clearNodes() first, so the code becomes prose and the node's language /
// filename attributes are gone, silently. guarded-block-toggles.ts makes both commands refuse
// inside a code block, which greys the toolbar controls out (they read `editor.can()`) and
// covers the keyboard shortcuts too. Browser-only: the guard lives in a command, not the schema.

// The trailing space commits the fence — the input rule requires it (`[\s\n]` in
// code-block-extension.ts). Without it the fence stays literal until the first space *inside* the
// code, which lands a code block with language "jsconst" holding "a = 1;": the assertions below
// still pass, but on a document nobody meant to write.
async function typeCodeBlock(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('```js ');
  await page.keyboard.type('const a = 1;');
}

const LIST_WITH_CODE = '- item\n\n  ```js\n  const a = 1;\n  ```\n';

test('the heading and list controls are disabled inside a code block', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await typeCodeBlock(page);

  await expect(page.getByRole('button', { name: '大見出し' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '小見出し' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'リスト' })).toBeDisabled();
  // The quote button stays live on purpose: wrapping a code block in a blockquote preserves it
  // (`> ```…` is valid markdown), so there is nothing to guard against there.
  await expect(page.getByRole('button', { name: '引用' })).toBeEnabled();
});

test('the heading and list keyboard shortcuts leave a code block intact', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await typeCodeBlock(page);

  // Pin the whole document, not just "contains codeBlock": a fence that fails to commit still
  // produces a code block, just a different one (see typeCodeBlock above).
  const before = await docString(page);
  expect(before).toBe('doc(codeBlock("const a = 1;"), paragraph)');

  await page.keyboard.press('Control+Alt+Digit2'); // 大見出し
  await page.keyboard.press('Control+Alt+Digit3'); // 小見出し
  await page.keyboard.press('Control+Shift+Digit8'); // 箇条書き
  await page.keyboard.press('Control+Shift+Digit7'); // 番号付き

  expect(await docString(page)).toBe(before);
});

// The other half of the guard: it must not reach beyond code blocks. Both controls still work
// from a plain paragraph, by button and by shortcut, and the heading levels stay capped at 2/3
// (the post title is the page's only H1) now that Heading is configured in PostEditor's own
// extension list rather than through StarterKit.
test('headings and lists still work outside a code block', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.keyboard.type('plain');
  await page.getByRole('button', { name: '大見出し' }).click();
  expect(await docString(page)).toContain('heading("plain")');

  await page.goto('/admin/posts/new');
  await editor.click();
  await page.keyboard.type('plain');
  await page.getByRole('button', { name: 'リスト' }).click();
  await page.getByRole('button', { name: '箇条書き' }).click();
  expect(await docString(page)).toContain('bulletList(listItem(paragraph("plain")))');

  await page.goto('/admin/posts/new');
  await editor.click();
  await page.keyboard.type('## via markdown');
  expect(await docString(page)).toContain('heading("via markdown")');

  // `# ` stays literal: H1 is not among the configured levels.
  await page.goto('/admin/posts/new');
  await editor.click();
  await page.keyboard.type('# not a heading');
  expect(await docString(page)).toContain('paragraph("# not a heading")');
});

// A selection that only *reaches into* a code block used to slip past the guard: isActive
// requires the matching nodes to cover the whole range, so it reported false for a mixed
// selection and clearNodes shredded the block anyway (Mod-a then 大見出し was enough). The guard
// scans the selected range instead, so the refusal holds here too.
test('a selection spanning a paragraph and a code block leaves the code block intact', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.keyboard.type('前の段落');
  await page.keyboard.press('Enter');
  await page.keyboard.type('```js '); // trailing space commits the fence
  await page.keyboard.type('const a = 1;');

  const before = await docString(page);
  expect(before).toBe('doc(paragraph("前の段落"), codeBlock("const a = 1;"), paragraph)');

  await page.keyboard.press('Control+a'); // the whole doc: paragraph + code block
  await expect(page.getByRole('button', { name: '大見出し' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'リスト' })).toBeDisabled();

  // The shortcuts are covered by the same guard, so they can't get past the greyed-out buttons.
  await page.keyboard.press('Control+Alt+Digit2');
  await page.keyboard.press('Control+Shift+Digit8');
  expect(await docString(page)).toBe(before);
});

// The scan must not over-reach either: a multi-block selection with no code block in it still
// converts, so the fix costs nothing for ordinary prose.
test('a selection spanning two paragraphs still becomes two headings', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.keyboard.type('一つ目');
  await page.keyboard.press('Enter');
  await page.keyboard.type('二つ目');

  await page.keyboard.press('Control+a');
  const heading = page.getByRole('button', { name: '大見出し' });
  await expect(heading).toBeEnabled();
  await heading.click();
  // Trailing paragraph: TrailingNode keeps one after the last block.
  expect(await docString(page)).toBe('doc(heading("一つ目"), heading("二つ目"), paragraph)');
});

// The list guard has to be narrower than the heading one, because only one of toggleList's three
// paths destroys anything: a selection already inside a list is lifted out or re-typed in place,
// leaving the children alone. So a list that *contains* a code block must still be un-listable —
// the code block just moves up a level, intact.
test('a list holding a code block can still be un-listed, code block intact', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  await loadMarkdown(page, LIST_WITH_CODE);
  expect(await docString(page)).toBe(
    'doc(bulletList(listItem(paragraph("item"), codeBlock("const a = 1;\\n"))), paragraph)',
  );

  await selectInside(page, 'bulletList');
  const bullet = page.getByRole('button', { name: 'リスト' });
  await expect(bullet).toBeEnabled();
  await bullet.click();
  await page.getByRole('button', { name: '箇条書き' }).click();
  expect(await docString(page)).toBe(
    'doc(paragraph("item"), codeBlock("const a = 1;\\n"), paragraph)',
  );
});

// The other in-place path: switching that same list between 箇条書き and 番号付き only re-types the
// list node, so the code block survives that too.
test('a list holding a code block can still switch to numbered', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  await loadMarkdown(page, LIST_WITH_CODE);
  await selectInside(page, 'bulletList');
  await page.getByRole('button', { name: 'リスト' }).click();
  await page.getByRole('button', { name: '番号付き' }).click();
  expect(await docString(page)).toBe(
    'doc(orderedList(listItem(paragraph("item"), codeBlock("const a = 1;\\n"))), paragraph)',
  );
});

// And the destructive path through the same document is still refused: a select-all takes the
// selection outside the list, so toggleList would clearNodes + wrap rather than lift.
test('a select-all over a list holding a code block is refused', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  await loadMarkdown(page, LIST_WITH_CODE);
  const before = await docString(page);

  await page.keyboard.press('Control+a');
  await expect(page.getByRole('button', { name: 'リスト' })).toBeDisabled();
  await page.keyboard.press('Control+Shift+Digit8');
  expect(await docString(page)).toBe(before);

  // Caret inside the nested code block: the same refusal, by the plain isActive route.
  await selectInside(page, 'codeBlock');
  await expect(page.getByRole('button', { name: 'リスト' })).toBeDisabled();
});
