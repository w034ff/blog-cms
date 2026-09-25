import { test, expect, type Page } from '@playwright/test';
import { caret, docString } from './editor-probe';
import { loadMarkdown, selectNode, setRange } from './editor-authoring';

// A cell is `paragraph+` (ParagraphTableCell, table-extensions.ts), so pasting another block into
// one splits the table around it, the second half headerless. tableCellPasteGuard refuses and
// raises the notice. **The predicate is the slice, not the position**: a caret is always in a
// cell's paragraph, so a position test guards nothing, and the ordinary-paste tests below hold that
// line. The drop path asks the same question (table-drop-guard.spec.ts), except that a table-carrying
// paste belongs to prosemirror-tables' handlePaste and a dropped one to nobody (table-cell-rules.ts).

const MD = [
  '| 見出しA | 見出しB |',
  '| --- | --- |',
  '| セルの中身 | 二つ目 |',
  '',
  '> [!NOTE]',
  '>',
  '> 囲みの中身です',
  '',
  '> 引用の中身です',
  '',
  '```ts',
  'const x = 1;',
  '```',
  '',
  '![alt](/uploads/x.png)',
  '',
  '- 箇条書きの項目',
  '',
  '一つ目の段落です',
  '',
  '二つ目の段落です',
  '',
].join('\n');

// Worded for both gestures; the drop guard raises it too.
const NOTICE = '表のセルにはこの要素を入れられません';

async function openEditor(page: Page): Promise<void> {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, MD);
}

// The middle of 「セルの中身」, as reported: a regression visibly halves the text.
function bodyCellMiddle(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as Element & {
      editor?: { state: { doc: { descendants(f: (n: unknown, pos: number) => void): void } } };
    };
    let at: number | null = null;
    el.editor!.state.doc.descendants((node, pos) => {
      const n = node as { type: { name: string }; textContent: string };
      if (at === null && n.type.name === 'tableCell') {
        at = pos + 2 + Math.floor(n.textContent.length / 2);
      }
    });
    if (at === null) throw new Error('no body cell');
    return at;
  });
}

async function copyNodeThenPasteIntoCell(page: Page, typeName: string): Promise<void> {
  await selectNode(page, typeName);
  await page.keyboard.press('Control+c');
  await setRange(page, await bodyCellMiddle(page));
  await page.keyboard.press('Control+v');
}

// Every block a cell cannot hold. `image` has no text to keep, which rules out repairing instead.
for (const typeName of ['callout', 'blockquote', 'codeBlock', 'image'] as const) {
  test(`pasting a ${typeName} into a table cell is refused`, async ({ page }) => {
    await openEditor(page);
    const editor = page.locator('.ProseMirror');
    const before = await docString(page);

    await copyNodeThenPasteIntoCell(page, typeName);

    // Whole: one table, two rows, four cells, text uncut.
    await expect(editor.locator('table')).toHaveCount(1);
    await expect(editor.locator('tr')).toHaveCount(2);
    await expect(editor.locator('th,td')).toHaveCount(4);
    expect(await docString(page)).toBe(before);
    // A refusal changes nothing, so the notice is the only feedback.
    await expect(page.getByRole('status')).toHaveText(NOTICE);
  });
}

test('a bullet list is refused too, though it has no drag handle', async ({ page }) => {
  await openEditor(page);
  const editor = page.locator('.ProseMirror');
  const before = await docString(page);

  // Any block a cell cannot hold, not only those with a drag handle: a list split it too.
  await copyNodeThenPasteIntoCell(page, 'bulletList');

  await expect(editor.locator('table')).toHaveCount(1);
  expect(await docString(page)).toBe(before);
  await expect(page.getByRole('status')).toHaveText(NOTICE);
});

// Ordinary pastes into a cell still land: a position-keyed guard would break these.
async function copyRangeThenPasteIntoCell(
  page: Page,
  pick: (paragraphs: { from: number; to: number }[]) => { from: number; to: number },
): Promise<void> {
  const paragraphs = await page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as Element & {
      editor?: { state: { doc: { descendants(f: (n: unknown, pos: number) => void): void } } };
    };
    const found: { from: number; to: number }[] = [];
    el.editor!.state.doc.descendants((node, pos) => {
      const n = node as { type: { name: string }; textContent: string };
      if (n.type.name === 'paragraph' && n.textContent.endsWith('の段落です')) {
        found.push({ from: pos + 1, to: pos + 1 + n.textContent.length });
      }
    });
    return found;
  });
  const { from, to } = pick(paragraphs);
  await setRange(page, from, to);
  await page.keyboard.press('Control+c');
  await setRange(page, await bodyCellMiddle(page));
  await page.keyboard.press('Control+v');
}

test('pasting plain text into a cell still works', async ({ page }) => {
  await openEditor(page);
  const editor = page.locator('.ProseMirror');

  await copyRangeThenPasteIntoCell(page, ([first]) => ({ from: first.from, to: first.from + 3 }));

  await expect(editor.locator('table')).toHaveCount(1);
  expect(await docString(page)).toContain('tableCell(paragraph("セル一つ目の中身"))');
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('pasting a whole paragraph into a cell still works', async ({ page }) => {
  await openEditor(page);
  const editor = page.locator('.ProseMirror');

  await copyRangeThenPasteIntoCell(page, ([first]) => first);

  await expect(editor.locator('table')).toHaveCount(1);
  expect(await docString(page)).toContain('tableCell(paragraph("セル一つ目の段落ですの中身"))');
  await expect(page.getByRole('status')).toHaveCount(0);
});

// Wait for a click to reach state (the 20ms sync). A Ctrl+V sooner met the old CellSelection, and
// prosemirror-tables' handlePaste (`sel instanceof CellSelection`) wrote the copied cells over
// themselves: an unchanged document that read as a lost paste. The state caret, which names the
// cell, converged in 6-112ms, so no flat wait would do.
function caretInBodyCell(page: Page, text: string): Promise<void> {
  return expect.poll(() => caret(page)).toMatch(new RegExp(`^${text}@`));
}

// Table content is exempt: prosemirror-tables' handlePaste owns cell-to-cell paste, and a
// CellSelection copies as a `table` slice, which a blanket block refusal would catch. The click is
// this file's only pointer-then-paste coverage.
test('cell-to-cell copy/paste inside a table still works', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, '| A | B |\n| --- | --- |\n| c1 | c2 |\n| d1 | d2 |\n');

  const c1 = await editor.getByText('c1').boundingBox();
  const c2 = await editor.getByText('c2').boundingBox();
  const d1 = await editor.getByText('d1').boundingBox();
  if (!c1 || !c2 || !d1) throw new Error('missing boxes');
  // Two body cells: a CellSelection.
  await page.mouse.move(c1.x + 5, c1.y + c1.height / 2);
  await page.mouse.down();
  await page.mouse.move(c2.x + 5, c2.y + c2.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press('Control+c');
  await page.mouse.click(d1.x + 5, d1.y + d1.height / 2);
  await caretInBodyCell(page, 'd1');
  await page.keyboard.press('Control+v');

  await expect(page.getByRole('status')).toHaveCount(0);
  expect(await docString(page)).toBe(
    'doc(table(tableRow(tableHeader(paragraph("A")), tableHeader(paragraph("B"))), ' +
      'tableRow(tableCell(paragraph("c1")), tableCell(paragraph("c2"))), ' +
      'tableRow(tableCell(paragraph("c1")), tableCell(paragraph("c2")))), paragraph)',
  );
});

// Not refused: these keep the table whole, and tablePasteRepair restores the pipe form after
// (table-pipe-form.spec.ts). Two rules, so pinned in both files.
test('a whole table pasted into a cell is not refused by this guard', async ({ page }) => {
  await openEditor(page);
  const editor = page.locator('.ProseMirror');

  await copyNodeThenPasteIntoCell(page, 'table');

  await expect(editor.locator('table')).toHaveCount(1);
  await expect(page.getByRole('status')).toHaveCount(0);
  // The copied header row is demoted: one header row, as isPipeTable accepts.
  expect(await docString(page)).toContain(
    'tableRow(tableHeader(paragraph("見出しA")), tableHeader(paragraph("見出しB"))), ' +
      'tableRow(tableCell(paragraph("見出しA")), tableCell(paragraph("見出しB")))',
  );
});

test('a two-paragraph paste is not refused by this guard', async ({ page }) => {
  await openEditor(page);
  const editor = page.locator('.ProseMirror');

  await copyRangeThenPasteIntoCell(page, ([first, second]) => ({
    from: first.from,
    to: second.to,
  }));

  await expect(editor.locator('table')).toHaveCount(1);
  await expect(page.getByRole('status')).toHaveCount(0);
  // Joined by the hard break Shift+Enter would make.
  expect(await docString(page)).toContain(
    'tableCell(paragraph("セル一つ目の段落です", hardBreak, "二つ目の段落ですの中身"))',
  );
});
