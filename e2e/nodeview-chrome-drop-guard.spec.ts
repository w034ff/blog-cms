import { test, expect, type Page } from '@playwright/test';
import { docString } from './editor-probe';
import { loadMarkdown } from './editor-authoring';
import { caretPoint, cdpNativeDrag, dragSelect } from './native-drag';

// A NodeView's own controls are not a drop target for content dragged out of this document
// (refuseChromeDrops in components/editor/useDragContainment.ts).
//
// The same exposure the code block header has (e2e/codeblock-header-drop-guard.spec.ts), reached
// through the other two NodeViews that claim their controls with `stopEvent`. The claim is what
// creates it: prosemirror-view's `eventBelongsToView` walks up from `event.target` and gives up as
// soon as a `stopEvent` claims it, so ProseMirror's drop path never runs for those events and the
// browser's own default is the whole answer. Measured on the link card's picker before the guard:
//
//   before  doc(paragraph("前の段落です"), linkCard, paragraph("後の段落です"))
//   after   doc(paragraph("です"),        linkCard, paragraph("後の段落です"))   search box: 前の段落
//
// The document's text is moved out of the contenteditable by Chrome — a change ProseMirror never
// authorized and cannot undo as one step. The document assertion is therefore the primary one; the
// control's own value is the secondary check.
//
// Both cards are covered rather than the one that was measured to lose text: the exposure comes
// from *claiming events*, not from what the control happens to be, so a spec naming only the input
// would keep passing if a droppable control were added to the other band later.

const CARD_EMPTY = '<div class="link-card" data-href=""></div>';
const CARD = '<div class="link-card" data-href="/posts/second-post"></div>';
const EMBED = '<div class="embed" data-href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"></div>';

const CASES = [
  {
    name: "the link card's picker search box",
    md: CARD_EMPTY,
    control: '.link-card-view input',
    doc: 'doc(paragraph("前の段落です"), linkCard, paragraph("後の段落です"))',
  },
  {
    name: "the link card's action buttons",
    md: CARD,
    control: '.link-card-head button',
    doc: 'doc(paragraph("前の段落です"), linkCard, paragraph("後の段落です"))',
  },
  {
    name: "the embed's action button",
    md: EMBED,
    control: '.embed-head button',
    doc: 'doc(paragraph("前の段落です"), embed, paragraph("後の段落です"))',
  },
] as const;

async function openEditor(page: Page, md: string, doc: string): Promise<void> {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, `前の段落です\n\n${md}\n\n後の段落です\n`);
  expect(await docString(page)).toBe(doc);
}

for (const { name, md, control, doc } of CASES) {
  test(`a selection dragged onto ${name} is refused`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openEditor(page, md, doc);
    const editor = page.locator('.ProseMirror');
    const target = editor.locator(control).first();
    await expect(target).toBeVisible();
    const before = await target.evaluate((el) =>
      el instanceof HTMLInputElement ? el.value : (el.textContent ?? ''),
    );

    // Endpoints measured on the rendered text rather than taken as pixel offsets (caretPoint,
    // e2e/native-drag.ts) — a drag that selected nothing would make every assertion below pass
    // vacuously, so the selection is checked before the gesture is driven.
    const from = await dragSelect(
      page,
      await caretPoint(editor.getByText('前の段落です'), 0),
      await caretPoint(editor.getByText('前の段落です'), 4),
    );
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('前の段落');

    const box = await target.boundingBox();
    if (!box) throw new Error('missing bounding box');
    await cdpNativeDrag(page, from, { x: box.x + box.width / 2, y: box.y + box.height / 2 });

    expect(await docString(page)).toBe(doc);
    expect(
      await target.evaluate((el) =>
        el instanceof HTMLInputElement ? el.value : (el.textContent ?? ''),
      ),
    ).toBe(before);
    expect(errors).toEqual([]);
  });
}
