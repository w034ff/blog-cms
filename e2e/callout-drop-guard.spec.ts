import { test, expect, type Page } from '@playwright/test';
import { docString } from './editor-probe';
import { loadMarkdown } from './editor-authoring';
import { caretPoint, cdpNativeDrag, dragSelect, type Point } from './native-drag';

// A selection crossing a callout's edge drags `<callout(paragraph(…)), paragraph(…)>`. Dropped in a
// callout it nested one; elsewhere it made a new box around the moved text. The slice is repaired:
// unwrapHalfSelectedCallouts (callout-slice-guard.ts) keeps the half-covered box's contents, on
// `transformPasted`, which covers drag and clipboard alike. The drag's source deletion is clamped
// (isolating-boundary.ts), so a repaired slice lands in an intact document.
//
// The destinations are kept apart because they failed differently: `above` sits before the range,
// so the old per-position guard waved it through. CDP drag: e2e/native-drag.ts.

// prosemirror-dropcursor's indicator, block or inline.
const DROP_CURSOR = '.prosemirror-dropcursor-block, .prosemirror-dropcursor-inline';

// A refusal changes nothing, so the notice is the whole feedback; repaired drops land and raise none.
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

// From inside the callout into the paragraph below: the callout half-covered in the slice. Measured
// caret boundaries (e2e/native-drag.ts): LANDED states exact trees, so the covered characters matter.
async function selectAcrossCalloutEdge(page: Page): Promise<Point> {
  const editor = page.locator('.ProseMirror');
  const from = await dragSelect(
    page,
    await caretPoint(editor.locator('.markdown-alert p').last(), 2),
    await caretPoint(editor.getByText('後の段落です'), 3),
  );
  // Guard the guard: a short selection would fail as a baffling one-character mismatch.
  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '');
  expect(selected).toContain('の中身です');
  expect(selected).toContain('後の段');
  return from;
}

// Inside the callout (its text, its top and bottom padding, which resolve differently) or outside.
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

// One exact tree each: a box that swallowed the paragraph below passes every shared invariant. Each
// shows the moved text as plain blocks and the callout keeping only the uncovered 「囲み」.
const LANDED: Record<Spot, string> = {
  text: 'doc(paragraph("前の段落です"), callout(paragraph("囲の中身です"), paragraph("後の段み")), paragraph("落です"))',
  topPadding:
    'doc(paragraph("前の段落です"), callout(paragraph("の中身です"), paragraph("後の段"), paragraph("囲み")), paragraph("落です"))',
  bottomPadding:
    'doc(paragraph("前の段落です"), callout(paragraph("囲み"), paragraph("の中身です"), paragraph("後の段")), paragraph("落です"))',
  // The reported bug: the moved text arrived in a new box.
  above:
    'doc(paragraph("前の中身です"), paragraph("後の段の段落です"), callout(paragraph("囲み")), paragraph("落です"))',
  below:
    'doc(paragraph("前の段落です"), callout(paragraph("囲み")), paragraph("の中身です"), paragraph("後の段落です"))',
};

// A move loses and duplicates nothing; meaningful even if the drop lands a pixel off.
async function documentCharacters(page: Page): Promise<string> {
  const text = await page.locator('.ProseMirror').innerText();
  // The label chip (情報) is NodeView chrome, not content.
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

    // The indicator shows: accepted. The repair ignores position, so one destination suffices.
    await cdpNativeDrag(page, dragFrom, await dropPointFor(page, spot), async () => {
      if (spot === 'above') await expect(page.locator(DROP_CURSOR)).toHaveCount(1);
    });

    await expect(editor.locator('.markdown-alert')).toHaveCount(1);
    expect(await docString(page)).toBe(LANDED[spot]);
    expect(await documentCharacters(page)).toBe(before);
    // Repaired, not refused, so no notice.
    await expect(page.getByRole('status')).toHaveCount(0);
  });
}

// Wholly inside a callout, the slice is `Slice(callout(paragraph(…)), 2, 2)`, open on both sides, so
// ProseMirror places only text; left alone on purpose.
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

// The same slice into a quote: it contains a callout, but open on both sides only the text is placed
// (placedContent, slice-placement.ts), so it must not be refused.
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
  // Text, not a box: the source callout is still the only one.
  await expect(editor.locator('blockquote .markdown-alert')).toHaveCount(0);
  await expect(editor.locator('.markdown-alert')).toHaveCount(1);
  await expect(page.getByRole('status')).toHaveCount(0);
});

// The same slices at a block position, where ProseMirror closes what is open and the wrapper came
// back as a real box (a callout nested in a quote, reached around wouldNestCallout). Wrapper levels
// open at both ends are removed on entry (slice-placement.ts), in both directions.
for (const [name, source, target, hostLocator] of [
  ['a callout', '.markdown-alert p', 'blockquote:not(.markdown-alert)', 'blockquote'],
  ['a quote', 'blockquote:not(.markdown-alert) p', '.markdown-alert', '.markdown-alert'],
] as const) {
  test(`text dragged out of ${name} onto a block edge lands as a paragraph`, async ({ page }) => {
    await openEditor(page, QUOTE_MD, QUOTE_DOC);
    const editor = page.locator('.ProseMirror');

    const from = await editor.locator(source).last().boundingBox();
    const host = await editor.locator(target).first().boundingBox();
    if (!from || !host) throw new Error('missing boxes');
    const dragFrom = await dragSelect(
      page,
      { x: from.x + 4, y: from.y + from.height / 2 },
      { x: from.x + 50, y: from.y + from.height / 2 },
    );

    // The host's top padding: a block position, confirmed by the horizontal indicator.
    await cdpNativeDrag(page, dragFrom, { x: host.x + host.width / 2, y: host.y + 2 }, async () =>
      expect(page.locator('.prosemirror-dropcursor-block')).toHaveCount(1),
    );

    // Still one callout and one quote, neither nested.
    await expect(editor.locator('.markdown-alert')).toHaveCount(1);
    await expect(editor.locator('blockquote:not(.markdown-alert)')).toHaveCount(1);
    await expect(editor.locator(`${hostLocator} .markdown-alert`)).toHaveCount(0);
    await expect(editor.locator(`${hostLocator} blockquote`)).toHaveCount(0);
    // It landed as a paragraph in the host.
    const after = await docString(page);
    expect(after, after).not.toBe(QUOTE_DOC);
    await expect(page.getByRole('status')).toHaveCount(0);
  });
}

// Plain text still drops into a callout.
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
    // The control: the indicator draws where a drop is accepted.
    async () => expect(page.locator(DROP_CURSOR)).toHaveCount(1),
  );

  const after = await docString(page);
  await expect(editor.locator('.markdown-alert .markdown-alert')).toHaveCount(0);
  expect(after, after).not.toBe(DOC);
  expect(after, after).not.toContain('callout(callout');
});

// A callout covered end to end sits closed in the slice (as a NodeSelection's does) and is placed
// by position, never inside another callout. Two callouts, so the moved one is not a destination.
const TWO_MD =
  '前の段落です\n\n> [!NOTE]\n>\n> 一つ目の中身\n\n間の段落です\n\n> [!NOTE]\n>\n> 二つ目の中身\n\n後の段落です\n';
const TWO_DOC =
  'doc(paragraph("前の段落です"), callout(paragraph("一つ目の中身")), paragraph("間の段落です"), callout(paragraph("二つ目の中身")), paragraph("後の段落です"))';

test('a whole callout carried in the slice is still refused inside a callout', async ({ page }) => {
  await openEditor(page, TWO_MD, TWO_DOC);
  const editor = page.locator('.ProseMirror');

  // Past the whole first callout: open ends stop at the paragraphs, so the callout is closed.
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

// Nor in a quote: editorial, as setCallout enforces for the toolbar and slash menu.
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
