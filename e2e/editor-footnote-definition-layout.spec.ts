import { test, expect, type Page } from '@playwright/test';
import { loadMarkdown } from './editor-authoring';
import { caret, settle } from './editor-probe';

// The definitions' `[n]` marker is drawn by CSS (`app/globals.css`, `div[data-footnote-def]::before`)
// because the number is a decoration (docs/footnote-requirements.md §4). Out of flow since the flex
// row went, so what can go wrong now: an over-wide marker overlaps the note; the reserve and the
// indent, two custom properties, drift apart; and the flex row's caret bug returning. Eleven notes:
// 9 to 10 is where the marker widens.
const COUNT = Number(process.env.FOOTNOTE_COUNT ?? 11);

const SOURCE = `${Array.from({ length: COUNT }, (_, i) => `文${i + 1}[^n${i + 1}]`).join('')}\n\n${Array.from(
  { length: COUNT },
  (_, i) => `[^n${i + 1}]: 注釈テキスト${i + 1}`,
).join('\n')}\n`;

// `getComputedStyle(el, '::before')` for the marker; a Range over the inline content for the note.
function definitionBoxes(page: Page) {
  return page.$$eval('.ProseMirror div[data-footnote-def]', (defs) =>
    defs.map((def) => {
      const range = document.createRange();
      range.selectNodeContents(def);
      const round = (n: number) => Math.round(n * 100) / 100;
      return {
        markerWidth: round(parseFloat(getComputedStyle(def, '::before').width)),
        defLeft: round(def.getBoundingClientRect().left),
        textLeft: round(range.getBoundingClientRect().left),
      };
    }),
  );
}

test('a marker never reaches the note beside it', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await loadMarkdown(page, SOURCE);
  await expect(page.locator('.ProseMirror div[data-footnote-def]')).toHaveCount(COUNT);
  // Glyph advances: measure after the web font loads, not the fallback.
  await page.evaluate(() => document.fonts.ready);

  const section = page.locator('.ProseMirror div[data-footnote-section]');
  await section.scrollIntoViewIfNeeded();
  await section.screenshot({ path: 'e2e/.tmp/footnote-markers-after.png' });

  const boxes = await definitionBoxes(page);
  const lefts = boxes.map((b) => b.textLeft);
  expect(new Set(lefts).size, `note text left edges: ${lefts.join(', ')}`).toBe(1);

  // The clearance between reserve and note; nothing else keeps the two declarations aligned.
  for (const { markerWidth, defLeft, textLeft } of boxes) {
    expect(
      defLeft + markerWidth,
      `marker of width ${markerWidth} against text at ${textLeft}`,
    ).toBeLessThanOrEqual(textLeft);
  }

  // What a marker needs against what it is given: `width` is fixed, so the natural width is asked
  // for. An over-wide marker overlaps the note, so the headroom is a number.
  const reserve = boxes[0].markerWidth;
  await page.addStyleTag({
    content: '.ProseMirror div[data-footnote-def]::before { width: max-content !important; }',
  });
  const natural = (await definitionBoxes(page)).map((b) => b.markerWidth);
  const widest = Math.max(...natural);
  expect(
    widest,
    `reserve ${reserve}px, widest marker ${widest}px (${natural.join(', ')})`,
  ).toBeLessThanOrEqual(reserve);
  console.log(`marker reserve ${reserve}px, widest of ${COUNT} is ${widest}px`);
});

test('the empty-note placeholder sits where a written note does, on both axes', async ({
  page,
}) => {
  // §5.2's placeholder `::after`, positioned. Both axes: out of flex the empty definition's `<br>` is a
  // line break, and `top: auto` put the placeholder on the second line over the next note. Measured
  // where it paints against where written text starts; the third definition gives a slip room.
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await loadMarkdown(page, '本文[^a]と[^b]と[^c]\n\n[^a]: 注A\n[^b]:\n[^c]: 注C\n');
  await page.evaluate(() => document.fonts.ready);

  const section = page.locator('.ProseMirror div[data-footnote-section]');
  await section.scrollIntoViewIfNeeded();
  await section.screenshot({ path: 'e2e/.tmp/footnote-empty-placeholder.png' });

  // Each against its own box: the placeholder's origin is the padding box (here the border box) plus
  // its used offsets, which Chrome resolves to px even for `auto`.
  const [written, empty] = await page.$$eval('.ProseMirror div[data-footnote-def]', (defs) =>
    defs.slice(0, 2).map((def) => {
      const round = (n: number) => Math.round(n * 100) / 100;
      const box = def.getBoundingClientRect();
      const after = getComputedStyle(def, '::after');
      const range = document.createRange();
      range.selectNodeContents(def);
      return {
        empty: def.hasAttribute('data-empty'),
        height: round(box.height),
        // The content start inside the definition.
        left: def.hasAttribute('data-empty')
          ? round(parseFloat(after.left))
          : round(range.getBoundingClientRect().left - box.left),
        // Only the placeholder has a `top`; written text is on the first line by construction.
        top: def.hasAttribute('data-empty') ? round(parseFloat(after.top)) : null,
      };
    }),
  );
  expect(written.empty, 'the first definition is the written one').toBe(false);
  expect(empty.empty, 'the second definition is the empty one').toBe(true);

  const where = `written note starts ${written.left}px in, placeholder at (${empty.left}, ${empty.top}) in a ${empty.height}px definition`;
  // Sub-pixel: an offset against a difference of rects.
  expect(empty.left, where).toBeCloseTo(written.left, 1);
  // On the first line: `top` is the content top, with no vertical padding.
  expect(empty.top, where).toBeGreaterThanOrEqual(0);
  expect(empty.top, where).toBeLessThan(empty.height / 2);
});

test('clicking to the right of a note puts the caret at its end, not its start', async ({
  page,
}) => {
  // Why the flex row went: it returned `注釈テキスト@0`, the note's start. Seen failing first.
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await loadMarkdown(page, '普通の段落\n\n本文[^a]\n\n[^a]: 注釈テキスト\n');
  await page.evaluate(() => document.fonts.ready);

  const clickAtRightEdge = async (locator: ReturnType<typeof page.locator>) => {
    const box = (await locator.boundingBox())!;
    await page.mouse.click(box.x + box.width - 8, box.y + box.height / 2);
    await settle(page);
    return caret(page);
  };

  // The control: what every other block does.
  expect(await clickAtRightEdge(page.locator('.ProseMirror > p').first())).toBe('普通の段落@5');
  expect(await clickAtRightEdge(page.locator('.ProseMirror div[data-footnote-def]').first())).toBe(
    '注釈テキスト@6',
  );
});
