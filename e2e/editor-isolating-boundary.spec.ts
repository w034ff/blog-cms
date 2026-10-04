import { test, expect, type Page } from '@playwright/test';
import { caret, docString, historyState, markdown, settle } from './editor-probe';
import { closeHistory, loadMarkdown, setRange } from './editor-authoring';
import { caretPoint, cdpNativeDrag, dragSelect } from './native-drag';

// `isolating` guards where a slice is placed, not the frontier a ranged replacement closes over, so a
// selection across a callout's or code block's edge corrupted the document on select-then-key: the
// lower edge swallowed the block below into the box, the upper edge dissolved the box into the
// paragraph above (a fence losing its language and filename).
//
// components/editor/isolating-boundary.ts clamps the replacement at the boundary. Every
// range-replacing gesture reaches that one rule: keys, chords, typing, Enter, cut, paste, IME, a
// move-drag's source deletion. Also pinned: what must not clamp (inside one box, a whole box,
// select-all, a multi-cell selection).

// The issue's own reproduction document.
const CALLOUT = `前の段落です

> [!NOTE]
>
> 囲みの中身です

後の段落です`;

// A table has two isolating levels (`table` and each cell). The clamp once took the outermost, so
// Backspace from above into a body cell took the header row, and a headerless table saves as raw
// HTML. The cell is the box the endpoint is in; the table is only the frame.
const TABLE = `前の段落です

| 元A | 元B |
| --- | --- |
| 元セル | 元二 |

後の段落です`;

// The table as the serializer must write it. Headerless, it falls back to raw HTML, losing
// alignment, `<thead>` and hand-editability.
function pipeTable(bodyRow: string): string {
  return `| 元A | 元B |\n| --- | --- |\n${bodyRow}`;
}

// A fence with a language and a filename: `doc.toString()` prints no attributes, so only these show
// the fence surviving.
const CODE = `前の段落です

\`\`\`ts:a.ts
const x = 1;
\`\`\`

後の段落です`;

// The position `chars` characters into the textblock reading `text`: "part-way into this line".
function posInText(page: Page, text: string, chars: number): Promise<number> {
  return page.evaluate(
    ({ line, offset }) => {
      const el = document.querySelector('.ProseMirror') as
        | (Element & {
            editor?: {
              state: {
                doc: {
                  descendants(
                    f: (n: { isTextblock: boolean; textContent: string }, pos: number) => void,
                  ): void;
                };
              };
            };
          })
        | null;
      if (!el?.editor) throw new Error('no live editor on .ProseMirror');
      let found: number | null = null;
      el.editor.state.doc.descendants((node, pos) => {
        if (found === null && node.isTextblock && node.textContent === line) found = pos + 1;
      });
      if (found === null) throw new Error(`no textblock reading ${JSON.stringify(line)}`);
      return found + offset;
    },
    { line: text, offset: chars },
  );
}

// Load, focus (setRange moves only ProseMirror's selection; unfocused keys go nowhere), set range.
async function selectAcross(
  page: Page,
  markdown: string,
  start: { line: string; at: number },
  end: { line: string; at: number },
): Promise<void> {
  await loadMarkdown(page, markdown);
  await page.locator('.ProseMirror').click();
  const from = await posInText(page, start.line, start.at);
  const to = await posInText(page, end.line, end.at);
  await setRange(page, from, to);
}

async function openEditor(page: Page): Promise<void> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
}

// The headline gesture: from inside the callout into the paragraph below, Backspace. The boundary
// holds and both sides keep what the selection did not cover.
test('Backspace across a callout lower edge deletes both sides, keeping the box', async ({
  page,
}) => {
  await openEditor(page);
  await selectAcross(
    page,
    CALLOUT,
    { line: '囲みの中身です', at: 2 },
    { line: '後の段落です', at: 2 },
  );

  await page.keyboard.press('Backspace');

  await expect
    .poll(() => docString(page))
    .toBe('doc(paragraph("前の段落です"), callout(paragraph("囲み")), paragraph("段落です"))');

  // The caret stays inside the box, where the selection started.
  expect(await caret(page)).toBe('囲み@2');
  await page.keyboard.type('Z');
  await expect
    .poll(() => docString(page))
    .toBe('doc(paragraph("前の段落です"), callout(paragraph("囲みZ")), paragraph("段落です"))');
});

// Delete is the same ranged replacement.
test('Delete across a callout lower edge clamps the same way', async ({ page }) => {
  await openEditor(page);
  await selectAcross(
    page,
    CALLOUT,
    { line: '囲みの中身です', at: 2 },
    { line: '後の段落です', at: 2 },
  );

  await page.keyboard.press('Delete');

  await expect
    .poll(() => docString(page))
    .toBe('doc(paragraph("前の段落です"), callout(paragraph("囲み")), paragraph("段落です"))');
});

// The word-delete chords replace a selection like the plain keys, and the code block binds all six
// (deleteSoleCodeChar).
test('the word-delete chords across a callout edge clamp too', async ({ page }) => {
  await openEditor(page);
  const clamped =
    'doc(paragraph("前の段落です"), callout(paragraph("囲み")), paragraph("段落です"))';

  await selectAcross(
    page,
    CALLOUT,
    { line: '囲みの中身です', at: 2 },
    { line: '後の段落です', at: 2 },
  );
  await page.keyboard.press('Control+Backspace');
  await expect.poll(() => docString(page)).toBe(clamped);

  await selectAcross(
    page,
    CALLOUT,
    { line: '囲みの中身です', at: 2 },
    { line: '後の段落です', at: 2 },
  );
  await page.keyboard.press('Alt+Delete');
  await expect.poll(() => docString(page)).toBe(clamped);
});

// Typing corrupts with no key handler, which is why guarding a drag was the wrong layer. The
// character lands inside the box.
test('typing over a callout lower edge inserts inside the box', async ({ page }) => {
  await openEditor(page);
  await selectAcross(
    page,
    CALLOUT,
    { line: '囲みの中身です', at: 2 },
    { line: '後の段落です', at: 2 },
  );

  await page.keyboard.type('X');

  await expect
    .poll(() => docString(page))
    .toBe('doc(paragraph("前の段落です"), callout(paragraph("囲みX")), paragraph("段落です"))');
});

// The upper edge, the destructive one: the paragraph is truncated, the box survives.
test('Backspace across a callout upper edge keeps the box standing', async ({ page }) => {
  await openEditor(page);
  await selectAcross(
    page,
    CALLOUT,
    { line: '前の段落です', at: 2 },
    { line: '囲みの中身です', at: 2 },
  );

  await page.keyboard.press('Backspace');

  await expect
    .poll(() => docString(page))
    .toBe('doc(paragraph("前の"), callout(paragraph("の中身です")), paragraph("後の段落です"))');
  expect(await caret(page)).toBe('前の@2');
});

// The case the code block's own `isolating` comment names: prose merged into the code.
test('typing across a code block lower edge does not turn prose into code', async ({ page }) => {
  await openEditor(page);
  await selectAcross(
    page,
    CODE,
    { line: 'const x = 1;\n', at: 2 },
    { line: '後の段落です', at: 2 },
  );

  await page.keyboard.type('X');

  await expect
    .poll(() => docString(page))
    .toBe('doc(paragraph("前の段落です"), codeBlock("coX"), paragraph("段落です"))');
  // The fence's attributes, which `doc.toString()` does not print.
  await expect(page.locator('.code-block-filename')).toHaveValue('a.ts');
  await expect(page.locator('.code-block-lang')).toHaveValue('ts');
});

// The upper edge used to turn the code into a paragraph, losing language and filename.
test('Backspace across a code block upper edge keeps the fence and its attributes', async ({
  page,
}) => {
  await openEditor(page);
  await selectAcross(
    page,
    CODE,
    { line: '前の段落です', at: 2 },
    { line: 'const x = 1;\n', at: 2 },
  );

  await page.keyboard.press('Backspace');

  await expect
    .poll(() => docString(page))
    .toBe('doc(paragraph("前の"), codeBlock("nst x = 1;\\n"), paragraph("後の段落です"))');
  await expect(page.locator('.code-block-filename')).toHaveValue('a.ts');
  await expect(page.locator('.code-block-lang')).toHaveValue('ts');
});

// Not over-corrected: wholly inside one callout, no endpoint has an isolating ancestor the other is
// outside of, so ProseMirror's own path runs.
test('a selection wholly inside a callout deletes normally', async ({ page }) => {
  await openEditor(page);
  await selectAcross(
    page,
    CALLOUT,
    { line: '囲みの中身です', at: 1 },
    { line: '囲みの中身です', at: 4 },
  );

  await page.keyboard.press('Backspace');

  await expect
    .poll(() => docString(page))
    .toBe(
      'doc(paragraph("前の段落です"), callout(paragraph("囲身です")), paragraph("後の段落です"))',
    );
});

// A selection across the whole callout deletes it and joins the halves; clamping would leave an
// empty box.
test('a selection spanning a whole callout still deletes it', async ({ page }) => {
  await openEditor(page);
  await selectAcross(
    page,
    CALLOUT,
    { line: '前の段落です', at: 2 },
    { line: '後の段落です', at: 2 },
  );

  await page.keyboard.press('Backspace');

  // The two surviving halves, joined.
  await expect.poll(() => docString(page)).toBe('doc(paragraph("前の段落です"))');
});

// Enter replaces then splits, pulling the paragraph below into the box; clamped, the split stays
// inside the box.
test('Enter across a callout lower edge splits inside the box', async ({ page }) => {
  await openEditor(page);
  await selectAcross(
    page,
    CALLOUT,
    { line: '囲みの中身です', at: 2 },
    { line: '後の段落です', at: 2 },
  );

  await page.keyboard.press('Enter');

  await expect
    .poll(() => docString(page))
    .toBe(
      'doc(paragraph("前の段落です"), callout(paragraph("囲み"), paragraph), paragraph("段落です"))',
    );
});

// A range crossing nothing splits once. The clamp is asked before the chain: a TipTap chain
// dispatches whether or not its commands succeed, so the next binding would split again.
test('Enter on an ordinary range still splits once', async ({ page }) => {
  await openEditor(page);
  await selectAcross(
    page,
    CALLOUT,
    { line: '前の段落です', at: 1 },
    { line: '前の段落です', at: 4 },
  );

  await page.keyboard.press('Enter');

  await expect
    .poll(() => docString(page))
    .toBe(
      'doc(paragraph("前"), paragraph("です"), callout(paragraph("囲みの中身です")), paragraph("後の段落です"))',
    );
});

// Inside a code block Enter still makes a newline: baseKeymap's chain (newlineInCode first)
// follows the clamp, not a bare splitBlock.
test('Enter inside a code block still inserts a newline', async ({ page }) => {
  await openEditor(page);
  await selectAcross(
    page,
    CODE,
    { line: 'const x = 1;\n', at: 2 },
    { line: 'const x = 1;\n', at: 5 },
  );

  await page.keyboard.press('Enter');

  await expect
    .poll(() => docString(page))
    .toBe(
      'doc(paragraph("前の段落です"), codeBlock("co\\n x = 1;\\n"), paragraph("後の段落です"))',
    );
});

// Cut ends in prosemirror-view's `tr.deleteSelection()` and is also reachable from the context
// menu, so it needed a DOM handler. The text still reaches the clipboard.
test('cut across a callout edge clamps and still copies', async ({ page }) => {
  await openEditor(page);
  await selectAcross(
    page,
    CALLOUT,
    { line: '囲みの中身です', at: 2 },
    { line: '後の段落です', at: 2 },
  );

  await page.keyboard.press('Control+x');

  await expect
    .poll(() => docString(page))
    .toBe('doc(paragraph("前の段落です"), callout(paragraph("囲み")), paragraph("段落です"))');

  // The paste brings both halves back; the half-selected callout is unwrapped by the paste guard
  // (callout-slice-guard.ts).
  await page.keyboard.press('Control+v');
  await expect
    .poll(() => docString(page))
    .toBe(
      'doc(paragraph("前の段落です"), callout(paragraph("囲みの中身です"), paragraph("後の")), paragraph("段落です"))',
    );
});

// One transaction, so one undo; correct before the fix, and must not regress.
test('one undo restores a clamped deletion', async ({ page }) => {
  await openEditor(page);
  await selectAcross(
    page,
    CALLOUT,
    { line: '囲みの中身です', at: 2 },
    { line: '後の段落です', at: 2 },
  );
  // Break the history so the undo covers only the deletion (e2e/README.md).
  await closeHistory(page);
  const before = (await historyState(page)).undoDepth;

  await page.keyboard.press('Backspace');
  await expect
    .poll(() => docString(page))
    .toBe('doc(paragraph("前の段落です"), callout(paragraph("囲み")), paragraph("段落です"))');
  // One transaction: only the count can tell one step from two.
  expect((await historyState(page)).undoDepth).toBe(before + 1);

  await page.keyboard.press('Control+z');
  await expect
    .poll(() => docString(page))
    .toBe(
      'doc(paragraph("前の段落です"), callout(paragraph("囲みの中身です")), paragraph("後の段落です"))',
    );
  expect((await historyState(page)).undoDepth).toBe(before);
});

// Paste replaces the range too. A slice with no callout, which callout-slice-guard.ts passes on to
// this plugin's `handlePaste`.
test('pasting over a callout edge lands inside the box', async ({ page }) => {
  await openEditor(page);
  await loadMarkdown(page, CALLOUT);
  await page.locator('.ProseMirror').click();

  // Copy 「前の段落です」, paste over the callout's lower edge.
  await setRange(
    page,
    await posInText(page, '前の段落です', 0),
    await posInText(page, '前の段落です', 6),
  );
  await page.keyboard.press('Control+c');
  await setRange(
    page,
    await posInText(page, '囲みの中身です', 2),
    await posInText(page, '後の段落です', 2),
  );
  await page.keyboard.press('Control+v');

  await expect
    .poll(() => docString(page))
    .toBe(
      'doc(paragraph("前の段落です"), callout(paragraph("囲み前の段落です")), paragraph("段落です"))',
    );
});

// A half-callout slice needs the callout guard's repair and the clamp, but `someProp` stops at the
// first `handlePaste` returning true, so the callout guard applies the clamp itself and ranks above
// this extension. Inverted, the box would come back here.
test('pasting a half-callout slice over a callout edge is both repaired and clamped', async ({
  page,
}) => {
  await openEditor(page);
  await loadMarkdown(page, CALLOUT);
  await page.locator('.ProseMirror').click();

  // The slice `<callout(paragraph("中身です")), paragraph("後の")>` (callout-paste-guard.spec.ts).
  await setRange(
    page,
    await posInText(page, '囲みの中身です', 3),
    await posInText(page, '後の段落です', 2),
  );
  await page.keyboard.press('Control+c');
  await setRange(
    page,
    await posInText(page, '囲みの中身です', 2),
    await posInText(page, '後の段落です', 2),
  );
  await page.keyboard.press('Control+v');

  // No second box; the paragraph below stays outside.
  await expect(page.locator('.ProseMirror .markdown-alert')).toHaveCount(1);
  await expect
    .poll(() => docString(page))
    .toBe(
      'doc(paragraph("前の段落です"), callout(paragraph("囲み中身です"), paragraph("後の")), paragraph("段落です"))',
    );
});

// Pasting across the code block's edge, where the loss is the fence itself.
test('pasting over a code block edge keeps the fence and its attributes', async ({ page }) => {
  await openEditor(page);
  await loadMarkdown(page, CODE);
  await page.locator('.ProseMirror').click();

  await setRange(
    page,
    await posInText(page, '前の段落です', 0),
    await posInText(page, '前の段落です', 2),
  );
  await page.keyboard.press('Control+c');
  await setRange(
    page,
    await posInText(page, 'const x = 1;\n', 2),
    await posInText(page, '後の段落です', 2),
  );
  await page.keyboard.press('Control+v');

  await expect
    .poll(() => docString(page))
    .toBe('doc(paragraph("前の段落です"), codeBlock("co前の"), paragraph("段落です"))');
  await expect(page.locator('.code-block-filename')).toHaveValue('a.ts');
  await expect(page.locator('.code-block-lang')).toHaveValue('ts');
});

// IME is the typing path on a Japanese site, and a composition never reaches `handleTextInput`: the
// browser edits the DOM and ProseMirror reads it back at the end. So the deletion runs at
// `compositionstart`, before the browser removes the text.
test('an IME commit over a callout edge lands inside the box', async ({ page }) => {
  await openEditor(page);
  await loadMarkdown(page, CALLOUT);
  await page.locator('.ProseMirror').click();
  await setRange(
    page,
    await posInText(page, '囲みの中身です', 2),
    await posInText(page, '後の段落です', 2),
  );

  // Break the history so the undos below can only undo the composition.
  await closeHistory(page);
  const before = (await historyState(page)).undoDepth;

  // Playwright cannot compose, so the IME is driven over CDP.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: 'あ', selectionStart: 1, selectionEnd: 1 });
  await cdp.send('Input.insertText', { text: 'あ' });

  await expect
    .poll(() => docString(page))
    .toBe('doc(paragraph("前の段落です"), callout(paragraph("囲みあ")), paragraph("段落です"))');

  // The one clamp that is its own transaction: the composition's read-back is a second one, grouped or
  // not by timing (`newGroupDelay`). So undo must converge on the original, never half-deleted.
  const original =
    'doc(paragraph("前の段落です"), callout(paragraph("囲みの中身です")), paragraph("後の段落です"))';
  for (let press = 0; press < 3 && (await docString(page)) !== original; press += 1) {
    await page.keyboard.press('Control+z');
    await settle(page);
  }
  expect(await docString(page)).toBe(original);
  // The undos stopped at the original, not eating the load: a count, since the text cannot tell.
  expect((await historyState(page)).undoDepth).toBe(before);
});

// Control: at a caret, or over a range crossing nothing, the clamp dispatches nothing.
test('composing at a caret and over an ordinary selection is unaffected', async ({ page }) => {
  await openEditor(page);
  await loadMarkdown(page, CALLOUT);
  await page.locator('.ProseMirror').click();
  const cdp = await page.context().newCDPSession(page);

  await setRange(page, await posInText(page, '囲みの中身です', 2));
  await cdp.send('Input.imeSetComposition', { text: 'き', selectionStart: 1, selectionEnd: 1 });
  await cdp.send('Input.insertText', { text: 'きた' });
  await expect
    .poll(() => docString(page))
    .toBe(
      'doc(paragraph("前の段落です"), callout(paragraph("囲みきたの中身です")), paragraph("後の段落です"))',
    );

  await loadMarkdown(page, CALLOUT);
  await setRange(
    page,
    await posInText(page, '前の段落です', 1),
    await posInText(page, '前の段落です', 4),
  );
  await cdp.send('Input.imeSetComposition', { text: 'か', selectionStart: 1, selectionEnd: 1 });
  await cdp.send('Input.insertText', { text: 'か' });
  await expect
    .poll(() => docString(page))
    .toBe(
      'doc(paragraph("前かです"), callout(paragraph("囲みの中身です")), paragraph("後の段落です"))',
    );
});

// A move-drag's source deletion is a bare `tr.deleteSelection()` with no keymap or handler, so
// isolating-boundary.ts performs the drop itself with the clamped deletion.
test('dragging a selection out of a code block leaves the fence standing', async ({ page }) => {
  await openEditor(page);
  await loadMarkdown(page, CODE);
  const editor = page.locator('.ProseMirror');
  await editor.click();

  // Upwards from the paragraph: dragging down out of a `<pre>` collapses Chrome's selection.
  const above = await editor.getByText('前の段落です').boundingBox();
  if (!above) throw new Error('missing box');
  // Measured caret boundaries (e2e/native-drag.ts). The code end must be in the code's text: the
  // <code> box is two lines tall, and its midpoint's empty line anchors a range with no code.
  const dragFrom = await dragSelect(
    page,
    await caretPoint(editor.getByText('後の段落です'), 3),
    await caretPoint(editor.locator('pre code'), 8),
  );

  await cdpNativeDrag(page, dragFrom, { x: above.x + 10, y: above.y + above.height / 2 });

  // Two fences: the source still standing, and the carried copy. Without the fix, one.
  await expect(editor.locator('pre code')).toHaveCount(2);
  await expect(page.locator('.code-block-filename').first()).toHaveValue('a.ts');
  await expect(page.locator('.code-block-filename').last()).toHaveValue('a.ts');
  await expect(page.locator('.code-block-lang').first()).toHaveValue('ts');
  await expect(page.locator('.code-block-lang').last()).toHaveValue('ts');
});

// Selection kinds: Ctrl+A then a key replaces everything. An AllSelection's endpoints are at depth
// 0 with no isolating ancestors, and handleTextInput gates on TextSelection.
test('select-all then typing still replaces the whole document', async ({ page }) => {
  await openEditor(page);
  await loadMarkdown(page, CALLOUT);
  await page.locator('.ProseMirror').click();

  await page.keyboard.press('Control+a');
  await page.keyboard.type('X');
  await expect.poll(() => docString(page)).toBe('doc(paragraph("X"))');

  await loadMarkdown(page, CALLOUT);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await expect.poll(() => docString(page)).toBe('doc(paragraph)');
});

// Cells are isolating too, so a CellSelection spans isolating edges; typing must stay
// prosemirror-tables' clear-then-insert.
test('typing over a multi-cell selection still clears the cells', async ({ page }) => {
  await openEditor(page);
  await loadMarkdown(page, '| a | b |\n| --- | --- |\n| c | d |');
  await page.locator('.ProseMirror').click();

  // Set through the editor: the drag is timing-sensitive (table-selection.spec.ts), and the kind is
  // what matters.
  await page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as
      | (Element & {
          editor?: {
            commands: {
              setCellSelection(range: { anchorCell: number; headCell: number }): boolean;
            };
            state: {
              doc: { descendants(f: (n: { type: { name: string } }, pos: number) => void): void };
            };
          };
        })
      | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    const cells: number[] = [];
    el.editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableHeader' || node.type.name === 'tableCell') cells.push(pos);
    });
    el.editor.commands.setCellSelection({ anchorCell: cells[0], headCell: cells[3] });
  });

  await page.keyboard.type('X');

  await expect
    .poll(() => docString(page))
    .toBe(
      'doc(table(tableRow(tableHeader(paragraph), tableHeader(paragraph)), tableRow(tableCell(paragraph), tableCell(paragraph("X")))), paragraph)',
    );
});

// The literal gesture, a mouse drag-select: its selection reaches state through the 20ms debounce,
// and a key in that window bypasses every keymap, where this fix lives (docs/editor-pitfalls.md
// §1.1; editor-callout-boundary.spec.ts).
test('the reported gesture — drag across the edge, press Backspace — clamps', async ({ page }) => {
  await openEditor(page);
  await loadMarkdown(page, CALLOUT);
  const editor = page.locator('.ProseMirror');
  await editor.click();

  await dragSelect(
    page,
    await caretPoint(editor.locator('.markdown-alert p').last(), 2),
    await caretPoint(editor.getByText('後の段落です'), 3),
  );

  await page.keyboard.press('Backspace');

  // One character more than the stated-endpoint tests (「落です」): a property of the measured range
  // (caretPoint), not of the font.
  await expect
    .poll(() => docString(page))
    .toBe('doc(paragraph("前の段落です"), callout(paragraph("囲み")), paragraph("落です"))');
});

// ---------------------------------------------------------------------------
// A table's edges
// ---------------------------------------------------------------------------

// From the paragraph above into a body cell, Backspace: the header row went too, and headerless the
// post saved as raw HTML. Shape and markdown both asserted.
test('Backspace from above a table into a cell keeps the header row', async ({ page }) => {
  await openEditor(page);
  await selectAcross(page, TABLE, { line: '前の段落です', at: 1 }, { line: '元セル', at: 2 });

  await page.keyboard.press('Backspace');

  await expect
    .poll(() => docString(page))
    .toBe(
      'doc(paragraph("前"), table(tableRow(tableHeader(paragraph("元A")), tableHeader(paragraph("元B"))), tableRow(tableCell(paragraph("ル")), tableCell(paragraph("元二")))), paragraph("後の段落です"))',
    );
  expect(await markdown(page)).toContain(pipeTable('| ル | 元二 |'));
});

// Typing, via `handleTextInput`: no single key guard could fix this.
test('typing over a table upper edge keeps the header row too', async ({ page }) => {
  await openEditor(page);
  await selectAcross(page, TABLE, { line: '前の段落です', at: 1 }, { line: '元セル', at: 2 });

  await page.keyboard.type('X');

  await expect
    .poll(() => docString(page))
    .toBe(
      'doc(paragraph("前X"), table(tableRow(tableHeader(paragraph("元A")), tableHeader(paragraph("元B"))), tableRow(tableCell(paragraph("ル")), tableCell(paragraph("元二")))), paragraph("後の段落です"))',
    );
  expect(await markdown(page)).toContain(pipeTable('| ル | 元二 |'));
});

// Out of the first cell: the old clamp was right only for the last cell, where its stop sat just
// inside the row's close. From the first, it crossed the row and table close.
test('Backspace out of a non-last cell leaves the table whole', async ({ page }) => {
  await openEditor(page);
  await selectAcross(page, TABLE, { line: '元セル', at: 2 }, { line: '後の段落です', at: 2 });

  await page.keyboard.press('Backspace');

  await expect
    .poll(() => docString(page))
    .toBe(
      'doc(paragraph("前の段落です"), table(tableRow(tableHeader(paragraph("元A")), tableHeader(paragraph("元B"))), tableRow(tableCell(paragraph("元セ")), tableCell(paragraph("元二")))), paragraph("段落です"))',
    );
  expect(await markdown(page)).toContain(pipeTable('| 元セ | 元二 |'));
});

// Out of a cell, the clamp leaves the caret in the cell, and splitBlock made a second paragraph there,
// which the pipe form cannot hold. A hard break instead, as Shift+Enter, serialized as `<br>`.
test('Enter out of a cell makes a hard break, not a second paragraph', async ({ page }) => {
  await openEditor(page);
  await selectAcross(page, TABLE, { line: '元セル', at: 2 }, { line: '後の段落です', at: 2 });

  await page.keyboard.press('Enter');

  await expect
    .poll(() => docString(page))
    .toBe(
      'doc(paragraph("前の段落です"), table(tableRow(tableHeader(paragraph("元A")), tableHeader(paragraph("元B"))), tableRow(tableCell(paragraph("元セ", hardBreak)), tableCell(paragraph("元二")))), paragraph("段落です"))',
    );
  // Still a pipe table. A trailing break writes nothing (prosemirror-markdown skips it), so this is
  // asserted again after typing.
  expect(await markdown(page)).toContain(pipeTable('| 元セ | 元二 |'));

  await page.keyboard.type('X');
  expect(await docString(page)).toContain('tableCell(paragraph("元セ", hardBreak, "X"))');
  expect(await markdown(page)).toContain(pipeTable('| 元セ<br>X | 元二 |'));
});

// The clamp stops where the endpoints are siblings, not at the outermost wrapper: inside a callout,
// the frame is the half-covered table.
test('a table nested in a callout clamps to the table, not the callout', async ({ page }) => {
  await openEditor(page);
  await selectAcross(
    page,
    `> [!NOTE]\n>\n> 囲みの中身です\n>\n> | 元A | 元B |\n> | --- | --- |\n> | 元セル | 元二 |`,
    { line: '囲みの中身です', at: 2 },
    { line: '元セル', at: 2 },
  );

  await page.keyboard.press('Backspace');

  await expect
    .poll(() => docString(page))
    .toBe(
      'doc(callout(paragraph("囲み"), table(tableRow(tableHeader(paragraph("元A")), tableHeader(paragraph("元B"))), tableRow(tableCell(paragraph("ル")), tableCell(paragraph("元二"))))), paragraph)',
    );
});

// Two isolating boxes on one branch: taking the outermost (the callout) ran the deletion through the
// fence's opening. The innermost box is the one the endpoint is in.
test('a range into a code block inside a callout keeps the callout body and the fence', async ({
  page,
}) => {
  await openEditor(page);
  await selectAcross(
    page,
    `前の段落です\n\n> [!NOTE]\n>\n> 囲みの中身です\n>\n> \`\`\`ts:a.ts\n> const x = 1;\n> \`\`\``,
    { line: '前の段落です', at: 2 },
    { line: 'const x = 1;\n', at: 2 },
  );

  await page.keyboard.press('Backspace');

  await expect
    .poll(() => docString(page))
    .toBe(
      'doc(paragraph("前の"), callout(paragraph("囲みの中身です"), codeBlock("nst x = 1;\\n")), paragraph)',
    );
  await expect(page.locator('.code-block-filename')).toHaveValue('a.ts');
  await expect(page.locator('.code-block-lang')).toHaveValue('ts');
});

// A move drag deletes its source itself, unseen by keymaps and handlers; pinned that it reaches the
// clamped deletion.
test('dragging a selection out of a table leaves the header row standing', async ({ page }) => {
  await openEditor(page);
  await loadMarkdown(page, TABLE);
  const editor = page.locator('.ProseMirror');
  await editor.click();

  const above = await editor.getByText('前の段落です').boundingBox();
  const cell = await editor.getByText('元セル').boundingBox();
  const below = await editor.getByText('後の段落です').boundingBox();
  if (!above || !cell || !below) throw new Error('missing boxes');
  const dragFrom = await dragSelect(
    page,
    { x: above.x + 10, y: above.y + above.height / 2 },
    { x: cell.x + 30, y: cell.y + cell.height / 2 },
  );

  await cdpNativeDrag(page, dragFrom, { x: below.x + 40, y: below.y + below.height / 2 });

  // The source is the first table: the slice carries a copy, which a docString match would find
  // instead. Font metrics decide the surviving text, so it is not asserted.
  await expect(editor.locator('table').first().locator('th')).toHaveCount(2);
  // Both tables keep the pipe form.
  expect(await markdown(page)).not.toContain('<table');
});

// A code block in a list item is isolating two levels down; the old clamp stopped in the `listItem`
// and closed over the list's open token. A rule, not a table patch.
test('a range from above a list into a code block inside it keeps the list', async ({ page }) => {
  await openEditor(page);
  await selectAcross(
    page,
    `前の段落です\n\n- 一つ目\n\n  \`\`\`ts:a.ts\n  const x = 1;\n  \`\`\``,
    { line: '前の段落です', at: 2 },
    { line: 'const x = 1;\n', at: 2 },
  );

  await page.keyboard.press('Backspace');

  await expect
    .poll(() => docString(page))
    .toBe(
      'doc(paragraph("前の"), bulletList(listItem(paragraph("一つ目"), codeBlock("nst x = 1;\\n"))), paragraph)',
    );
  await expect(page.locator('.code-block-filename')).toHaveValue('a.ts');
});

// Enter hands the caret to another binding, and in a list item that is splitListItem (ListItem binds
// it), so it leads the chain; a plain splitBlock made a second paragraph in the same bullet.
test('Enter from a list item across a callout edge still makes a new bullet', async ({ page }) => {
  await openEditor(page);
  await loadMarkdown(page, '- 一つ目\n- 二つ目\n\n> [!NOTE]\n>\n> 囲みの中身です');
  await page.locator('.ProseMirror').click();
  await setRange(
    page,
    await posInText(page, '二つ目', 1),
    await posInText(page, '囲みの中身です', 2),
  );

  await page.keyboard.press('Enter');

  await expect
    .poll(() => docString(page))
    .toBe(
      'doc(bulletList(listItem(paragraph("一つ目")), listItem(paragraph("二")), listItem(paragraph)), callout(paragraph("の中身です")), paragraph)',
    );
});
