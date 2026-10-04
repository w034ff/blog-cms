import { test, expect, type Page } from '@playwright/test';
import { caret, docString } from './editor-probe';
import { loadMarkdown, selectInside, setRange } from './editor-authoring';

// toggleHeading and toggleList run clearNodes() first, silently turning code into prose and losing
// language and filename. guarded-block-toggles.ts refuses inside a code block, greying the toolbar
// (it reads `editor.can()`) and covering the shortcuts.

// The trailing space commits the fence (`[\s\n]`, code-block-extension.ts); without it the first
// space inside the code does, producing language "jsconst", and the tests pass on the wrong document.
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
  // The quote stays live: `> ```…` preserves the block.
  await expect(page.getByRole('button', { name: '引用' })).toBeEnabled();
});

test('the heading and list keyboard shortcuts leave a code block intact', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await typeCodeBlock(page);

  // The whole document: an uncommitted fence still makes some code block.
  const before = await docString(page);
  expect(before).toBe('doc(codeBlock("const a = 1;"), paragraph)');

  await page.keyboard.press('Control+Alt+Digit2'); // 大見出し
  await page.keyboard.press('Control+Alt+Digit3'); // 小見出し
  await page.keyboard.press('Control+Shift+Digit8'); // 箇条書き
  await page.keyboard.press('Control+Shift+Digit7'); // 番号付き

  expect(await docString(page)).toBe(before);
});

// Outside a code block both still work, by button and shortcut, with headings capped at 2/3 (the
// title is the page's H1), configured in PostEditor's extension list.
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

  // `# ` stays literal: no H1.
  await page.goto('/admin/posts/new');
  await editor.click();
  await page.keyboard.type('# not a heading');
  expect(await docString(page)).toContain('paragraph("# not a heading")');
});

// A selection reaching into a code block passed `isActive` (it needs full coverage) and clearNodes
// shredded the block; the guard scans the range.
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

  // The shortcuts share the guard.
  await page.keyboard.press('Control+Alt+Digit2');
  await page.keyboard.press('Control+Shift+Digit8');
  expect(await docString(page)).toBe(before);
});

// No over-reach: two paragraphs still become two headings.
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
  // TrailingNode's paragraph.
  expect(await docString(page)).toBe('doc(heading("一つ目"), heading("二つ目"), paragraph)');
});

// The list guard is narrower: only one of toggleList's paths destroys anything. A selection inside
// a list lifts or re-types in place, so a list holding a code block can be un-listed intact.
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

// Switching between 箇条書き and 番号付き only re-types the list.
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

// A select-all leaves the list, so toggleList would clearNodes and wrap: refused.
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

  // Caret in the nested block: refused by plain isActive.
  await selectInside(page, 'codeBlock');
  await expect(page.getByRole('button', { name: 'リスト' })).toBeDisabled();
});

// A list item (`paragraph block*`) may hold a code block from its second child on, but every route
// converted the caret's paragraph, refused on the first one: `/` offered nothing and Mod-Alt-c
// lifted the item out. insertCodeBlock (code-block-extension.ts) converts where legal, else adds the
// block as the item's next child.
async function caretIn(page: Page, text: string, offset: number): Promise<void> {
  const at = await page.evaluate(
    ({ text, offset }) => {
      const el = document.querySelector('.ProseMirror') as Element & {
        editor?: { state: { doc: { descendants(f: (n: unknown, p: number) => void): void } } };
      };
      let pos: number | null = null;
      el.editor!.state.doc.descendants((node, p) => {
        const n = node as { isTextblock: boolean; textContent: string };
        if (pos === null && n.isTextblock && n.textContent === text) pos = p + 1 + offset;
      });
      if (pos === null) throw new Error(`no textblock "${text}"`);
      return pos;
    },
    { text, offset },
  );
  await setRange(page, at);
}

const ITEM_WITH_CODE =
  'doc(bulletList(listItem(paragraph("項目一"), codeBlock), listItem(paragraph("項目二"))), paragraph)';

test('a code block goes inside a list item, by shortcut and by the / menu', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  // At the item's end here and mid-text below: one paragraph and one code block either way.
  // insertContentAt targets past the textblock, so the paragraph is not split.
  await loadMarkdown(page, '- 項目一\n- 項目二\n');
  await caretIn(page, '項目一', 3);
  await page.keyboard.press('Control+Alt+c');
  expect(await docString(page)).toBe(ITEM_WITH_CODE);
  // The caret is in the new block, ready for code.
  expect(await caret(page)).toBe('@0');
  await page.keyboard.type('const x = 1;');
  expect(await docString(page)).toContain('codeBlock("const x = 1;")');

  await loadMarkdown(page, '- 項目一\n- 項目二\n');
  await caretIn(page, '項目一', 1);
  await page.keyboard.press('Control+Alt+c');
  expect(await docString(page)).toBe(ITEM_WITH_CODE);

  // `/` offers the row now, with the same result.
  await loadMarkdown(page, '- 項目一\n- 項目二\n');
  await caretIn(page, '項目一', 0); // the menu's trigger is startOfLine
  await page.keyboard.type('/');
  const row = page.getByRole('button', { name: 'コードブロック' });
  await expect(row).toBeVisible();
  await row.click();
  expect(await docString(page)).toBe(ITEM_WITH_CODE);
});

test('insertCodeBlock leaves the contexts that refuse a code block alone', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  // A plain paragraph still converts in place.
  await loadMarkdown(page, '本文です\n');
  await caretIn(page, '本文です', 2);
  await page.keyboard.press('Control+Alt+c');
  expect(await docString(page)).toContain('codeBlock("本文です")');

  // Inside a fence the shortcut still toggles out, the only keyboard way; only creation is rerouted.
  await loadMarkdown(page, '```ts\nconst x = 1;\n```\n');
  await caretIn(page, 'const x = 1;\n', 3);
  await page.keyboard.press('Control+Alt+c');
  expect(await docString(page)).not.toContain('codeBlock');

  // A cell is `paragraph+`, and a code block there has no pipe form: the shortcut does nothing and
  // `/` stays a character (slash-command.ts).
  await loadMarkdown(page, '| A | B |\n| --- | --- |\n| c1 | c2 |\n');
  const before = await docString(page);
  await caretIn(page, 'c1', 2);
  await page.keyboard.press('Control+Alt+c');
  expect(await docString(page)).toBe(before);
  await caretIn(page, 'c1', 0);
  await page.keyboard.type('/');
  expect(await docString(page)).toContain('tableCell(paragraph("/c1"))');
  await expect(page.getByRole('button', { name: 'コードブロック' })).toHaveCount(0);
});
