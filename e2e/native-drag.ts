import type { Page } from '@playwright/test';

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

// Drag-select between two points and leave the selection in place — dragstart only fires on a
// mousedown inside a live selection, so the drop-guard specs cannot use setTextSelection.
export async function dragSelect(page: Page, start: Point, end: Point): Promise<Point> {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  return end;
}
