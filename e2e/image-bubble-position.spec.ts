import { test, expect, type Page } from '@playwright/test';
import { loadMarkdown } from './editor-authoring';

// Where the image bubble menu lands, and how soon (docs/link-card-requirements.md §22, criteria
// 22e/22f). Both facts are geometry the document cannot check for itself: the menu is positioned
// by floating-ui against live rects, so a placement that reads the menu's own width is wrong only
// on screen — the DOM, the transaction and the saved markdown are all identical either way.

// 390x220, already in public/uploads. A real box to anchor against: the 1x1 PNGs the other specs
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

// `placement: 'top-start'`. floating-ui solves a `-start` menu at `reference.left` and an `-end`
// one at `reference.right - floating.width`, so only the latter measures the menu itself — and the
// menu's buttons are React children of a portal, one render behind the transaction that positions
// it (`canBeThumbnail` is false while nothing is selected, so the element still holds 削除 alone).
// Measured on `top-end` before the fix: 107.05px right of the image's right edge, exactly the
// 105.05px サムネイルに設定 button plus the 2px `gap-0.5`.
//
// The resize is the second half of the claim and the load-bearing one: the plugin's `resizeHandler`
// repositions at a moment when React has certainly committed, so a menu that moves there was
// positioned against a stale width. `top-end` moved 107.06px; a width-independent placement moves
// nothing.
//
// The anchor is whatever `editor.view.nodeDOM(pos)` returns, which is the column-wide
// `.image-block` since images gained their two boxes — not the picture, which the centring rule
// now moves 188px in from that edge. Asserting against the block is what the menu's own
// positioning does; when the menu moves inside the picture's top-right, this becomes
// `.image-box` instead.
test('the menu sits on the block’s left edge and nothing repositions it afterwards', async ({
  page,
}) => {
  await openEditorWithImage(page);
  await page.locator('.ProseMirror img').click();
  await expect(page.locator('.image-bubble')).toBeVisible();

  const read = () =>
    page.evaluate(() => {
      const bubble = document.querySelector('.image-bubble');
      const block = document.querySelector('.ProseMirror .image-block');
      if (!bubble || !block) throw new Error('bubble or block missing');
      return {
        bubbleLeft: bubble.getBoundingClientRect().left,
        blockLeft: block.getBoundingClientRect().left,
      };
    });

  // Long enough for React to commit and any in-flight computePosition to resolve — the point is
  // that the number does not change over this window, so a short wait would prove less, not more.
  await page.waitForTimeout(400);
  const afterClick = await read();
  expect(afterClick.bubbleLeft).toBeCloseTo(afterClick.blockLeft, 0);

  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.waitForTimeout(300);
  const afterResize = await read();
  expect(afterResize.bubbleLeft).toBeCloseTo(afterClick.bubbleLeft, 0);
});
