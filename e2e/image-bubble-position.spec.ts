import zlib from 'node:zlib';
import { test, expect, type Page } from '@playwright/test';
import { loadMarkdown } from './editor-authoring';

// Where the image bubble menu lands, and how soon (docs/link-card-requirements.md §22 and §22.1,
// criteria 22e, 22f, 22l, 22m, 22n). All of it is geometry the document cannot check for itself: the
// menu is positioned by floating-ui against live rects, so a placement that reads the menu's own
// width is wrong only on screen — the DOM, the transaction and the saved markdown are all
// identical either way.

// 390x220, already in data/uploads. A real box to anchor against: the 1x1 PNGs the other specs
// upload would sit inside `shift`'s own 8px padding and make every offset below meaningless.
const UPLOAD_IMAGE =
  '/uploads/3cf43f6c9f92a311cb0de38736934c4efc6aa3d1d0968206d837e593fbe99107.png';

async function openEditorWithImage(page: Page): Promise<void> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, `![](${UPLOAD_IMAGE})\n\n本文\n`);
  await expect(page.locator('.ProseMirror img')).toBeVisible({ timeout: 20_000 });
}

// `updateDelay={0}`. The plugin's own default is 250ms and it is not a position debounce here but
// a show debounce: `update()` takes the debounced branch on `updateDelay > 0 && hasValidSelection`,
// and an image's NodeSelection is never empty (a leaf atom, `to === from + 1`), so the very click
// that selects the image waits out the full delay before `shouldShow` is even asked. The threshold
// is set below 250 rather than at some "feels instant" number: what this measures is that the
// debounce branch is not taken at all.
test('the menu appears on the click that selects the image, not a debounce later', async ({
  page,
}) => {
  await openEditorWithImage(page);

  const started = Date.now();
  await page.locator('.ProseMirror img').click();
  await page.waitForSelector('.image-bubble', { state: 'visible' });
  const elapsed = Date.now() - started;

  console.log(`click → .image-bubble visible: ${elapsed}ms`);
  expect(elapsed).toBeLessThan(200);
});

// The menu's box against the picture's, plus the block's left edge — the picture is inset from the
// block by the empty column beside a centred image, which is what lets these tests tell "on the
// picture" apart from "on the block".
const readBoxes = (page: Page) =>
  page.evaluate(() => {
    const bubble = document.querySelector('.image-bubble');
    const picture = document.querySelector('.ProseMirror .image-box');
    const block = document.querySelector('.ProseMirror .image-block');
    if (!bubble || !picture || !block) throw new Error('bubble, picture or block missing');
    const b = bubble.getBoundingClientRect();
    const p = picture.getBoundingClientRect();
    return {
      bubbleRight: b.right,
      bubbleTop: b.top,
      bubbleLeft: b.left,
      bubbleBottom: b.bottom,
      bubbleWidth: b.width,
      pictureRight: p.right,
      pictureTop: p.top,
      pictureLeft: p.left,
      pictureWidth: p.width,
      blockLeft: block.getBoundingClientRect().left,
    };
  });

// 22l: where it lands. The menu's top-right corner meets the picture's, and it is the PICTURE it
// is measured against — anchoring to the column-wide block would leave the menu out in the empty
// column beside a centred image.
test('the menu is fitted into the picture’s top-right corner', async ({ page }) => {
  await openEditorWithImage(page);
  await page.locator('.ProseMirror img').click();
  await expect(page.locator('.image-bubble')).toBeVisible();

  // Long enough for React to commit and any in-flight computePosition to resolve.
  await page.waitForTimeout(400);
  const seen = await readBoxes(page);

  // The premise, so "on the picture" and "on the block" are different answers here.
  expect(seen.pictureLeft - seen.blockLeft).toBeGreaterThan(100);

  expect(seen.bubbleRight).toBeCloseTo(seen.pictureRight, 0);
  expect(seen.bubbleTop).toBeCloseTo(seen.pictureTop, 0);
});

// 22f, and the load-bearing half: it is not repositioned afterwards. The plugin's `resizeHandler`
// runs at a moment when React has certainly committed, so a menu that MOVES there was placed
// against a width it read one render too early. `top-end` moved 107.06px; a placement that never
// measures the menu moves nothing.
test('the menu is not repositioned by a later resize', async ({ page }) => {
  await openEditorWithImage(page);
  await page.locator('.ProseMirror img').click();
  await expect(page.locator('.image-bubble')).toBeVisible();
  await page.waitForTimeout(400);
  const afterClick = await readBoxes(page);

  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.waitForTimeout(300);
  const afterResize = await readBoxes(page);
  expect(afterResize.bubbleLeft).toBeCloseTo(afterClick.bubbleLeft, 0);
  expect(afterResize.bubbleRight).toBeCloseTo(afterResize.pictureRight, 0);
});

// 22m: the one case the fitted placement cannot take. Fitted into the corner of a picture
// narrower than itself, the menu overhangs to the left and covers the picture's top band — and
// covers it whole once the picture is shorter than the menu is tall. This is the smallest upload
// in the repo, 1x1.
const TINY = '/uploads/b1ff9c8ea3a780bad09b346c423d2d0e46815926879b18e841d928376a946640.png';

test('a picture narrower than the menu keeps the menu above it, uncovered', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, `![](${TINY})\n\n本文\n`);
  await expect(page.locator('.ProseMirror img')).toBeVisible({ timeout: 20_000 });

  await page.locator('.ProseMirror img').click();
  await expect(page.locator('.image-bubble')).toBeVisible();
  await page.waitForTimeout(400);

  const seen = await readBoxes(page);

  // The premise, so this cannot pass by the picture happening to be wide.
  expect(seen.pictureWidth).toBeLessThan(seen.bubbleWidth);
  // Above it, and clear of it.
  expect(seen.bubbleBottom).toBeLessThanOrEqual(seen.pictureTop);
  // And the right-edge pin is off — measured as the edges themselves rather than as the computed
  // `transform`, which the outside case also uses (for the 8px gap) and would report as a matrix.
  expect(seen.bubbleLeft).toBeCloseTo(seen.pictureLeft, 0);

  // The point of all of it: the image is still selectable by clicking it.
  await page.locator('.ProseMirror').click({ position: { x: 10, y: 300 } });
  await expect(page.locator('.image-bubble')).toBeHidden();
  await page.locator('.ProseMirror img').click();
  await expect(page.locator('.image-bubble')).toBeVisible();
});

// 22n: the band between the menu's two widths, which is where the fallback used to misfire and where
// nothing measured it. `fitMenuToPicture` compares the picture against the menu's own width, and
// the menu has two: the delete button alone (35.6px) while nothing is selected, and 142.9px once
// React has committed the caption button and the thumbnail toggle beside it (measured 2026-09-08 —
// 44px and 151px until the two outer labels became icons; 120 sits inside the band either way).
// Deciding inside the positioning callback read the first, because `dispatchTransaction` runs the
// plugin's `updatePosition` before the emit that re-renders React — so every picture between those
// widths was fitted into a corner it could not hold. 120x24 is inside the band and shorter than the
// menu, so a wrong answer covers it whole.
//
// Built and pasted here rather than referenced by hash: `data/uploads` is git-ignored, so a
// fixture only this spec needs has to arrive the way a screenshot does. Shared with 22s below,
// which needs the same thing at a different size.
function solidPng(w: number, h: number): Buffer {
  const raw = Buffer.concat(
    Array.from({ length: h }, () => Buffer.concat([Buffer.of(0), Buffer.alloc(w * 3, 0xc8)])),
  );
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Paste one in, the way a screenshot arrives.
async function pasteImage(page: Page, png: Buffer): Promise<void> {
  await page.evaluate((bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(bytes)], 'fixture.png', { type: 'image/png' }));
    document
      .querySelector('.ProseMirror')
      ?.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
  }, Array.from(png));
  await expect(page.locator('.ProseMirror img')).toBeVisible({ timeout: 20_000 });
}

test('a picture between the menu’s two widths is not fitted into a corner it cannot hold', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await pasteImage(page, solidPng(120, 24));

  // Deselect first, so the menu empties down to 削除 alone and the next show is the case that
  // used to read the stale width. Selecting one image straight after another never empties it.
  await page.locator('.ProseMirror img').click();
  await expect(page.locator('.image-bubble')).toBeVisible();
  await page.locator('.ProseMirror').click({ position: { x: 10, y: 300 } });
  await expect(page.locator('.image-bubble')).toBeHidden();

  await page.locator('.ProseMirror img').click();
  await expect(page.locator('.image-bubble')).toBeVisible();
  await page.waitForTimeout(400);
  const seen = await readBoxes(page);

  // The premises. A just-pasted image has no realized width for a frame or two, so without this
  // a 0-wide picture would satisfy every assertion below for the wrong reason.
  expect(seen.pictureWidth).toBeCloseTo(120, 0);
  expect(seen.pictureWidth).toBeLessThan(seen.bubbleWidth);

  // Above the picture, and neither overhanging it nor covering it.
  expect(seen.bubbleBottom).toBeLessThanOrEqual(seen.pictureTop);
  expect(seen.bubbleLeft).toBeCloseTo(seen.pictureLeft, 0);
});

// 22s: what the icons bought (§22.2). The menu is 142.9px, so a picture this size holds it in its
// corner; with the two outer labels worded it was 229.6px and this same picture pushed it out and
// above (both measured 2026-09-08). 220 is chosen to sit between the two widths — restore either
// label and the corner assertions below go red rather than the width itself, which is what makes
// this a placement test and not a screenshot of a number.
test('a picture wider than the menu, but narrower than the worded one, keeps it in the corner', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await pasteImage(page, solidPng(220, 120));

  await page.locator('.ProseMirror img').click();
  await expect(page.locator('.image-bubble')).toBeVisible();
  await page.waitForTimeout(400);
  const seen = await readBoxes(page);

  // The premises: the picture really is 220 wide, and the menu really does fit inside it.
  expect(seen.pictureWidth).toBeCloseTo(220, 0);
  expect(seen.bubbleWidth).toBeLessThan(seen.pictureWidth);

  expect(seen.bubbleRight).toBeCloseTo(seen.pictureRight, 0);
  expect(seen.bubbleTop).toBeCloseTo(seen.pictureTop, 0);
});
