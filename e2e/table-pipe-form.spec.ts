import { test, expect, type Page } from '@playwright/test';
import { docString, markdown } from './editor-probe';
import { loadMarkdown, selectNode, setRange } from './editor-authoring';
import { cdpNativeDrag, dragSelect } from './native-drag';

// A paste into a table cell used to leave the table intact on screen but no longer representable as
// a GFM pipe table, so the markdown serializer wrote the whole thing as raw HTML — silently, and
// only visible in the stored markdown and on the published page. Three things go with the pipe
// form: column alignment (`align="…"` survives the public render; the fallback's inline
// `text-align` is stripped by rehype-sanitize), `<thead>`, and `<colgroup>`. The markdown also stops
// being markdown, gaining `min-width: 50px` and `colspan="1"` nobody can hand-edit.
//
// Two pastes reach it, and they arrive by different routes:
//   A. a multi-paragraph paste — a cell ends up holding more than one block;
//   B. a whole table pasted into a cell — prosemirror-tables merges it cell-wise and the copied
//      header row lands in the body, where a row of `th` has no pipe form.
//
// tablePasteRepair (components/editor/table-extensions.ts) normalizes both *after* the paste rather
// than refusing or repairing the slice: B is performed by prosemirror-tables' own handlePaste, which
// runs ahead of this extension's plugins and is the same code that makes cell-to-cell paste work.
//
// So these specs are written against the saved markdown as much as the document. The document shape
// is the mechanism; the markdown is what the defect was about.

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

// A caret position inside the table's first cell of `typeName`, by raw document position rather than
// a click plus an End key: ProseMirror syncs a native selection on a 20ms debounce, so a key pressed
// straight after a programmatic setRange can act on the caret that was there before.
//
// 'middle' is where the report puts the caret — the position that visibly cuts the cell's own text
// in half, so a paste that lands wrong is unmistakable in the failure output.
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
        // +1 into the cell, +1 into its first paragraph.
        found = pos + 2 + length;
      });
      if (found === null) throw new Error(`no ${typeName}`);
      return found;
    },
    { at: where, typeName },
  );
}

// A caret `chars` characters into the paragraph reading `text` — the outside-a-table control for
// the Enter binding, which must decline everywhere this one goes.
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

// Route A: copy the two trailing paragraphs (a selection across a blank line — Shift+Enter would
// stay one paragraph and never reach this) and paste them into a cell.
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

// Route B: copy the whole table and paste it into one of its own cells.
async function pasteWholeTableIntoCell(page: Page): Promise<void> {
  await selectNode(page, 'table');
  await page.keyboard.press('Control+c');
  await setRange(page, await cellCaret(page, 'middle'));
  await page.keyboard.press('Control+v');
}

test('a multi-paragraph paste keeps the table in its pipe form', async ({ page }) => {
  await openEditor(page, ALIGNED);

  await pasteTwoParagraphsIntoCell(page);

  // The two paragraphs became one, joined by a hard break — which is what Shift+Enter makes in a
  // cell by hand, so the repair produces a shape the editor already supported rather than a new one.
  expect(await docString(page)).toContain(
    'tableCell(paragraph("セル一つ目の段落です", hardBreak, "二つ目の段落ですの中身"))',
  );
  expect(await markdown(page)).toContain(
    '| 見出しA | 見出しB |\n| :--: | --- |\n| セル一つ目の段落です<br>二つ目の段落ですの中身 | 二つ目 |',
  );
});

// The same route into a header cell. isPipeTable rejects a multi-block cell in the header row too
// (its `headerBad` check), and the join is the same code — but the demotion half must stay off here,
// since row 0 is where a `tableHeader` belongs.
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

  // The copied header row landed in the body; demoting it there leaves exactly one header row.
  expect(await docString(page)).toContain(
    'tableRow(tableHeader(paragraph("見出しA")), tableHeader(paragraph("見出しB"))), ' +
      'tableRow(tableCell(paragraph("見出しA")), tableCell(paragraph("見出しB")))',
  );
  expect(await markdown(page)).toContain(
    '| 見出しA | 見出しB |\n| :--: | --- |\n| 見出しA | 見出しB |\n| セルの中身 | 二つ目 |',
  );
});

// The same slice, dropped instead of pasted, and the case that shows where the drop guard stops and
// the repair starts: two *paragraphs* are content a cell may hold, so the guard lets them in (it
// refuses blocks, and positions at a cell's block edge) and the repair joins them with a hard break
// afterwards. So the repair listens for `drop` as well as `paste`.
//
// The endpoints come from a real drag-select and so depend on font metrics; what is asserted is the
// shape, not which characters ended up either side of the break.
test('a multi-paragraph drop into a cell keeps the table in its pipe form', async ({ page }) => {
  await openEditor(page, ALIGNED);
  const editor = page.locator('.ProseMirror');
  const first = await editor.getByText('一つ目の段落です').boundingBox();
  const second = await editor.getByText('二つ目の段落です').boundingBox();
  const cell = await editor.getByText('セルの中身').boundingBox();
  if (!first || !second || !cell) throw new Error('missing boxes');

  // dragstart only fires on a mousedown inside a live selection, so the range has to be dragged out
  // rather than set with setRange.
  const from = await dragSelect(
    page,
    { x: first.x + 20, y: first.y + first.height / 2 },
    { x: second.x + 40, y: second.y + second.height / 2 },
  );
  await cdpNativeDrag(page, from, { x: cell.x + cell.width / 2, y: cell.y + cell.height / 2 });

  // One paragraph with a hard break in it, not two paragraphs.
  expect(await docString(page)).toMatch(/tableCell\(paragraph\("[^"]*", hardBreak, "[^"]*"\)\)/);
  const md = await markdown(page);
  expect(md).not.toContain('<table');
  expect(md).toContain('| :--: | --- |');
});

// The concrete loss the report measured, asserted from the other end: the raw-HTML fallback carries
// alignment as an inline `text-align`, which rehype-sanitize strips on the public page. Both routes
// above already assert the `:--:` delimiter; this states outright that no `<table` reaches storage.
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
  // prosemirror-history groups edits inside newGroupDelay (500ms), and this spec's own setContent is
  // an edit like any other — without the wait it joins the paste and Ctrl+Z empties the document,
  // which measures the harness rather than the repair.
  await page.waitForTimeout(700);

  await pasteTwoParagraphsIntoCell(page);
  await page.keyboard.press('Control+z');

  // The repair rides in the paste's own history event, so it costs no second undo: it is an
  // appendTransaction dispatched in the same tick, which is what keeps this one step.
  expect(await docString(page)).toBe(before);
});

// The shape the repair produces, pinned independently of the repair: it has to survive a save and a
// reload, or the paste would come back as something else the next time the post is opened.
test('a hard break in a cell round-trips through the pipe form', async ({ page }) => {
  await openEditor(page, '| A | B |\n| --- | --- |\n| x<br>y | z |\n');

  expect(await docString(page)).toContain('tableCell(paragraph("x", hardBreak, "y"))');
  expect(await markdown(page)).toBe('| A | B |\n| --- | --- |\n| x<br>y | z |\n');
});

// The fourth route into a cell, and the last one to agree with the other three. Enter used to open
// a second paragraph here — legal for a `paragraph+` cell, and the table still looked right, but it
// has no pipe form, so from that keystroke on the whole table saved as raw HTML. The repair above
// deliberately did not touch it: an unconditional join would undo every Enter the instant it was
// typed, which is the right call *after* the fact and the wrong one for the gesture itself. So the
// gesture changed instead (MarkdownTable's Enter binding) and this spec records the new answer.
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

// The binding is document-wide, so the half that says it is a *cell* rule rather than an Enter rule
// has to be pinned too: outside a table, Enter still splits the block.
test('Enter outside a table still splits the paragraph', async ({ page }) => {
  await openEditor(page, ALIGNED);

  await setRange(page, await posInParagraph(page, '一つ目の段落です', 3));
  await page.keyboard.press('Enter');

  expect(await docString(page)).toContain('paragraph("一つ目"), paragraph("の段落です")');
});

// ---------------------------------------------------------------------------
// Must not repair
// ---------------------------------------------------------------------------

// The same shapes arrive from setContent when a post already stored in the HTML fallback is opened.
// Repairing there would rewrite stored content on open and hand the autosave an edit the author
// never made, so loading is left alone entirely.
test('opening a post already stored as raw HTML changes nothing', async ({ page }) => {
  const html =
    '<table><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr>' +
    '<tr><th><p>c1</p></th><td><p>c2</p><p>二行目</p></td></tr></tbody></table>';
  await openEditor(page, html);

  // Both repairable shapes are present — a header cell in a body row and a two-paragraph cell — and
  // both are still there.
  expect(await docString(page)).toContain(
    'tableRow(tableHeader(paragraph("c1")), tableCell(paragraph("c2"), paragraph("二行目")))',
  );
});

// The toolbar's 見出し行 button deliberately produces a table with no header row, which is also not
// a pipe table. A table already in the fallback for a reason of its own gains nothing from having
// its cells rewritten, so the repair only acts when it would actually restore the pipe form.
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

  // Two paragraphs, unjoined: the header row is still gone, so nothing here restores a pipe table.
  expect(await docString(page)).toContain(
    'paragraph("見出一つ目の段落です"), paragraph("二つ目の段落ですしA")',
  );
});

// A merged cell has no pipe form at any width, so the same reasoning applies — and this one cannot
// be reached by the repair even in principle, which is why it is the second half of the rule rather
// than a special case in it.
test('a table with a merged cell is left as the author left it', async ({ page }) => {
  await openEditor(
    page,
    '<table><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr>' +
      '<tr><td colspan="2"><p>セルの中身</p></td></tr></tbody></table>\n\n' +
      '一つ目の段落です\n\n二つ目の段落です\n',
  );

  // docString does not print attributes, so the span itself is asserted through the DOM.
  await expect(page.locator('.ProseMirror td[colspan="2"]')).toHaveCount(1);

  await pasteTwoParagraphsIntoCell(page);

  // Two paragraphs, unjoined.
  expect(await docString(page)).toContain(
    'tableCell(paragraph("セル一つ目の段落です"), paragraph("二つ目の段落ですの中身"))',
  );
});
