import { test, expect, type Page, type Locator } from '@playwright/test';
import { cdpNativeDrag, dragSelect, type Point } from './native-drag';
import { docString, markdown } from './editor-probe';
import { loadMarkdown } from './editor-authoring';

// Drops into a table (tableDropGuard, components/editor/table-extensions.ts, from 88f1686):
//   1. in the table but not a cell: the slice fills a stray cell and fixTables adds a row/column;
//   2. in a cell at block level: a second paragraph, forcing the table out of GFM pipe form.
// handleDrop fires only on a native `drop`: CDP via e2e/native-drag.ts.

// The first table's shape: case 1 grows it, case 2 adds a second <p> to a cell.
async function tableShape(page: Page) {
  const editor = page.locator('.ProseMirror');
  const columns = await editor.locator('tr').first().locator('th,td').count();
  const rows = await editor.locator('tr').count();
  const cells = await editor.locator('th,td').count();
  const maxParagraphsPerCell = await editor
    .locator('th,td')
    .evaluateAll((cellEls) => Math.max(0, ...cellEls.map((c) => c.querySelectorAll('p').length)));
  return { columns, rows, cells, maxParagraphsPerCell };
}

// A "DRAGME" paragraph above a fresh 3×3 table, selected; returns the drag start.
async function seedTableAndSelectSource(page: Page): Promise<{ editor: Locator; source: Point }> {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  // Enter first, so insertTable lands in the empty paragraph below "DRAGME".
  await page.keyboard.type('DRAGME');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '表', exact: true }).click();
  await page.getByRole('button', { name: '3行3列の表を挿入' }).click();
  await expect(editor.locator('table')).toBeVisible();
  await expect(editor.locator('table').getByText('DRAGME')).toHaveCount(0);

  // Select the word (dragstart needs a live selection) by keyboard: the table's BubbleMenu covers
  // "DRAGME" while the caret is in a cell; ArrowUp leaves the table and hides it.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  const box = await editor.getByText('DRAGME', { exact: true }).boundingBox();
  if (!box) throw new Error('source text not found');
  return { editor, source: { x: box.x + box.width / 2, y: box.y + box.height / 2 } };
}

// prosemirror-dropcursor's indicator, block or inline.
const DROP_CURSOR = '.prosemirror-dropcursor-block, .prosemirror-dropcursor-inline';

// Shared with the paste guard: one rule about what a cell may hold.
const NOTICE = '表のセルにはこの要素を入れられません';

const TABLE_MD = '| 見出しA | 見出しB |\n| --- | --- |\n| セルの中身 | 二つ目 |';

// `block` between a paragraph and a table; selecting into it puts the block in the slice, the same
// shape a copy makes, so paste and drop must agree.
const BLOCKS = {
  blockquote: { block: '> 引用の中身です', text: '引用の中身です' },
  // Isolating: isolating-boundary.ts performs such a drop itself, before this guard; without its
  // fall-through the drag split the table while the paste was refused.
  codeBlock: { block: '```ts:a.ts\nconst x = 1;\n```', text: 'const x = 1;' },
  bulletList: { block: '- 箇条書きの項目', text: '箇条書きの項目' },
} as const;

async function openWithBlockAbove(page: Page, block: string): Promise<Locator> {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, `前の段落です\n\n${block}\n\n${TABLE_MD}`);
  return editor;
}

// Inside the cell's text, so the slice is refused, not the position (case 2).
async function bodyCellText(editor: Locator): Promise<Point> {
  const cell = await editor.getByText('セルの中身').boundingBox();
  if (!cell) throw new Error('body cell not found');
  return { x: cell.x + cell.width / 2, y: cell.y + cell.height / 2 };
}

// A cell is `paragraph+`, so a dropped block tears the table in two around it, emptying a cell and
// leaving a headerless fragment saved as raw HTML; tableCellPasteGuard's refusal, by drop.
for (const [name, { block, text }] of Object.entries(BLOCKS)) {
  test(`dropping a ${name} into a cell's text is refused`, async ({ page }) => {
    const editor = await openWithBlockAbove(page, block);
    const before = await docString(page);

    const above = await editor.getByText('前の段落です').boundingBox();
    const inside = await editor.getByText(text).boundingBox();
    if (!above || !inside) throw new Error('missing boxes');
    const dragFrom = await dragSelect(
      page,
      { x: above.x + 10, y: above.y + above.height / 2 },
      { x: inside.x + 20, y: inside.y + inside.height / 2 },
    );

    await cdpNativeDrag(page, dragFrom, await bodyCellText(editor), async () => {
      // Refused before release: no indicator.
      await expect(page.locator(DROP_CURSOR)).toHaveCount(0);
    });

    // A no-op: the source is not deleted either, so the whole document is the assertion.
    expect(await docString(page)).toBe(before);
    expect(await markdown(page)).not.toContain('<table');
    await expect(page.getByRole('status')).toHaveText(NOTICE);
  });
}

// A whole table: prosemirror-tables' handlePaste merges pasted tables cell-wise but hooks no drop, so
// a dropped table tore the host like any block.
test('dropping a whole table into a cell is refused', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(
    page,
    `${TABLE_MD}\n\n前の段落です\n\n| 別A | 別B |\n| --- | --- |\n| 別セル | 別二 |\n\n後の段落です`,
  );
  const before = await docString(page);

  // From above the second table to below it: the whole node in the slice.
  const above = await editor.getByText('前の段落です').boundingBox();
  const below = await editor.getByText('後の段落です').boundingBox();
  if (!above || !below) throw new Error('missing boxes');
  const dragFrom = await dragSelect(
    page,
    { x: above.x + 10, y: above.y + above.height / 2 },
    { x: below.x + 40, y: below.y + below.height / 2 },
  );

  await cdpNativeDrag(page, dragFrom, await bodyCellText(editor));

  expect(await docString(page)).toBe(before);
  expect(await markdown(page)).not.toContain('<table');
  await expect(page.getByRole('status')).toHaveText(NOTICE);
});

// A callout, then a paragraph, so a selection can be inside the box or past it: two slices that
// contain a callout and need different answers.
const CALLOUT_MD = `前の段落です\n\n> [!NOTE]\n>\n> 囲みの中身です\n\n間の段落です\n\n${TABLE_MD}`;

// Open on both sides, only the text is placed (slice-placement.ts), so it lands.
test('text dragged from inside a callout into a cell still lands', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, CALLOUT_MD);
  const before = await docString(page);

  const inside = await editor.locator('.markdown-alert p').last().boundingBox();
  if (!inside) throw new Error('missing box');
  const dragFrom = await dragSelect(
    page,
    { x: inside.x + 4, y: inside.y + inside.height / 2 },
    { x: inside.x + 40, y: inside.y + inside.height / 2 },
  );

  await cdpNativeDrag(page, dragFrom, await bodyCellText(editor), async () =>
    expect(page.locator(DROP_CURSOR)).toHaveCount(1),
  );

  const after = await docString(page);
  expect(after, after).not.toBe(before);
  // Text: one callout, a four-cell pipe table.
  await expect(editor.locator('.markdown-alert')).toHaveCount(1);
  await expect(editor.locator('table')).toHaveCount(1);
  await expect(editor.locator('th,td')).toHaveCount(4);
  expect(await markdown(page)).not.toContain('<table');
  await expect(page.getByRole('status')).toHaveCount(0);
});

// Covered end to end, the callout is closed in the slice and would be placed: refused.
test('a whole callout dragged into a cell is refused', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, CALLOUT_MD);
  const before = await docString(page);

  const above = await editor.getByText('前の段落です').boundingBox();
  const between = await editor.getByText('間の段落です').boundingBox();
  if (!above || !between) throw new Error('missing boxes');
  const dragFrom = await dragSelect(
    page,
    { x: above.x + 10, y: above.y + above.height / 2 },
    { x: between.x + 40, y: between.y + between.height / 2 },
  );

  await cdpNativeDrag(page, dragFrom, await bodyCellText(editor));

  expect(await docString(page)).toBe(before);
  await expect(page.getByRole('status')).toHaveText(NOTICE);
});

// Ordinary text still lands in a cell, the indicator shows first, and the pipe form stays.
test('plain text can still be dragged into a cell', async ({ page }) => {
  const editor = await openWithBlockAbove(page, '> 引用の中身です');
  const before = await docString(page);

  const above = await editor.getByText('前の段落です').boundingBox();
  if (!above) throw new Error('missing box');
  const dragFrom = await dragSelect(
    page,
    { x: above.x + 2, y: above.y + above.height / 2 },
    { x: above.x + 40, y: above.y + above.height / 2 },
  );

  await cdpNativeDrag(page, dragFrom, await bodyCellText(editor), async () =>
    expect(page.locator(DROP_CURSOR)).toHaveCount(1),
  );

  const after = await docString(page);
  expect(after, after).not.toBe(before);
  await expect(editor.locator('table')).toHaveCount(1);
  await expect(editor.locator('th,td')).toHaveCount(4);
  expect(await markdown(page)).not.toContain('<table');
});

// Case 1: the seam between the header row and the first body row.
test('a native drop at a table cell/row boundary does not grow the table', async ({ page }) => {
  const { editor, source } = await seedTableAndSelectSource(page);

  const before = await tableShape(page);
  expect(before.columns).toBe(3);
  expect(before.maxParagraphsPerCell).toBe(1);

  const headerBox = await editor.locator('th').first().boundingBox();
  if (!headerBox) throw new Error('table header cell not found');
  await cdpNativeDrag(page, source, {
    x: headerBox.x + headerBox.width / 2,
    y: headerBox.y + headerBox.height, // the header/body row boundary
  });

  // Cancelled: same shape, and the source stays (a cancelled drop does not delete it).
  expect(await tableShape(page)).toEqual(before);
  await expect(editor.getByText('DRAGME', { exact: true })).toBeVisible();
});

// Case 2: a cell's top edge, at block level; a second <p> (tableShape's maxParagraphsPerCell) would
// push the table to HTML.
test('a native drop at a cell block edge does not add a second paragraph', async ({ page }) => {
  const { editor, source } = await seedTableAndSelectSource(page);

  const before = await tableShape(page);
  expect(before.columns).toBe(3);
  expect(before.maxParagraphsPerCell).toBe(1);

  const cellBox = await editor.locator('td').first().boundingBox();
  if (!cellBox) throw new Error('table body cell not found');
  await cdpNativeDrag(page, source, {
    x: cellBox.x + cellBox.width / 2,
    y: cellBox.y + 3, // the cell's top block edge, above its paragraph's text
  });

  // Cancelled: one paragraph per cell, the source in place.
  expect(await tableShape(page)).toEqual(before);
  await expect(editor.getByText('DRAGME', { exact: true })).toBeVisible();
});
