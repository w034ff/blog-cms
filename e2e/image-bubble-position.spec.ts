import zlib from 'node:zlib';
import { test, expect, type Page } from '@playwright/test';
import { loadMarkdown } from './editor-authoring';

// Where and how soon the image bubble lands (docs/link-card-requirements.md §22, §22.1; criteria
// 22e, 22f, 22l, 22m, 22n): floating-ui geometry against live rects, invisible to the document.

// 390x220, in data/uploads: a 1x1 would sit inside `shift`'s 8px padding.
const UPLOAD_IMAGE =
  '/uploads/3cf43f6c9f92a311cb0de38736934c4efc6aa3d1d0968206d837e593fbe99107.png';

async function openEditorWithImage(page: Page): Promise<void> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, `![](${UPLOAD_IMAGE})\n\n本文\n`);
  await expect(page.locator('.ProseMirror img')).toBeVisible({ timeout: 20_000 });
}

// `updateDelay={0}`: the default 250ms is a show debounce, taken when
// `updateDelay > 0 && hasValidSelection`, and an image's NodeSelection is never empty. Under 250
// measures that the debounce branch is not taken.
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

// Menu against picture, plus the block's left edge: a centred picture is inset from the block.
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

// 22l: the menu's top-right meets the picture's, not the column-wide block's.
test('the menu is fitted into the picture’s top-right corner', async ({ page }) => {
  await openEditorWithImage(page);
  await page.locator('.ProseMirror img').click();
  await expect(page.locator('.image-bubble')).toBeVisible();

  // For React to commit and computePosition to resolve.
  await page.waitForTimeout(400);
  const seen = await readBoxes(page);

  // The premise: picture and block differ here.
  expect(seen.pictureLeft - seen.blockLeft).toBeGreaterThan(100);

  expect(seen.bubbleRight).toBeCloseTo(seen.pictureRight, 0);
  expect(seen.bubbleTop).toBeCloseTo(seen.pictureTop, 0);
});

// 22f: no repositioning later. `resizeHandler` runs after React commits, so a menu moving there was
// placed with a width one render stale (`top-end` moved 107px).
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

// 22m: a picture narrower than the menu cannot take it; fitted, the menu covers its top band (the
// 1x1 wholly).
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

  // The premise: the picture is narrower.
  expect(seen.pictureWidth).toBeLessThan(seen.bubbleWidth);
  // Above and clear.
  expect(seen.bubbleBottom).toBeLessThanOrEqual(seen.pictureTop);
  // The right-edge pin is off, measured as edges (the transform would read as a matrix).
  expect(seen.bubbleLeft).toBeCloseTo(seen.pictureLeft, 0);

  // The image is still clickable.
  await page.locator('.ProseMirror').click({ position: { x: 10, y: 300 } });
  await expect(page.locator('.image-bubble')).toBeHidden();
  await page.locator('.ProseMirror img').click();
  await expect(page.locator('.image-bubble')).toBeVisible();
});

// 22n: `fitMenuToPicture` compares against the menu's width, which is 削除 alone until React commits
// the other buttons. Deciding in the positioning callback read the narrow width, since
// `dispatchTransaction` runs `updatePosition` before React re-renders. 120x24 sits between the
// widths and is shorter than the menu. Pasted, since `data/uploads` is git-ignored; shared with 22s.
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

// Pasted, as a screenshot arrives.
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

  // Deselect first, so the menu empties to 削除 and the next show is the stale-width case.
  await page.locator('.ProseMirror img').click();
  await expect(page.locator('.image-bubble')).toBeVisible();
  await page.locator('.ProseMirror').click({ position: { x: 10, y: 300 } });
  await expect(page.locator('.image-bubble')).toBeHidden();

  await page.locator('.ProseMirror img').click();
  await expect(page.locator('.image-bubble')).toBeVisible();
  await page.waitForTimeout(400);
  const seen = await readBoxes(page);

  // The premises: a just-pasted image has no width for a frame or two.
  expect(seen.pictureWidth).toBeCloseTo(120, 0);
  expect(seen.pictureWidth).toBeLessThan(seen.bubbleWidth);

  // Above, neither overhanging nor covering it.
  expect(seen.bubbleBottom).toBeLessThanOrEqual(seen.pictureTop);
  expect(seen.bubbleLeft).toBeCloseTo(seen.pictureLeft, 0);
});

// 22s (§22.2): with icons the menu fits a 220px picture's corner; worded labels pushed it out.
// Restoring a label turns the corner assertions red.
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

  // The premises: 220 wide, and the menu fits.
  expect(seen.pictureWidth).toBeCloseTo(220, 0);
  expect(seen.bubbleWidth).toBeLessThan(seen.pictureWidth);

  expect(seen.bubbleRight).toBeCloseTo(seen.pictureRight, 0);
  expect(seen.bubbleTop).toBeCloseTo(seen.pictureTop, 0);
});
