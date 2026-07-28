import { test, expect, type Page } from '@playwright/test';
import { caret, docString, settle } from './editor-probe';
import { loadMarkdown, setRange } from './editor-authoring';
import { cdpNativeDrag, dragSelect } from './native-drag';

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
// keys, the chords, typing, Enter, cut, paste, an IME commit and a move-drag's own source deletion
// all reach the same deletion by different routes. Alongside them are the cases that must *not*
// clamp: a selection wholly inside one box, one spanning a whole box, select-all, and a
// multi-cell table selection.
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

  // prosemirror-history groups edits made within newGroupDelay (500ms) of each other, and the
  // setContent above is itself an edit — wait it out so the undo below can only be undoing the
  // composition.
  await page.waitForTimeout(600);

  // Playwright's keyboard cannot compose, so the IME is driven over CDP directly: set a
  // composition, then commit it.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: 'あ', selectionStart: 1, selectionEnd: 1 });
  await cdp.send('Input.insertText', { text: 'あ' });

  await expect
    .poll(() => docString(page))
    .toBe('doc(paragraph("前の段落です"), callout(paragraph("囲みあ")), paragraph("段落です"))');

  // This is the one gesture whose clamp is a transaction of its own: the deletion is dispatched at
  // compositionstart and the composition's own read-back arrives as a second one, where every other
  // entry point here builds a single transaction and is therefore a single undo step. Whether
  // prosemirror-history groups these two depends on how long the composition took — within
  // newGroupDelay (500ms) it is one step, and a composition the author lingered over is two — so
  // what is asserted is what actually holds either way: undo converges on the original document,
  // and never leaves it half-deleted.
  const original =
    'doc(paragraph("前の段落です"), callout(paragraph("囲みの中身です")), paragraph("後の段落です"))';
  for (let press = 0; press < 3 && (await docString(page)) !== original; press += 1) {
    await page.keyboard.press('Control+z');
    await settle(page);
  }
  expect(await docString(page)).toBe(original);
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

// The drop path's own source deletion, which nothing above could reach: prosemirror-view deletes a
// move-drag's source with a bare `tr.deleteSelection()` — no keymap, no DOM handler — so the drop
// is performed by isolating-boundary.ts itself, mirroring upstream with the clamped deletion in its
// place. The code block is the node where getting that wrong costs the most: the fence goes with it.
test('dragging a selection out of a code block leaves the fence standing', async ({ page }) => {
  await openEditor(page);
  await loadMarkdown(page, CODE);
  const editor = page.locator('.ProseMirror');
  await editor.click();

  // Drag-select the paragraph below *upwards* into the code — the same cross-edge range, made the
  // direction that actually produces one here. Dragging downwards out of a `<pre>` collapses the
  // native selection to a caret in Chrome, which leaves no range to pick up and no drag at all.
  const code = await editor.locator('pre code').boundingBox();
  const below = await editor.getByText('後の段落です').boundingBox();
  const above = await editor.getByText('前の段落です').boundingBox();
  if (!code || !below || !above) throw new Error('missing boxes');
  const dragFrom = await dragSelect(
    page,
    { x: below.x + 40, y: below.y + below.height / 2 },
    { x: code.x + 30, y: code.y + code.height / 2 },
  );

  await cdpNativeDrag(page, dragFrom, { x: above.x + 10, y: above.y + above.height / 2 });

  // Two fences: the one the selection came out of, still standing where it was, and the one the
  // slice carried to the destination. Before the fix the drag's own deletion destroyed the source
  // block — the code became a paragraph and the fence's language and filename went with it, which
  // would leave exactly one here.
  await expect(editor.locator('pre code')).toHaveCount(2);
  await expect(page.locator('.code-block-filename').first()).toHaveValue('a.ts');
  await expect(page.locator('.code-block-filename').last()).toHaveValue('a.ts');
  await expect(page.locator('.code-block-lang').first()).toHaveValue('ts');
  await expect(page.locator('.code-block-lang').last()).toHaveValue('ts');
});

// The over-correction guard for the selection *kinds*, which is what the clamp gates on rather than
// the range: Ctrl+A then a keystroke means "replace the document", boxes included, and it must not
// come back as a callout the deletion tiptoed around. An AllSelection's endpoints sit at depth 0,
// where there are no ancestors to be isolating, so the clamp declines it structurally — and the
// TextSelection gate in handleTextInput says so outright.
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

// The other excluded kind, and the one with a real chance of colliding: table cells are `isolating`
// too, so every multi-cell selection spans isolating edges. Typing over one must stay
// prosemirror-tables' own behaviour — clear the selected cells, then insert at the caret — not a
// clamped deletion that tiptoes around each cell wall.
test('typing over a multi-cell selection still clears the cells', async ({ page }) => {
  await openEditor(page);
  await loadMarkdown(page, '| a | b |\n| --- | --- |\n| c | d |');
  await page.locator('.ProseMirror').click();

  // A CellSelection is set through the editor rather than dragged: the drag that produces one is
  // pointer-timing-sensitive (see table-selection.spec.ts), and what this test needs is the
  // selection *kind*, stated outright.
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

// The issue's reproduction, made the way it is written: a mouse drag-select, not a range set
// through the editor. The two are not interchangeable here. A native selection reaches ProseMirror
// only through `selectionchange`, on a 20ms flushSoon debounce, and a keystroke inside that window
// bypasses every keymap — the internal selection still sits at the old spot, so no handler matches
// and the browser's own edit mutates the DOM instead (see editor-callout-boundary.spec.ts, where
// exactly that re-parsed mutation nested the following block inside the callout). This whole fix
// lives in the handler layer those keystrokes would miss, so the literal gesture is pinned here
// rather than inferred from the ones that state their endpoints outright.
test('the reported gesture — drag across the edge, press Backspace — clamps', async ({ page }) => {
  await openEditor(page);
  await loadMarkdown(page, CALLOUT);
  const editor = page.locator('.ProseMirror');
  await editor.click();

  const inside = await editor.locator('.markdown-alert p').last().boundingBox();
  const below = await editor.getByText('後の段落です').boundingBox();
  if (!inside || !below) throw new Error('missing boxes');
  await dragSelect(
    page,
    { x: inside.x + 30, y: inside.y + inside.height / 2 },
    { x: below.x + 40, y: below.y + below.height / 2 },
  );

  await page.keyboard.press('Backspace');

  // The endpoints land by font metrics rather than by count, so the tail here is 「落です」 where
  // the stated-endpoint tests above leave 「段落です」 — same clamp, one character further along.
  await expect
    .poll(() => docString(page))
    .toBe('doc(paragraph("前の段落です"), callout(paragraph("囲み")), paragraph("落です"))');
});

// Enter is the one gesture whose clamp has to hand the caret back to somebody else's key binding,
// and a list item is where that stops being baseKeymap's business: ListItem binds Enter to
// splitListItem on top of the default chain. A selection running out of a list item into a callout
// clamps with the caret back in that item, and finishing with a plain splitBlock opened a second
// paragraph inside the same bullet instead of a new bullet — so splitListItem leads the chain.
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
