import { test, expect, type Page } from '@playwright/test';
import { loadMarkdown } from './editor-authoring';

// Where a body image sits and what its block buys (docs/link-card-requirements.md §22): geometry,
// invisible to the DOM, transaction and markdown.

// 390x220 and 768x403, in data/uploads: one well narrower than the column, one wider than it at
// COLUMN_NARROWER_THAN_WIDE, where the body is 800 − 40·2 − 2 − 36·2 = 646px wide (`editor-shell`,
// `--editor-gutter`). At a desktop width the body is 800px (`--container-editor`), wider than both.
const COLUMN_NARROWER_THAN_WIDE = { width: 800, height: 900 };
const NARROW = '/uploads/3cf43f6c9f92a311cb0de38736934c4efc6aa3d1d0968206d837e593fbe99107.png';
const WIDE = '/uploads/531f1bd7bc8be82b6f3aa910ff3c6ec45d3572033db26d10bec768eae58a6652.webp';

async function openWithBothImages(page: Page): Promise<void> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, `![](${NARROW})\n\n本文\n\n![](${WIDE})\n\n後の段落\n`);
  await expect(page.locator('.ProseMirror img')).toHaveCount(2, { timeout: 20_000 });
  // Wait on `naturalWidth`: an undecoded `<img>` is 0 wide.
  await expect
    .poll(
      () =>
        page
          .locator('.ProseMirror img')
          .evaluateAll((imgs) => imgs.every((img) => (img as HTMLImageElement).naturalWidth > 0)),
      { timeout: 20_000 },
    )
    .toBe(true);
}

// Inline by default, so `margin-inline: auto` needs the `display`; boxes are measured, not rules.
test('a picture narrower than the column is centred in it', async ({ page }) => {
  await page.setViewportSize(COLUMN_NARROWER_THAN_WIDE);
  await openWithBothImages(page);

  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll('.ProseMirror .image-block')].map((block) => {
      const pic = block.querySelector('.image-box') as HTMLElement;
      const b = block.getBoundingClientRect();
      const p = pic.getBoundingClientRect();
      return {
        blockLeft: Math.round(b.left),
        blockWidth: Math.round(b.width),
        picLeft: Math.round(p.left),
        picWidth: Math.round(p.width),
      };
    }),
  );

  const [narrow, wide] = boxes;
  // Room either side, centred.
  expect(narrow.picWidth).toBeLessThan(narrow.blockWidth - 100);
  expect(narrow.picLeft - narrow.blockLeft).toBeCloseTo(
    (narrow.blockWidth - narrow.picWidth) / 2,
    -0.5,
  );
  // The wide one fills the column: the control.
  expect(wide.picLeft).toBe(wide.blockLeft);
});

// Why the picture is wrapped in a column-wide block at all: not the handle's x (a fixed
// `left` in app/globals.css; `alignHandles` sets only `top`), but the reveal area. `:has(+ :hover)` needs the
// pointer inside the next element, and the block makes the empty column beside a centred picture
// part of it.
test('the handle appears from the empty column beside a centred picture', async ({ page }) => {
  await openWithBothImages(page);

  const block = page.locator('.ProseMirror .image-block').first();
  const box = await block.boundingBox();
  const pic = await page.locator('.ProseMirror .image-box').first().boundingBox();
  if (!box || !pic) throw new Error('no boxes');

  // The premise: empty column to aim at, outside the picture, inside the block.
  const gap = pic.x - box.x;
  expect(gap).toBeGreaterThan(100);
  const aimX = gap / 2;

  await block.hover({ position: { x: aimX, y: box.height / 2 } });
  const handle = await page.evaluate(() => {
    const b = document.querySelector('.ProseMirror .image-block');
    const h = b?.previousElementSibling;
    if (!(h instanceof HTMLElement) || !h.classList.contains('block-drag-handle')) return null;
    return { opacity: getComputedStyle(h).opacity };
  });
  expect(handle).not.toBeNull();
  expect(Number(handle!.opacity)).toBeGreaterThan(0.5);
});
