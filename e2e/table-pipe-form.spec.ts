import { test, expect, type Page } from '@playwright/test';
import { docString, historyState, markdown } from './editor-probe';
import { closeHistory, loadMarkdown, selectNode, setRange } from './editor-authoring';
import { cdpNativeDrag, dragSelect } from './native-drag';

// A cell paste could leave a table with no GFM pipe form, silently saved as raw HTML: alignment
// (the fallback's inline `text-align` is sanitized away), `<thead>` and hand-editability lost.
// Route A: multiple paragraphs in a cell. Route B: a whole table pasted into a cell, which
// prosemirror-tables merges cell-wise, landing a `th` row in the body. tablePasteRepair
// (table-extensions.ts) normalizes after the paste, since B is prosemirror-tables' own handlePaste.
// The markdown is asserted: it is what the defect was about.

const ALIGNED = [
  '| 見出しA | 見出しB |',
  '| :-: | --- |',
  '| セルの中身 | 二つ目 |',
  '',
  '一つ目の段落です',
  '',
  '二つ目の段落です',
  '',
].join('\n');

async function openEditor(page: Page, md: string): Promise<void> {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, md);
}

// A caret in the first `typeName` cell by raw position: a key right after setRange can act on the
// old caret (20ms sync). 'middle' visibly halves the cell's text, as in the report.
function cellCaret(
  page: Page,
  where: 'middle' | 'end',
  typeName: 'tableCell' | 'tableHeader' = 'tableCell',
): Promise<number> {
  return page.evaluate(
    ({ at, typeName }) => {
      const el = document.querySelector('.ProseMirror') as Element & {
        editor?: { state: { doc: { descendants(f: (n: unknown, pos: number) => void): void } } };
      };
      if (!el?.editor) throw new Error('no live editor on .ProseMirror');
      let found: number | null = null;
      el.editor.state.doc.descendants((node, pos) => {
        const n = node as { type: { name: string }; textContent: string };
        if (found !== null || n.type.name !== typeName) return;
        const length = at === 'end' ? n.textContent.length : Math.floor(n.textContent.length / 2);
        // +1 into the cell, +1 into its paragraph.
        found = pos + 2 + length;
      });
      if (found === null) throw new Error(`no ${typeName}`);
      return found;
    },
    { at: where, typeName },
  );
}

// The outside-a-table control for the Enter binding.
function posInParagraph(page: Page, text: string, chars: number): Promise<number> {
  return page.evaluate(
    ({ line, offset }) => {
      const el = document.querySelector('.ProseMirror') as Element & {
        editor?: { state: { doc: { descendants(f: (n: unknown, pos: number) => void): void } } };
      };
      if (!el?.editor) throw new Error('no live editor on .ProseMirror');
      let found: number | null = null;
      el.editor.state.doc.descendants((node, pos) => {
        const n = node as { type: { name: string }; textContent: string };
        if (found === null && n.type.name === 'paragraph' && n.textContent === line)
          found = pos + 1;
      });
      if (found === null) throw new Error(`no paragraph reading ${line}`);
      return found + offset;
    },
    { line: text, offset: chars },
  );
}

// Route A: copy two paragraphs (Shift+Enter would stay one) into a cell.
async function pasteTwoParagraphsIntoCell(
  page: Page,
  typeName: 'tableCell' | 'tableHeader' = 'tableCell',
): Promise<void> {
  const paragraphs = await page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as Element & {
      editor?: { state: { doc: { descendants(f: (n: unknown, pos: number) => void): void } } };
    };
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    const found: { from: number; to: number }[] = [];
    el.editor.state.doc.descendants((node, pos) => {
      const n = node as { type: { name: string }; textContent: string };
      if (n.type.name === 'paragraph' && n.textContent.endsWith('の段落です')) {
        found.push({ from: pos + 1, to: pos + 1 + n.textContent.length });
      }
    });
    return found;
  });
  await setRange(page, paragraphs[0].from, paragraphs[paragraphs.length - 1].to);
  await page.keyboard.press('Control+c');
  await setRange(page, await cellCaret(page, 'middle', typeName));
  await page.keyboard.press('Control+v');
}

// Route B: the whole table into one of its cells.
async function pasteWholeTableIntoCell(page: Page): Promise<void> {
  await selectNode(page, 'table');
  await page.keyboard.press('Control+c');
  await setRange(page, await cellCaret(page, 'middle'));
  await page.keyboard.press('Control+v');
}

test('a multi-paragraph paste keeps the table in its pipe form', async ({ page }) => {
  await openEditor(page, ALIGNED);

  await pasteTwoParagraphsIntoCell(page);

  // Joined by a hard break, as Shift+Enter makes: an existing shape.
  expect(await docString(page)).toContain(
    'tableCell(paragraph("セル一つ目の段落です", hardBreak, "二つ目の段落ですの中身"))',
  );
  expect(await markdown(page)).toContain(
    '| 見出しA | 見出しB |\n| :--: | --- |\n| セル一つ目の段落です<br>二つ目の段落ですの中身 | 二つ目 |',
  );
});

// A header cell: `headerBad` rejects multi-block header cells too, but no demotion in row 0.
test('a multi-paragraph paste into a header cell keeps the header a header', async ({ page }) => {
  await openEditor(page, ALIGNED);

  await pasteTwoParagraphsIntoCell(page, 'tableHeader');

  expect(await docString(page)).toContain(
    'tableHeader(paragraph("見出一つ目の段落です", hardBreak, "二つ目の段落ですしA"))',
  );
  expect(await markdown(page)).toContain(
    '| 見出一つ目の段落です<br>二つ目の段落ですしA | 見出しB |\n| :--: | --- |',
  );
});

test('a whole table pasted into a cell keeps the table in its pipe form', async ({ page }) => {
  await openEditor(page, ALIGNED);

  await pasteWholeTableIntoCell(page);

  // The copied header row is demoted: one header row.
  expect(await docString(page)).toContain(
    'tableRow(tableHeader(paragraph("見出しA")), tableHeader(paragraph("見出しB"))), ' +
      'tableRow(tableCell(paragraph("見出しA")), tableCell(paragraph("見出しB")))',
  );
  expect(await markdown(page)).toContain(
    '| 見出しA | 見出しB |\n| :--: | --- |\n| 見出しA | 見出しB |\n| セルの中身 | 二つ目 |',
  );
});

// Dropped: paragraphs are allowed in a cell, so the drop guard lets them in and the repair joins them;
// it listens for `drop` too. Font metrics set the endpoints, so only the shape is asserted.
test('a multi-paragraph drop into a cell keeps the table in its pipe form', async ({ page }) => {
  await openEditor(page, ALIGNED);
  const editor = page.locator('.ProseMirror');
  const first = await editor.getByText('一つ目の段落です').boundingBox();
  const second = await editor.getByText('二つ目の段落です').boundingBox();
  const cell = await editor.getByText('セルの中身').boundingBox();
  if (!first || !second || !cell) throw new Error('missing boxes');

  // dragstart needs a live selection, so it is dragged, not set.
  const from = await dragSelect(
    page,
    { x: first.x + 20, y: first.y + first.height / 2 },
    { x: second.x + 40, y: second.y + second.height / 2 },
  );
  await cdpNativeDrag(page, from, { x: cell.x + cell.width / 2, y: cell.y + cell.height / 2 });

  // One paragraph with a hard break.
  expect(await docString(page)).toMatch(/tableCell\(paragraph\("[^"]*", hardBreak, "[^"]*"\)\)/);
  const md = await markdown(page);
  expect(md).not.toContain('<table');
  expect(md).toContain('| :--: | --- |');
});

// No `<table` reaches storage: the fallback's alignment is sanitized away on the public page.
for (const [name, paste] of [
  ['a multi-paragraph paste', pasteTwoParagraphsIntoCell],
  ['a whole table pasted into a cell', pasteWholeTableIntoCell],
] as const) {
  test(`${name} does not degrade the stored markdown to raw HTML`, async ({ page }) => {
    await openEditor(page, ALIGNED);

    await paste(page);

    expect(await markdown(page)).not.toContain('<table');
  });
}

test('one undo restores the document the paste started from', async ({ page }) => {
  await openEditor(page, ALIGNED);
  const before = await docString(page);
  // Break the history, or Ctrl+Z empties the document (e2e/README.md).
  await closeHistory(page);
  const depthBefore = (await historyState(page)).undoDepth;

  await pasteTwoParagraphsIntoCell(page);
  // The repair is an appendTransaction in the paste's event: one undo, which only a count shows.
  expect((await historyState(page)).undoDepth).toBe(depthBefore + 1);

  await page.keyboard.press('Control+z');
  expect(await docString(page)).toBe(before);
  expect((await historyState(page)).undoDepth).toBe(depthBefore);
});

// The repair's shape survives save and reload.
test('a hard break in a cell round-trips through the pipe form', async ({ page }) => {
  await openEditor(page, '| A | B |\n| --- | --- |\n| x<br>y | z |\n');

  expect(await docString(page)).toContain('tableCell(paragraph("x", hardBreak, "y"))');
  expect(await markdown(page)).toBe('| A | B |\n| --- | --- |\n| x<br>y | z |\n');
});

// Enter in a cell made a second paragraph, with no pipe form. The repair leaves typing alone (it
// would undo every Enter), so MarkdownTable's Enter makes a hard break instead.
test('Enter inside a cell makes a hard break, not a second paragraph', async ({ page }) => {
  await openEditor(page, ALIGNED);

  await setRange(page, await cellCaret(page, 'end'));
  await page.keyboard.press('Enter');
  await page.keyboard.type('二行目');

  expect(await docString(page)).toContain(
    'tableCell(paragraph("セルの中身", hardBreak, "二行目"))',
  );
  const md = await markdown(page);
  expect(md).not.toContain('<table');
  expect(md).toContain('| セルの中身<br>二行目 | 二つ目 |');
});

// Document-wide binding: outside a table Enter still splits.
test('Enter outside a table still splits the paragraph', async ({ page }) => {
  await openEditor(page, ALIGNED);

  await setRange(page, await posInParagraph(page, '一つ目の段落です', 3));
  await page.keyboard.press('Enter');

  expect(await docString(page)).toContain('paragraph("一つ目"), paragraph("の段落です")');
});

// ---------------------------------------------------------------------------
// Must not repair
// ---------------------------------------------------------------------------

// Opening a post stored as HTML must not rewrite it and hand autosave an edit.
test('opening a post already stored as raw HTML changes nothing', async ({ page }) => {
  const html =
    '<table><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr>' +
    '<tr><th><p>c1</p></th><td><p>c2</p><p>二行目</p></td></tr></tbody></table>';
  await openEditor(page, html);

  // Both repairable shapes remain.
  expect(await docString(page)).toContain(
    'tableRow(tableHeader(paragraph("c1")), tableCell(paragraph("c2"), paragraph("二行目")))',
  );
});

// 見出し行 makes a headerless table, not a pipe table on purpose; the repair acts only when it would
// restore the pipe form.
test('a headerless table is left as the author left it', async ({ page }) => {
  await openEditor(page, ALIGNED);
  await setRange(page, await cellCaret(page, 'middle'));
  await page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as Element & {
      editor?: { commands: { toggleHeaderRow(): boolean } };
    };
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    if (!el.editor.commands.toggleHeaderRow()) throw new Error('toggleHeaderRow did not run');
  });
  expect(await docString(page)).toContain('tableRow(tableCell(paragraph("見出しA"))');

  await pasteTwoParagraphsIntoCell(page);

  // Unjoined: nothing restores a pipe table here.
  expect(await docString(page)).toContain(
    'paragraph("見出一つ目の段落です"), paragraph("二つ目の段落ですしA")',
  );
});

// A merged cell has no pipe form at all: the second half of the rule, not a special case.
test('a table with a merged cell is left as the author left it', async ({ page }) => {
  await openEditor(
    page,
    '<table><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr>' +
      '<tr><td colspan="2"><p>セルの中身</p></td></tr></tbody></table>\n\n' +
      '一つ目の段落です\n\n二つ目の段落です\n',
  );

  // docString prints no attributes.
  await expect(page.locator('.ProseMirror td[colspan="2"]')).toHaveCount(1);

  await pasteTwoParagraphsIntoCell(page);

  // Unjoined.
  expect(await docString(page)).toContain(
    'tableCell(paragraph("セル一つ目の段落です"), paragraph("二つ目の段落ですの中身"))',
  );
});
