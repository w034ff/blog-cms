import { test, expect, type Page } from '@playwright/test';
import { docString } from './editor-probe';
import { loadMarkdown, selectNode, setRange } from './editor-authoring';

// A cell is `paragraph+` (ParagraphTableCell in components/editor/table-extensions.ts), so pasting
// any other block into one splits the table in two around it — ProseMirror closes the table before
// the block and opens a fresh, headerless one after. Measured before the guard existed, pasting a
// callout into the body cell 「セルの中身」:
//
//   before  table(row(th, th), row(td("セルの中身"), td("二つ目")))
//   after   table(row(th, th), row(td("セル"), td)), callout(…), table(row(td("の中身"), td("二つ目")))
//
// tableCellPasteGuard refuses those and raises the editor's refusal notice.
//
// The predicate is the *slice*, not the position — which is why this is a separate rule from
// isDisallowedTableDrop rather than the same one reused. A caret always sits inside a cell's
// paragraph, so the position test the drop guard uses reports "allowed" for every paste into a cell
// and would guard nothing. The ordinary-paste tests at the bottom are what hold that line: they are
// the cases a position-based guard would have broken.

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

const NOTICE = '表のセルにはこの要素を貼り付けられません';

async function openEditor(page: Page): Promise<void> {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, MD);
}

// The middle of the body cell 「セルの中身」 — the position the report describes. Start and end
// behave identically; the middle is used because it is the one that visibly cuts the cell's text in
// half when the guard is off, so a regression is unmistakable in the failure output.
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

// Every block a cell cannot hold. `image` is here alongside the three text-bearing ones precisely
// because it is what rules out repairing instead of refusing: it has no text to keep, so no
// unwrap-to-paragraphs rule could cover it.
for (const typeName of ['callout', 'blockquote', 'codeBlock', 'image'] as const) {
  test(`pasting a ${typeName} into a table cell is refused`, async ({ page }) => {
    await openEditor(page);
    const editor = page.locator('.ProseMirror');
    const before = await docString(page);

    await copyNodeThenPasteIntoCell(page, typeName);

    // The table is whole: one table, two rows, four cells, and the cell's own text uncut.
    await expect(editor.locator('table')).toHaveCount(1);
    await expect(editor.locator('tr')).toHaveCount(2);
    await expect(editor.locator('th,td')).toHaveCount(4);
    expect(await docString(page)).toBe(before);
    // A refused paste changes nothing, so the notice is the only feedback there is.
    await expect(page.getByRole('status')).toHaveText(NOTICE);
  });
}

test('a bullet list is refused too, though it has no drag handle', async ({ page }) => {
  await openEditor(page);
  const editor = page.locator('.ProseMirror');
  const before = await docString(page);

  // The rule is "any block a cell can't hold", not "the blocks with a floating handle" — a list
  // has no handle (DRAGGABLE_TYPES in block-drag-handle.ts) and split the table just the same.
  await copyNodeThenPasteIntoCell(page, 'bulletList');

  await expect(editor.locator('table')).toHaveCount(1);
  expect(await docString(page)).toBe(before);
  await expect(page.getByRole('status')).toHaveText(NOTICE);
});

// The other half of the rule, and the one that would break if the guard keyed off position: an
// ordinary paste into a cell must still land.
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

// Table content is exempt from this guard, and both halves of that need pinning.
//
// The half that must keep working: prosemirror-tables' own handlePaste owns cell-to-cell paste,
// which rewrites the target cells in place and stays a clean pipe table. A guard that refused every
// non-paragraph block would have caught this too, because a CellSelection copies as a `table` slice.
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
  // Drag across two body cells — a CellSelection, not a TextSelection.
  await page.mouse.move(c1.x + 5, c1.y + c1.height / 2);
  await page.mouse.down();
  await page.mouse.move(c2.x + 5, c2.y + c2.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press('Control+c');
  await page.mouse.click(d1.x + 5, d1.y + d1.height / 2);
  await page.keyboard.press('Control+v');

  await expect(page.getByRole('status')).toHaveCount(0);
  expect(await docString(page)).toBe(
    'doc(table(tableRow(tableHeader(paragraph("A")), tableHeader(paragraph("B"))), ' +
      'tableRow(tableCell(paragraph("c1")), tableCell(paragraph("c2"))), ' +
      'tableRow(tableCell(paragraph("c1")), tableCell(paragraph("c2")))), paragraph)',
  );
});

// The two pastes this guard deliberately does not refuse. Both keep the table whole — no split —
// and both used to cost it its GFM pipe form on save, which is a milder and separate defect; they
// are repaired after the fact instead, by tablePasteRepair. Here that means only "no notice, and the
// table is still one table": what the repair makes of them, and every case it must not touch, is
// e2e/table-pipe-form.spec.ts. Pinned in both places because they are two rules, not one — the
// exemption is what lets the repair be the thing that answers them.
test('a whole table pasted into a cell is not refused by this guard', async ({ page }) => {
  await openEditor(page);
  const editor = page.locator('.ProseMirror');

  await copyNodeThenPasteIntoCell(page, 'table');

  await expect(editor.locator('table')).toHaveCount(1);
  await expect(page.getByRole('status')).toHaveCount(0);
  // The copied header row landed in the body and was demoted there, so the table keeps exactly one
  // header row — the shape isPipeTable accepts.
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
  // One paragraph, the two joined by the hard break Shift+Enter would have made by hand.
  expect(await docString(page)).toContain(
    'tableCell(paragraph("セル一つ目の段落です", hardBreak, "二つ目の段落ですの中身"))',
  );
});
