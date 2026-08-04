import { test, expect } from '@playwright/test';
import { loadMarkdown } from './editor-authoring';

// The definitions' `[n]` marker is drawn by CSS (`app/globals.css`, `div[data-footnote-def]::before`)
// because the number is a decoration, not an attribute — see docs/footnote-requirements.md §4. That
// puts its width outside anything vitest can see: the marker is a `flex: none` item, so without a
// reserved box it is exactly as wide as its own glyphs. Geist's figures are proportional, so `[1]`
// came out narrower than `[2]` and every note's text started at a different x. Only the definitions
// show it — they are the only footnote chrome that stacks vertically.
//
// Eleven notes on purpose: 1 vs 2 is the reported symptom, 9 vs 10 is the same defect at the digit
// boundary, where it is wide enough to be unmistakable.
const COUNT = Number(process.env.FOOTNOTE_COUNT ?? 11);

const SOURCE = `${Array.from({ length: COUNT }, (_, i) => `文${i + 1}[^n${i + 1}]`).join('')}\n\n${Array.from(
  { length: COUNT },
  (_, i) => `[^n${i + 1}]: 注釈テキスト${i + 1}`,
).join('\n')}\n`;

// The marker is a pseudo-element, so it has no node to measure — `getComputedStyle(el, '::before')`
// is the only way to read its used width.
function markerWidths(page: import('@playwright/test').Page): Promise<number[]> {
  return page.$$eval('.ProseMirror div[data-footnote-def]', (defs) =>
    defs.map((def) => parseFloat(getComputedStyle(def, '::before').width)),
  );
}

// What the author actually sees misaligned: where the note's own words begin. The definition's
// content is inline, so it is an anonymous flex item with no element of its own — a Range over the
// text node is what has a box.
function textLeftEdges(page: import('@playwright/test').Page): Promise<number[]> {
  return page.$$eval('.ProseMirror div[data-footnote-def]', (defs) =>
    defs.map((def) => {
      const range = document.createRange();
      range.selectNodeContents(def);
      return Math.round(range.getBoundingClientRect().left * 100) / 100;
    }),
  );
}

test('every definition marker reserves the same width, so the notes line up', async ({ page }) => {
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

  const widths = await markerWidths(page);
  const lefts = await textLeftEdges(page);
  expect(new Set(widths).size, `marker widths: ${widths.join(', ')}`).toBe(1);
  expect(new Set(lefts).size, `note text left edges: ${lefts.join(', ')}`).toBe(1);

  // The same section with the fix backed out, for the comparison shot. Deliberately not asserted:
  // it pins a *bug*, and it would go red for the right reason if the font ever shipped tabular
  // figures by default. Measured and reported instead, so the run says what the fix bought.
  await page.addStyleTag({
    content:
      '.ProseMirror div[data-footnote-def]::before { min-width: 0 !important; font-variant-numeric: normal !important; }',
  });
  await section.screenshot({ path: 'e2e/.tmp/footnote-markers-before.png' });
  console.log('without the fix — marker widths:', (await markerWidths(page)).join(', '));
  console.log('without the fix — text left edges:', (await textLeftEdges(page)).join(', '));
});
