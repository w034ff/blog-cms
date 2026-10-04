import { expect, type Locator, type Page } from '@playwright/test';

// Driving a native HTML5 drag to completion, for the drop guards. page.mouse never enters the OS
// drag loop, so ProseMirror's `dragstart` runs but `drop` never does. Through CDP: a real
// mouse-driven `dragstart` still sets view.dragging (the slice and the move flag), and
// Input.setInterceptDrags suppresses the OS loop. Headless Chromium never emits
// Input.dragIntercepted for a text drag, so the DragData is synthesized and dragEnter/dragOver/drop
// are replayed via Input.dispatchDragEvent: a deterministic native `drop`.

// The subset of Input.DragData we build, kept explicit to avoid the internal Protocol namespace.
interface DragData {
  items: { mimeType: string; data: string }[];
  files?: string[];
  dragOperationsMask: number;
}

export type Point = { x: number; y: number };

// `whileOver` runs between dragOver and drop, the only moment a hover-time effect (the drop
// indicator, the refusal cursor) is observable.
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
    // A real mouse-driven dragstart, so ProseMirror populates view.dragging as for a user.
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

// The caret boundary after `index` characters of `target`, from the rendered character rects.
// Chrome does not snap a drag-select to the nearest boundary (on a 16px CJK glyph, 53% through
// still ends before it), so a pixel offset slides across the threshold whenever font metrics move.
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

// Drag-select and leave the selection in place: dragstart fires only on a mousedown inside a live
// selection, so setTextSelection cannot stand in. Returns the drag origin from the selection as
// realized, pulled inside it: a mousedown at `end`, a caret boundary, may fall outside, and then
// no drag happens.
export async function dragSelect(page: Page, start: Point, end: Point): Promise<Point> {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  return page.evaluate((to) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return to;
    // Zero-width and hairline rects are line ends and empty blocks, with no room inside.
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

// The fixture both "a drag out of the editor destroys the source" guards start from:
// codeblock-header-drop-guard.spec.ts (`refuseChromeDrops`, the header) and
// editor-drag-containment.spec.ts (useDragContainment, the form fields). Chrome's own move deletes
// the dragged range from the contenteditable, so the selection spans a boundary ProseMirror would
// never authorize. It travels with the helper, which names its text.
export const CODE_EDGE_MD = '前の段落です\n\n```ts\nconst x = 1;\n```\n\n後の段落です\n';
// The code block's trailing "\n" is markdown-it's fence output, part of the loaded document.
export const CODE_EDGE_DOC =
  'doc(paragraph("前の段落です"), codeBlock("const x = 1;\\n"), paragraph("後の段落です"))';

// From inside the code body into the paragraph below: the slice carries the code block and the
// text/plain a newline. Endpoints are measured caret boundaries (callers count characters); the
// <code> box is two lines tall, and its midpoint's empty line would select nothing and pass
// vacuously. Returns the drag origin.
export async function selectAcrossCodeEdge(page: Page): Promise<Point> {
  const editor = page.locator('.ProseMirror');
  const from = await dragSelect(
    page,
    await caretPoint(editor.locator('.code-block code'), 1),
    await caretPoint(editor.getByText('後の段落です'), 3),
  );
  // Guard the guard: assert the selection actually spans the boundary before dragging it.
  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '');
  expect(selected).toContain('後の段');
  expect(selected).toContain('x = 1;');
  return from;
}
