import { test, expect, type Page } from '@playwright/test';
import { docString } from './editor-probe';
import { loadMarkdown } from './editor-authoring';
import { cdpNativeDrag, dragSelect, type Point } from './native-drag';

// A selection crossing a callout's edge drags a slice that *contains the callout node*: select from
// inside one down into the paragraph below and ProseMirror hands the drag
// `<callout(paragraph(…)), paragraph(…)>`. Nobody asked to move that box — dropped inside another
// callout it went in as a child (a callout nested in a callout, a shape nothing else in the editor
// can author), and dropped anywhere outside one it materialised a *new* box around the moved text.
//
// The slice is repaired rather than the gesture refused: unwrapHalfSelectedCallouts
// (components/editor/callout-slice-guard.ts) drops the half-covered box and keeps its contents, on
// `transformPasted`, which prosemirror-view runs over the drag slice as well as the clipboard one.
// So drop and paste answer the same slice the same way.
//
// That was not possible while the drag's own source deletion joined the callout to the block below
// it — a repaired slice still landed in a document the drop had already broken, which is why this
// used to be a blanket refusal. The deletion is now clamped to the edge for every gesture, drops
// included (components/editor/isolating-boundary.ts), so this is the whole rule that remains.
//
// The destinations below are a loop over the four properties every one of them must have. They are
// kept apart because they failed differently before the rule existed — `above` in particular sits
// *before* the dragged range, so the source deletion never mapped the insertion point back inside
// the callout and the old position-by-position guard waved it straight through. That is the
// reported bug.
//
// The native-drag machinery lives in e2e/native-drag.ts — see that file for why a native HTML5
// drag has to be driven through the Chrome DevTools Protocol rather than page.mouse.

// prosemirror-dropcursor's indicator, under either of the two classes it toggles between (block for
// a drop between blocks, inline for one into text).
const DROP_CURSOR = '.prosemirror-dropcursor-block, .prosemirror-dropcursor-inline';

// A refused drop leaves the document and the clipboard exactly as they were, so the notice is the
// whole of the feedback — the same reason the table cell's refusal raises one, and the reason the
// *repaired* drops below must raise none: those land, and the screen says so.
const NOTICE = 'コールアウトは引用やコールアウトの中に入れられません';

const MD = '前の段落です\n\n> [!NOTE]\n>\n> 囲みの中身です\n\n後の段落です\n';
const DOC =
  'doc(paragraph("前の段落です"), callout(paragraph("囲みの中身です")), paragraph("後の段落です"))';
async function openEditor(page: Page, markdown = MD, doc = DOC): Promise<void> {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, markdown);
  expect(await docString(page)).toBe(doc);
}

// From inside the callout down into the paragraph below it. This shape is what puts the callout node
// in the slice, half-covered.
async function selectAcrossCalloutEdge(page: Page): Promise<Point> {
  const editor = page.locator('.ProseMirror');
  const inside = await editor.locator('.markdown-alert p').last().boundingBox();
  const below = await editor.getByText('後の段落です').boundingBox();
  if (!inside || !below) throw new Error('missing boxes');
  return dragSelect(
    page,
    { x: inside.x + 30, y: inside.y + inside.height / 2 },
    { x: below.x + 40, y: below.y + below.height / 2 },
  );
}

// Where each destination is. `text`/`topPadding`/`bottomPadding` are inside the callout — over its
// content and over the box's own padding, which resolve to different positions. `above`/`below` are
// outside it entirely.
type Spot = 'text' | 'topPadding' | 'bottomPadding' | 'above' | 'below';

async function dropPointFor(page: Page, spot: Spot): Promise<Point> {
  const editor = page.locator('.ProseMirror');
  const alert = await editor.locator('.markdown-alert').boundingBox();
  const text = await editor.locator('.markdown-alert p').last().boundingBox();
  const above = await editor.getByText('前の段落です').boundingBox();
  const below = await editor.getByText('後の段落です').boundingBox();
  if (!alert || !text || !above || !below) throw new Error('missing boxes');
  switch (spot) {
    case 'text':
      return { x: text.x + 20, y: text.y + text.height / 2 };
    case 'topPadding':
      return { x: alert.x + alert.width / 2, y: alert.y + 2 };
    case 'bottomPadding':
      return { x: alert.x + alert.width / 2, y: alert.y + alert.height - 2 };
    case 'above':
      return { x: above.x + 10, y: above.y + above.height / 2 };
    case 'below':
      return { x: below.x + 10, y: below.y + below.height / 2 };
  }
}

// One exact tree per destination, not a shared invariant. Every wrong outcome this rule exists to
// stop leaves the callout count at one, nothing nested, the document changed and not a character
// lost — a box that swallowed the paragraph below satisfies all four — so the whole document is
// what tells them apart. The trees are measured, and every one of them shows the same two things:
// the moved text arrived as plain blocks, and the callout kept exactly the 「囲み」 the selection
// didn't cover with the rest still outside it.
const LANDED: Record<Spot, string> = {
  text: 'doc(paragraph("前の段落です"), callout(paragraph("囲の中身です"), paragraph("後の段み")), paragraph("落です"))',
  topPadding:
    'doc(paragraph("前の段落です"), callout(paragraph("の中身です"), paragraph("後の段"), paragraph("囲み")), paragraph("落です"))',
  bottomPadding:
    'doc(paragraph("前の段落です"), callout(paragraph("囲み"), paragraph("の中身です"), paragraph("後の段")), paragraph("落です"))',
  // The reported bug. `above` sits *before* the dragged range, so the source deletion never maps the
  // insertion point back inside the callout and the old position-by-position guard waved it straight
  // through — the moved text arrived wrapped in a brand new box.
  above:
    'doc(paragraph("前の中身です"), paragraph("後の段の段落です"), callout(paragraph("囲み")), paragraph("落です"))',
  below:
    'doc(paragraph("前の段落です"), callout(paragraph("囲み")), paragraph("の中身です"), paragraph("後の段落です"))',
};

// A move moves: it may not lose or duplicate a character. Kept alongside the exact trees because it
// is the one assertion that stays meaningful if the drop lands a pixel elsewhere.
async function documentCharacters(page: Page): Promise<string> {
  const text = await page.locator('.ProseMirror').innerText();
  // The callout's label chip (情報) is non-editable chrome rendered by the NodeView, not document
  // content — it would count as text that appeared from nowhere.
  return [...text.replace(/情報/g, '').replace(/\s/g, '')].sort().join('');
}

for (const spot of ['text', 'topPadding', 'bottomPadding', 'above', 'below'] as const) {
  test(`dragging a callout-crossing selection onto ${spot} moves the text, not the box`, async ({
    page,
  }) => {
    await openEditor(page);
    const editor = page.locator('.ProseMirror');
    const before = await documentCharacters(page);
    const dragFrom = await selectAcrossCalloutEdge(page);

    // The indicator is drawn: this drop is accepted now, where it used to be refused silently.
    // Checked on one destination — the repair that makes it acceptable never looks at position.
    await cdpNativeDrag(page, dragFrom, await dropPointFor(page, spot), async () => {
      if (spot === 'above') await expect(page.locator(DROP_CURSOR)).toHaveCount(1);
    });

    await expect(editor.locator('.markdown-alert')).toHaveCount(1);
    expect(await docString(page)).toBe(LANDED[spot]);
    expect(await documentCharacters(page)).toBe(before);
    // Repaired, not refused: the text landed, so there is nothing to explain. The notice belongs to
    // the two refusals below and must not leak onto the gestures that succeed.
    await expect(page.getByRole('status')).toHaveCount(0);
  });
}

// The gesture a blanket "the slice mentions a callout" refusal would have broken. A selection made
// wholly inside a callout carries the callout too (`Slice(callout(paragraph(…)), 2, 2)`) — but cut
// on *both* sides, so it has no closed edge to preserve and ProseMirror fits it in as plain text
// wherever it lands. It is left alone on purpose.
test('text dragged from inside a callout out to a paragraph stays text', async ({ page }) => {
  await openEditor(page);
  const editor = page.locator('.ProseMirror');

  const inside = await editor.locator('.markdown-alert p').last().boundingBox();
  const above = await editor.getByText('前の段落です').boundingBox();
  if (!inside || !above) throw new Error('missing boxes');
  const dragFrom = await dragSelect(
    page,
    { x: inside.x + 4, y: inside.y + inside.height / 2 },
    { x: inside.x + 40, y: inside.y + inside.height / 2 },
  );

  await cdpNativeDrag(page, dragFrom, { x: above.x + 10, y: above.y + above.height / 2 });

  const after = await docString(page);
  await expect(editor.locator('.markdown-alert')).toHaveCount(1);
  expect(after, after).not.toBe(DOC);
  expect(after, after).not.toContain('callout(callout');
});

// The same slice, aimed at the one destination the rule *does* police. It carries a callout node —
// so a guard reading the slice's raw content refuses it — but opened on both sides, which means
// ProseMirror places the text and never the box. Refusing it was backwards in the most visible way:
// the selection that crosses the callout's edge, which really does carry a box, lands here fine
// (the repair flattens it first), while this harmless one was turned away. placedContent is what
// tells the two apart — see components/editor/slice-placement.ts.
test('text dragged from inside a callout into a quote still lands', async ({ page }) => {
  await openEditor(page, QUOTE_MD, QUOTE_DOC);
  const editor = page.locator('.ProseMirror');

  const inside = await editor.locator('.markdown-alert p').last().boundingBox();
  const quote = await editor.locator('blockquote:not(.markdown-alert) p').first().boundingBox();
  if (!inside || !quote) throw new Error('missing boxes');
  const dragFrom = await dragSelect(
    page,
    { x: inside.x + 4, y: inside.y + inside.height / 2 },
    { x: inside.x + 40, y: inside.y + inside.height / 2 },
  );

  await cdpNativeDrag(
    page,
    dragFrom,
    { x: quote.x + 20, y: quote.y + quote.height / 2 },
    async () => expect(page.locator(DROP_CURSOR)).toHaveCount(1),
  );

  const after = await docString(page);
  expect(after, after).not.toBe(QUOTE_DOC);
  // Text, not a box: no callout inside the quote, and the one it came from is still the only one.
  await expect(editor.locator('blockquote .markdown-alert')).toHaveCount(0);
  await expect(editor.locator('.markdown-alert')).toHaveCount(1);
  await expect(page.getByRole('status')).toHaveCount(0);
});

// The guard must not swallow ordinary drops. Dragging plain text (a slice with no callout in it at
// all) into a callout is a normal edit and still lands.
test('plain text can still be dragged into a callout', async ({ page }) => {
  await openEditor(page);
  const editor = page.locator('.ProseMirror');

  const para = await editor.getByText('前の段落です').boundingBox();
  if (!para) throw new Error('missing box');
  const dragFrom = await dragSelect(
    page,
    { x: para.x + 2, y: para.y + para.height / 2 },
    { x: para.x + 40, y: para.y + para.height / 2 },
  );

  const text = await editor.locator('.markdown-alert p').last().boundingBox();
  if (!text) throw new Error('missing box');
  await cdpNativeDrag(
    page,
    dragFrom,
    { x: text.x + 20, y: text.y + text.height / 2 },
    // The control for the refused cases' `toHaveCount(0)`: over a destination that *will* accept the
    // drop, the indicator is drawn. Without this, hiding it everywhere would look like a pass.
    async () => expect(page.locator(DROP_CURSOR)).toHaveCount(1),
  );

  const after = await docString(page);
  await expect(editor.locator('.markdown-alert .markdown-alert')).toHaveCount(0);
  expect(after, after).not.toBe(DOC);
  expect(after, after).not.toContain('callout(callout');
});

// The half-selected rule must not have swallowed the whole-callout one. A callout the selection
// covers end-to-end sits *closed* in the slice — it is a box genuinely being moved, the shape the
// block drag handle's NodeSelection produces — and where it may go is still decided by position:
// nowhere inside another callout. Two callouts, because a closed callout needs a selection that
// runs past both its edges, and that leaves the box itself no longer a candidate destination.
const TWO_MD =
  '前の段落です\n\n> [!NOTE]\n>\n> 一つ目の中身\n\n間の段落です\n\n> [!NOTE]\n>\n> 二つ目の中身\n\n後の段落です\n';
const TWO_DOC =
  'doc(paragraph("前の段落です"), callout(paragraph("一つ目の中身")), paragraph("間の段落です"), callout(paragraph("二つ目の中身")), paragraph("後の段落です"))';

test('a whole callout carried in the slice is still refused inside a callout', async ({ page }) => {
  await openEditor(page, TWO_MD, TWO_DOC);
  const editor = page.locator('.ProseMirror');

  // From the leading paragraph, past the whole first callout, into the paragraph between the two:
  // openStart and openEnd both stop at those paragraphs, so the callout between them is closed.
  const above = await editor.getByText('前の段落です').boundingBox();
  const between = await editor.getByText('間の段落です').boundingBox();
  const second = await editor.locator('.markdown-alert p').last().boundingBox();
  if (!above || !between || !second) throw new Error('missing boxes');
  const dragFrom = await dragSelect(
    page,
    { x: above.x + 10, y: above.y + above.height / 2 },
    { x: between.x + 40, y: between.y + between.height / 2 },
  );

  await cdpNativeDrag(page, dragFrom, { x: second.x + 20, y: second.y + second.height / 2 });

  await expect(editor.locator('.markdown-alert .markdown-alert')).toHaveCount(0);
  expect(await docString(page)).toBe(TWO_DOC);
  await expect(page.getByRole('status')).toHaveText(NOTICE);
});

// The second container a callout may not be placed in, and the same refusal. `> > [!NOTE]` stores
// and reloads fine, so this one is editorial rather than structural — a quote is someone else's
// words — and it is what setCallout already enforces for the toolbar and the slash menu.
const QUOTE_MD =
  '前の段落です\n\n> [!NOTE]\n>\n> 囲みの中身です\n\n間の段落です\n\n> 引用の中身です\n';
const QUOTE_DOC =
  'doc(paragraph("前の段落です"), callout(paragraph("囲みの中身です")), paragraph("間の段落です"), blockquote(paragraph("引用の中身です")), paragraph)';

test('a whole callout carried in the slice is refused inside a blockquote', async ({ page }) => {
  await openEditor(page, QUOTE_MD, QUOTE_DOC);
  const editor = page.locator('.ProseMirror');

  const above = await editor.getByText('前の段落です').boundingBox();
  const between = await editor.getByText('間の段落です').boundingBox();
  const quote = await editor.locator('blockquote p').first().boundingBox();
  if (!above || !between || !quote) throw new Error('missing boxes');
  const dragFrom = await dragSelect(
    page,
    { x: above.x + 10, y: above.y + above.height / 2 },
    { x: between.x + 40, y: between.y + between.height / 2 },
  );

  await cdpNativeDrag(
    page,
    dragFrom,
    { x: quote.x + 20, y: quote.y + quote.height / 2 },
    async () => expect(page.locator(DROP_CURSOR)).toHaveCount(0),
  );

  await expect(editor.locator('blockquote .markdown-alert')).toHaveCount(0);
  expect(await docString(page)).toBe(QUOTE_DOC);
  await expect(page.getByRole('status')).toHaveText(NOTICE);
});
