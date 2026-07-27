import { test, expect, type Page } from '@playwright/test';
import { docString } from './editor-probe';
import { loadMarkdown } from './editor-authoring';

// A selection crossing a callout's edge drags a slice that *contains the callout node*: select from
// inside one down into the paragraph below and ProseMirror hands the drag
// `<callout(paragraph(…)), paragraph(…)>`. Nobody asked to move that box, and no destination does
// anything sensible with it — dropped inside another callout it went in as a child (a callout nested
// in a callout, a shape nothing else in the editor can author), dropped anywhere outside one it
// materialised a *new* box around the moved text, and either way the move's own source deletion
// joined the callout to the paragraph below it. So carriesHalfSelectedCallout
// (components/editor/callout-slice-guard.ts) refuses the gesture wherever it is aimed.
//
// Which is why the destinations below are a loop asserting one identical thing: the document is
// untouched. They are kept apart anyway because they failed differently before the rule existed —
// `above` in particular sits *before* the dragged range, so the source deletion never mapped the
// insertion point back inside the callout and the old position-by-position guard waved it straight
// through. That is the reported bug.
//
// Same machinery as e2e/table-drop-guard.spec.ts — see that file's header for why a native HTML5
// drag has to be driven through the Chrome DevTools Protocol rather than page.mouse.

interface DragData {
  items: { mimeType: string; data: string }[];
  dragOperationsMask: number;
}
type Point = { x: number; y: number };

// prosemirror-dropcursor's indicator, under either of the two classes it toggles between (block for
// a drop between blocks, inline for one into text).
const DROP_CURSOR = '.prosemirror-dropcursor-block, .prosemirror-dropcursor-inline';

async function cdpNativeDrag(
  page: Page,
  from: Point,
  to: Point,
  whileOver?: () => Promise<void>,
): Promise<void> {
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('Input.setInterceptDrags', { enabled: true });
    // A real mouse-driven dragstart, so ProseMirror populates view.dragging (the slice that gets
    // inserted, and the move flag) exactly as it would for a user.
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 8, from.y + 8, { steps: 6 });
    const selectedText = await page.evaluate(() => window.getSelection()?.toString() ?? '');
    const data: DragData = {
      items: [{ mimeType: 'text/plain', data: selectedText }],
      dragOperationsMask: 16, // Move
    };
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await client.send('Input.dispatchDragEvent', { type: 'dragEnter', x: to.x, y: to.y, data });
    await client.send('Input.dispatchDragEvent', { type: 'dragOver', x: to.x, y: to.y, data });
    // Hovering, before anything is committed — the only moment the drop indicator is observable.
    if (whileOver) await whileOver();
    await client.send('Input.dispatchDragEvent', { type: 'drop', x: to.x, y: to.y, data });
    await page.mouse.up();
  } finally {
    await client.send('Input.setInterceptDrags', { enabled: false });
    await client.detach();
  }
}

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

// Drag-select between two points and leave the selection in place — dragstart only fires on a
// mousedown inside a live selection, so these tests cannot use setTextSelection.
async function dragSelect(page: Page, start: Point, end: Point): Promise<Point> {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  return end;
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

for (const spot of ['text', 'topPadding', 'bottomPadding', 'above', 'below'] as const) {
  test(`dragging a callout-crossing selection onto ${spot} is refused outright`, async ({
    page,
  }) => {
    await openEditor(page);
    const editor = page.locator('.ProseMirror');
    const dragFrom = await selectAcrossCalloutEdge(page);

    // A refused drop is a silent one, so the drop indicator hiding is the whole of the feedback the
    // gesture gives. Checked while hovering, on one destination — the rule that hides it never looks
    // at position, and asserting it five times would only re-test that.
    await cdpNativeDrag(page, dragFrom, await dropPointFor(page, spot), async () => {
      if (spot === 'above') await expect(page.locator(DROP_CURSOR)).toHaveCount(0);
    });

    // Exact, not "no nesting appeared": every wrong outcome this rule exists to stop — the new box
    // at the destination, the callout swallowing the paragraph below — keeps the callout count at
    // one and every character in place. Only the whole document tells them apart.
    await expect(editor.locator('.markdown-alert')).toHaveCount(1);
    expect(await docString(page)).toBe(DOC);
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
});
