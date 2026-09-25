import { test, expect, type Page } from '@playwright/test';
import { docString } from './editor-probe';
import { loadMarkdown } from './editor-authoring';
import { caretPoint, cdpNativeDrag, dragSelect } from './native-drag';

// A NodeView's controls refuse drops of content from this document (`refuseChromeDrops`,
// useDragContainment.ts), as the code block header does: `stopEvent` makes `eventBelongsToView`
// give up, so ProseMirror's drop path never runs and Chrome moves the text. On the card's picker:
//
//   before  doc(paragraph("前の段落です"), linkCard, paragraph("後の段落です"))
//   after   doc(paragraph("です"),        linkCard, paragraph("後の段落です"))   search box: 前の段落
//
// The document is the primary assertion. Both cards are covered: the exposure comes from claiming
// events, not from the control.

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

    // Measured caret boundaries (e2e/native-drag.ts), checked before the gesture: an empty drag would
    // pass everything.
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
