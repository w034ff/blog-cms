import type { Locator, Page } from '@playwright/test';

// Driving a native HTML5 drag to completion, for the drop guards.
//
// page.mouse.down()/move()/up() only dispatch trusted *mouse* events and never drive the OS drag
// loop, so ProseMirror's `dragstart` runs but the matching `drop` never does — which leaves every
// drop guard untestable through the normal mouse API.
//
// The way in is the Chrome DevTools Protocol. A real mouse-driven `dragstart` still fires (so
// ProseMirror sets view.dragging — the source of the dropped slice and of the move flag), and
// Input.setInterceptDrags suppresses the OS drag loop that would otherwise stall it. Headless
// Chromium never emits Input.dragIntercepted for a text-selection drag, so rather than wait for it
// we synthesize the DragData and replay dragEnter/dragOver/drop at the target via
// Input.dispatchDragEvent — a deterministic native `drop`. The dropped slice still comes from
// view.dragging, so this stays faithful to a real text move.
//
// Shared by the three drop-guard specs (table, callout, code block header) rather than copied into
// each: they exercise different guards but all need this same one gesture.

// The narrow subset of Input.DragData we build. The CDPSession command types already carry the
// full Protocol shape; this is kept explicit to avoid leaning on the internal Protocol namespace.
interface DragData {
  items: { mimeType: string; data: string }[];
  files?: string[];
  dragOperationsMask: number;
}

export type Point = { x: number; y: number };

// A native drag from `from` to `to`. `whileOver` runs after dragOver and before drop — the only
// moment a hover-time effect (the drop indicator, the refusal cursor) is observable.
export async function cdpNativeDrag(
  page: Page,
  from: Point,
  to: Point,
  whileOver?: () => Promise<void>,
): Promise<void> {
  const client = await page.context().newCDPSession(page);
  try {
    // Suppress the real OS drag loop so it can't race the CDP-driven drop below.
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
    // Hovering, before anything is committed.
    if (whileOver) await whileOver();
    await client.send('Input.dispatchDragEvent', { type: 'drop', x: to.x, y: to.y, data });
    await page.mouse.up();
  } finally {
    await client.send('Input.setInterceptDrags', { enabled: false });
    await client.detach();
  }
}

// The caret boundary after `index` characters of `target`'s text, as a point to aim a drag-select
// endpoint at. Measured from the rendered character rects rather than guessed as a pixel offset
// from the box's left edge.
//
// Why measured: a drag-select resolves its endpoint to a character boundary, and Chrome does not
// snap to the *nearest* one. On the 16px CJK glyphs these specs use, a point 53% through a
// character still ends the selection before it while 78% ends it after — so a hard-coded
// `box.x + 40` sits at whatever fraction of whichever character it happens to reach, and anything
// that moves the font metrics slides it across that threshold. Thirteen specs went red together
// that way. Aimed at the boundary itself the same glyph gives ±6px of margin either side, and it
// says which character it means.
export async function caretPoint(target: Locator, index: number): Promise<Point> {
  return target.evaluate((el, i) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let seen = 0;
    let node = walker.nextNode() as Text | null;
    while (node && seen + node.length < i) {
      seen += node.length;
      node = walker.nextNode() as Text | null;
    }
    if (!node) {
      throw new Error(`caretPoint: no character ${i} in ${JSON.stringify(el.textContent)}`);
    }
    const range = document.createRange();
    range.setStart(node, i - seen);
    range.collapse(true);
    const rect = range.getBoundingClientRect();
    return { x: rect.x, y: rect.y + rect.height / 2 };
  }, index);
}

// Drag-select between two points and leave the selection in place — dragstart only fires on a
// mousedown inside a live selection, so the drop-guard specs cannot use setTextSelection.
//
// The point returned is the drag origin the callers hand to cdpNativeDrag, and it is taken from the
// selection *as realized* rather than echoing `end`. `end` is the selection's own edge: fine while
// it sat mid-character, but once it is aimed at a caret boundary (caretPoint above) a mousedown
// there is as likely to fall outside the selection as in — and outside, dragstart never fires and
// the drop under test never happens. The rect nearest `end` keeps the origin where the caller
// meant it, pulled far enough inside to be unambiguous.
export async function dragSelect(page: Page, start: Point, end: Point): Promise<Point> {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  return page.evaluate((to) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return to;
    // Zero-width and hairline rects are line ends and empty blocks the range happens to span;
    // neither leaves room to sit inside.
    const rects = [...selection.getRangeAt(0).getClientRects()].filter((r) => r.width >= 8);
    if (rects.length === 0) return to;
    const mid = (r: DOMRect) => r.y + r.height / 2;
    const nearest = rects.reduce((best, r) =>
      Math.abs(mid(r) - to.y) < Math.abs(mid(best) - to.y) ? r : best,
    );
    return {
      x: Math.min(Math.max(to.x, nearest.x + 3), nearest.right - 3),
      y: mid(nearest),
    };
  }, end);
}
