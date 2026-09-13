import { test, expect, type Page } from '@playwright/test';
import { loadMarkdown } from './editor-authoring';

// Where a body image sits, and what the block around it buys (docs/link-card-requirements.md §22).
// Both facts are geometry: the DOM, the transaction and the saved markdown are identical whether
// the picture is centred or not, so only a rendered measurement can hold them.

// 390x220 and 768x403, both already in data/uploads. The pair is the point — one is clearly
// narrower than the 50rem column and the other nearly fills it, and every claim below is about
// the difference between them. A single image measures nothing here.
const NARROW = '/uploads/3cf43f6c9f92a311cb0de38736934c4efc6aa3d1d0968206d837e593fbe99107.png';
const WIDE = '/uploads/531f1bd7bc8be82b6f3aa910ff3c6ec45d3572033db26d10bec768eae58a6652.webp';

async function openWithBothImages(page: Page): Promise<void> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, `![](${NARROW})\n\n本文\n\n![](${WIDE})\n\n後の段落\n`);
  await expect(page.locator('.ProseMirror img')).toHaveCount(2, { timeout: 20_000 });
}

// An `<img>` is inline by default, so `margin-inline: auto` alone does nothing — the `display`
// beside it is what makes the centring happen. A spec that only asserts "the rule is present"
// would pass with the image still on the left edge, which is why this measures boxes.
test('a picture narrower than the column is centred in it', async ({ page }) => {
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
  // The narrow one leaves real room, and sits in the middle of it.
  expect(narrow.picWidth).toBeLessThan(narrow.blockWidth - 100);
  expect(narrow.picLeft - narrow.blockLeft).toBeCloseTo(
    (narrow.blockWidth - narrow.picWidth) / 2,
    -0.5,
  );
  // The wide one fills the column, so centring has nothing to do — the control that shows the
  // assertion above is about centring rather than about any offset at all.
  expect(wide.picLeft).toBe(wide.blockLeft);
});

// Why the picture is wrapped in a column-wide block at all.
//
// NOT for the drag handle's x: `.block-drag-handle` is `position: absolute; left: -0.2rem`
// (globals.css), a fixed offset, and `alignHandles` sets only its `top`. That was measured wrong
// once — `document.querySelector` returns the FIRST handle and there is one per block, so reading
// it twice reads the same element and any two blocks look identical.
//
// What the block actually buys is the reveal area. The handle appears through
// `:has(+ :hover)` on the element right after it, so that element's box is what the pointer has
// to be inside. Centred, a 390px picture leaves ~188px of the column empty on each side; with the
// column-wide block that space still belongs to the image, and with a shrink-wrapped box alone it
// would not.
test('the handle appears from the empty column beside a centred picture', async ({ page }) => {
  await openWithBothImages(page);

  const block = page.locator('.ProseMirror .image-block').first();
  const box = await block.boundingBox();
  const pic = await page.locator('.ProseMirror .image-box').first().boundingBox();
  if (!box || !pic) throw new Error('no boxes');

  // The premise: there is real empty column to aim at, and the point chosen is outside the
  // picture but inside the block.
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
