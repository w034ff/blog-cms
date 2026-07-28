import { test, expect, type Page } from '@playwright/test';
import { caret, docString } from './editor-probe';
import { loadMarkdown, setRange } from './editor-authoring';

// `isolating` blocks placement, not ranged replacement. prosemirror-transform's isolating checks
// guard where a slice may be *placed*; they say nothing about the frontier a ranged replacement
// closes over — so a selection spanning a callout's or code block's edge corrupted the document on
// the most ordinary editing path there is: select a range, then press a key.
//
// Two directions, both measured before the fix:
//   • lower edge — the box swallowed the block below (`callout(paragraph("囲み段落です"))`, and for
//     a code block the prose-becomes-code failure `isolating` was added to prevent);
//   • upper edge — the box was *destroyed*, its content absorbed into the paragraph above as plain
//     prose (`paragraph("前のの中身です")`), taking a fence's language and filename with it.
//
// components/editor/isolating-boundary.ts clamps the replacement to the boundary instead: the
// pieces inside and outside the box are deleted separately and the boundary is left standing. Every
// gesture that replaces a range goes through that one rule, which is what these specs pin — the
// keys, the chords, typing, Enter, and cut all reach the same deletion by different routes.
//
// Browser-only: this is live-editor edit behaviour, invisible to tsc and vitest.

// The issue's own reproduction document.
const CALLOUT = `前の段落です

> [!NOTE]
>
> 囲みの中身です

後の段落です`;

// The same shape with a fenced block in the callout's place. The fence carries a language *and* a
// filename precisely so the upper-edge test can show they survive — `doc.toString()` prints no
// attributes, so a spec that only compared tree shapes would pass while the fence was being lost.
const CODE = `前の段落です

\`\`\`ts:a.ts
const x = 1;
\`\`\`

後の段落です`;

// The document position `chars` characters into the textblock whose text is `text`. Every endpoint
// these specs need is "part-way into this line, part-way into that one", which a raw number states
// no more precisely and a great deal less legibly.
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

// Load the document, focus the editor, and put an exact range on it. The click is what gives the
// editor DOM focus — `setRange` only moves ProseMirror's own selection, and keystrokes sent to an
// unfocused editor land nowhere at all (which reads, in a spec, as a document that never changed).
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

// The issue's headline gesture: drag from inside the callout down into the paragraph below, press
// Backspace. Before the fix the paragraph's text was pulled *inside* the box and an empty paragraph
// was left behind. The boundary now holds, and both sides keep exactly what the selection didn't
// cover.
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

  // The caret stays where the selection started — inside the box — so the next keystroke lands
  // there rather than below it.
  expect(await caret(page)).toBe('囲み@2');
  await page.keyboard.type('Z');
  await expect
    .poll(() => docString(page))
    .toBe('doc(paragraph("前の段落です"), callout(paragraph("囲みZ")), paragraph("段落です"))');
});

// Delete is the same ranged replacement as Backspace and was broken identically — the key pressed
// makes no difference to a non-empty selection.
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

// The word-delete chords replace a non-empty selection exactly like the plain keys, and the code
// block binds all six of them itself (deleteSoleCodeChar), so all six had to answer here too.
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

// Typing over the same range reproduced the corruption with no key-handler involved at all — this
// is the entry point that made "guard the drag" the wrong layer to fix it at. The character lands
// at the selection's start, inside the box.
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

// The upper edge, which was the destructive direction: the callout used to disappear entirely and
// its surviving text end up in the paragraph above as ordinary prose. Now the paragraph is
// truncated, the box survives, and the caret stays above it.
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

// The code block's lower edge is the case its own `isolating` comment names outright: without the
// boundary, "Backspace at the start of the block below merges that block's text *into* the code —
// turning prose into code (and corrupting the stored fence)". Typing reached that with no Backspace
// at all, and measured `codeBlock("coX段落です")` before the fix.
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
  // The fence itself is intact — the attributes `doc.toString()` doesn't print.
  await expect(page.locator('.code-block-filename')).toHaveValue('a.ts');
  await expect(page.locator('.code-block-lang')).toHaveValue('ts');
});

// The code block's upper edge, where the loss was worst: the block was destroyed and the code
// became a paragraph, so the fence's language and filename went with it. Both must come through.
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

// The over-correction guard, first half: a selection made wholly inside one callout crosses no
// edge, so it must take ProseMirror's own path untouched. The clamp asks whether each endpoint has
// an isolating ancestor the *other* endpoint is outside of — here the callout contains both, so
// there is nothing to clamp.
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

// The other half: a selection running from the paragraph above, clean across the *whole* callout,
// into the paragraph below. Neither endpoint sits inside a box the other is outside of, so the
// callout is covered end-to-end and deleting it whole — joining the two partial paragraphs — is
// exactly right. Clamping here would have left an empty box behind.
test('a selection spanning a whole callout still deletes it', async ({ page }) => {
  await openEditor(page);
  await selectAcross(
    page,
    CALLOUT,
    { line: '前の段落です', at: 2 },
    { line: '後の段落です', at: 2 },
  );

  await page.keyboard.press('Backspace');

  // "前の" + "段落です" — the two surviving halves, joined into one paragraph.
  await expect.poll(() => docString(page)).toBe('doc(paragraph("前の段落です"))');
});

// Enter replaces the selection and then splits, so it corrupted the document the same way — it
// measured `callout(paragraph("囲み"), paragraph("段落です"))`, the following paragraph pulled into
// the box. Clamped, the split happens inside the box the selection started in and the paragraph
// below stays outside it.
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

// Enter on a range that crosses nothing must keep behaving exactly as it did — one split, not two.
// The clamp is asked before the chain runs for this reason: a TipTap chain dispatches whether or
// not its commands succeeded, so an unguarded chain would split, dispatch, report failure, and hand
// the same Enter to the next binding to split again.
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

// Enter left inside a code block must still make a newline rather than split the block in two —
// which is why the clamp is followed by baseKeymap's own Enter chain (newlineInCode first) instead
// of a bare splitBlock.
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

// Cut ends in prosemirror-view's own `tr.deleteSelection()`, which is the same ranged replacement
// and was broken identically — and it is reachable from the context menu as well as the chord, so
// it needed a DOM handler rather than a keymap entry. The clipboard half still happens: the text
// comes back on paste.
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

  // The cut really put the range on the clipboard — pasting brings both halves back. The box does
  // not come with them: the slice carries a half-selected callout, which the paste guard unwraps
  // (see callout-slice-guard.ts), so the text lands as body blocks of the callout the caret is in.
  await page.keyboard.press('Control+v');
  await expect
    .poll(() => docString(page))
    .toBe(
      'doc(paragraph("前の段落です"), callout(paragraph("囲みの中身です"), paragraph("後の")), paragraph("段落です"))',
    );
});

// The clamped deletion is one transaction, not one per piece — so undo is still a single step. The
// issue measured undo as already correct before the fix, which made it something the fix had to
// avoid regressing rather than something it had to repair.
test('one undo restores a clamped deletion', async ({ page }) => {
  await openEditor(page);
  await selectAcross(
    page,
    CALLOUT,
    { line: '囲みの中身です', at: 2 },
    { line: '後の段落です', at: 2 },
  );
  // prosemirror-history groups edits made within newGroupDelay (500ms) of each other, and the
  // setContent above is itself an edit — without this wait the undo would step over both and the
  // test would read a grouping artefact as a defect.
  await page.waitForTimeout(600);

  await page.keyboard.press('Backspace');
  await expect
    .poll(() => docString(page))
    .toBe('doc(paragraph("前の段落です"), callout(paragraph("囲み")), paragraph("段落です"))');

  await page.keyboard.press('Control+z');
  await expect
    .poll(() => docString(page))
    .toBe(
      'doc(paragraph("前の段落です"), callout(paragraph("囲みの中身です")), paragraph("後の段落です"))',
    );
});

// Paste replaces the selected range too, so Ctrl+V reached the same corruption as Backspace. This
// is the branch callout-slice-guard.ts passes on — a slice with no callout to repair — which the
// isolating plugin's own `handlePaste` picks up.
test('pasting over a callout edge lands inside the box', async ({ page }) => {
  await openEditor(page);
  await loadMarkdown(page, CALLOUT);
  await page.locator('.ProseMirror').click();

  // Copy 「前の段落です」 whole, then paste it over a selection crossing the callout's lower edge.
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

// The other paste branch, and the one that pins the plugin order: a slice carrying a half-selected
// callout needs the callout guard's repair *and* this clamp. `someProp` stops at the first
// handlePaste to return true, so only one of the two plugins ever runs for a given paste — which is
// why the callout guard applies the clamp itself and this extension sits below it in priority. If
// that ordering inverted, the box would come back into the document here.
test('pasting a half-callout slice over a callout edge is both repaired and clamped', async ({
  page,
}) => {
  await openEditor(page);
  await loadMarkdown(page, CALLOUT);
  await page.locator('.ProseMirror').click();

  // Copy across the callout's lower edge: the slice is `<callout(paragraph("中身です")),
  // paragraph("後の")>`, the shape that forces the box to be kept (see callout-paste-guard.spec.ts).
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

  // No second box anywhere, and the paragraph below the callout is still outside it.
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

// IME is the typing path on a Japanese site, not an edge case — and a composition never reaches
// `handleTextInput`: the browser edits the DOM itself and ProseMirror reads the result back at
// composition end, so a commit over a spanning selection reproduced the corruption
// (`callout(paragraph("囲みあ段落です")), paragraph`) with the clamp never consulted. The deletion
// is done at `compositionstart` instead, before the browser removes the selected text.
test('an IME commit over a callout edge lands inside the box', async ({ page }) => {
  await openEditor(page);
  await loadMarkdown(page, CALLOUT);
  await page.locator('.ProseMirror').click();
  await setRange(
    page,
    await posInText(page, '囲みの中身です', 2),
    await posInText(page, '後の段落です', 2),
  );

  // Playwright's keyboard cannot compose, so the IME is driven over CDP directly: set a
  // composition, then commit it.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: 'あ', selectionStart: 1, selectionEnd: 1 });
  await cdp.send('Input.insertText', { text: 'あ' });

  await expect
    .poll(() => docString(page))
    .toBe('doc(paragraph("前の段落です"), callout(paragraph("囲みあ")), paragraph("段落です"))');
});

// The control for the above: composing at a plain caret, and over a selection that crosses nothing,
// must be completely untouched — the clamp dispatches nothing in either case, so composition keeps
// ProseMirror's own path.
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
