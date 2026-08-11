import { test, expect, type Page } from '@playwright/test';
import { loadMarkdown } from './editor-authoring';
import { caret, settle } from './editor-probe';

// The definitions' `[n]` marker is drawn by CSS (`app/globals.css`, `div[data-footnote-def]::before`)
// because the number is a decoration, not an attribute — docs/footnote-requirements.md §4. That puts
// it outside anything vitest can see, and it has now caused two separate defects, so what this file
// measures has moved once already.
//
// It began as a flex row, and these tests began as width assertions. The marker was a `flex: none`
// item, so without a reserved box it was exactly as wide as its own glyphs; Geist's figures are
// proportional, `[1]` came out narrower than `[2]`, and every note's text started at a different x.
//
// The row is gone (2026-08-09). The note beside a flex marker was an anonymous item that
// shrink-wrapped to its own text, leaving most of the row inside no line box at all, and a click out
// there put the caret at the note's START instead of its end. The marker is out of flow now and the
// definition is an ordinary block.
//
// So the original defect is no longer reachable — the indent is padding, and padding does not vary
// with a glyph. These tests are aimed at what the CURRENT layout can get wrong instead:
//
//   - an over-wide marker no longer pushes the note text right, it OVERLAPS it (out of flow, it
//     displaces nothing), so the reserve is checked against what a marker actually needs;
//   - the reserve and the indent are two declarations reading two custom properties, and they can
//     drift apart into an overlap without either one looking wrong on its own;
//   - and the caret behaviour the change was made for, which nothing else here would notice if a
//     later edit brought the flex row back.
//
// Eleven notes on purpose: 9 vs 10 is the digit boundary, where a marker's width changes.
const COUNT = Number(process.env.FOOTNOTE_COUNT ?? 11);

const SOURCE = `${Array.from({ length: COUNT }, (_, i) => `文${i + 1}[^n${i + 1}]`).join('')}\n\n${Array.from(
  { length: COUNT },
  (_, i) => `[^n${i + 1}]: 注釈テキスト${i + 1}`,
).join('\n')}\n`;

// The marker is a pseudo-element, so it has no node to measure — `getComputedStyle(el, '::before')`
// is the only way to read its used width. The note beside it has no element of its own either (the
// definition's content is inline), so a Range over the contents is what has a box.
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
  // Every number here is a glyph advance, so measuring before Geist swaps in would measure the
  // Arial fallback instead — the same run, a different font, and no way to tell from the result.
  await page.evaluate(() => document.fonts.ready);

  const section = page.locator('.ProseMirror div[data-footnote-section]');
  await section.scrollIntoViewIfNeeded();
  await section.screenshot({ path: 'e2e/.tmp/footnote-markers-after.png' });

  const boxes = await definitionBoxes(page);
  const lefts = boxes.map((b) => b.textLeft);
  expect(new Set(lefts).size, `note text left edges: ${lefts.join(', ')}`).toBe(1);

  // The reserve sits at the definition's own left edge and the note starts at the padding edge, so
  // this difference is the whole clearance between them. It is two declarations reading two custom
  // properties; nothing but this holds them in the same place.
  for (const { markerWidth, defLeft, textLeft } of boxes) {
    expect(
      defLeft + markerWidth,
      `marker of width ${markerWidth} against text at ${textLeft}`,
    ).toBeLessThanOrEqual(textLeft);
  }

  // What a marker actually needs, as against what it is given. `width` is fixed, so the rendered box
  // cannot report this — the natural width has to be asked for. Out of flow, a marker wider than its
  // reserve does not push the note aside, it prints on top of it, which is why the headroom is worth
  // a number rather than an eyeball.
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
  // §5.2's placeholder is a `::after`, positioned rather than laid out — an empty definition still
  // holds a trailing `<br>`, and under the flex row that `<br>` was an item with a width of its own
  // that pushed the placeholder a few pixels right of every filled note's text.
  //
  // BOTH axes, because the version of this test written for the flex row checked only `left`, and
  // out of flex it could not fail: it compared the computed `left` against the note's own offset,
  // and after the row became a padded block those are the same `calc()` twice. Meanwhile the axis it
  // was not watching had broken — out of flex the `<br>` is a forced line break, so a `top: auto`
  // placeholder took its static position on the definition's SECOND line and painted over the note
  // below it. So this measures where the placeholder is actually painted, against where a written
  // note's text actually is, and a third definition below the empty one gives the vertical slip
  // something to land on.
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await loadMarkdown(page, '本文[^a]と[^b]と[^c]\n\n[^a]: 注A\n[^b]:\n[^c]: 注C\n');
  await page.evaluate(() => document.fonts.ready);

  const section = page.locator('.ProseMirror div[data-footnote-section]');
  await section.scrollIntoViewIfNeeded();
  await section.screenshot({ path: 'e2e/.tmp/footnote-empty-placeholder.png' });

  // Both definitions are measured against their OWN box, since they sit at different y. A
  // pseudo-element has no node to measure, so the placeholder's painted origin is its containing
  // block — the definition's PADDING box, which here is its border box — plus its used offsets.
  // Chrome resolves those to px even when the declaration is `auto`, which is what lets the
  // vertical assertion below fail rather than read `auto` and give up.
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
        // Where the content starts, as an offset inside the definition: the placeholder's used
        // offsets, or the note's own glyphs.
        left: def.hasAttribute('data-empty')
          ? round(parseFloat(after.left))
          : round(range.getBoundingClientRect().left - box.left),
        // Only the placeholder has a vertical offset to read: a written note is in flow, so its
        // line is the definition's own first line by construction.
        top: def.hasAttribute('data-empty') ? round(parseFloat(after.top)) : null,
      };
    }),
  );
  expect(written.empty, 'the first definition is the written one').toBe(false);
  expect(empty.empty, 'the second definition is the empty one').toBe(true);

  const where = `written note starts ${written.left}px in, placeholder at (${empty.left}, ${empty.top}) in a ${empty.height}px definition`;
  // Sub-pixel: one side is a used offset, the other the difference of two viewport rects.
  expect(empty.left, where).toBeCloseTo(written.left, 1);
  // The placeholder starts on the definition's own first line — its used `top` is the definition's
  // content top, which has no vertical padding above it. This is the statement the static position
  // broke: measured before the fix it read 23.05px in a 23.05px definition, one whole line box down
  // and printing over the note below.
  expect(empty.top, where).toBeGreaterThanOrEqual(0);
  expect(empty.top, where).toBeLessThan(empty.height / 2);
});

test('clicking to the right of a note puts the caret at its end, not its start', async ({
  page,
}) => {
  // The reason the flex row was removed, and the only assertion here that can tell the two layouts
  // apart: as a flex row this returned `注釈テキスト@0`. Written before the change and watched fail,
  // so it is known to distinguish them rather than assumed to.
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

  // The control: what every other block in this editor does with the same gesture.
  expect(await clickAtRightEdge(page.locator('.ProseMirror > p').first())).toBe('普通の段落@5');
  expect(await clickAtRightEdge(page.locator('.ProseMirror div[data-footnote-def]').first())).toBe(
    '注釈テキスト@6',
  );
});
