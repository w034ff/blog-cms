import { test, expect, type Page } from '@playwright/test';
import { loadMarkdown, moveBlockAbove } from './editor-authoring';
import { markdown, shot } from './editor-probe';
import {
  REPLY_MS,
  stubX,
  X_HEIGHT,
  X_MISSING_URL,
  X_RESIZE_ID,
  X_RESIZE_URL,
  X_SILENT_URL,
  X_TALL_HEIGHT,
  X_TALL_ID,
} from './x-embed-stub';

// The X embed in the live editor (docs/embed-requirements.md §10): the height arrives by
// postMessage, and §10.6's failure state is a DOM swap. **The editor is the third surface** (§10.6):
// the published page degrades an unfetchable post to a link, but here the author can fix the
// reference, so it is reported, as §7.2 does for an unclaimed one.

async function openWith(page: Page, source: string): Promise<void> {
  await stubX(page);
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, source);
}

const embed = (page: Page) => page.locator('.ProseMirror .embed-view');
const note = (page: Page) => page.locator('.ProseMirror .embed-note');

test('the bubble offers an embed for a post (§10.4)', async ({ page }) => {
  await openWith(page, `<${X_RESIZE_URL}>\n\n本文\n`);

  // Claimed, so no card is offered: one URL, one meaning (§5).
  await page.locator('.ProseMirror a').first().click();
  await expect(page.getByRole('button', { name: 'コピー' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'カードにする' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '埋め込みにする' })).toBeVisible();
  await shot(page, '01-bubble-post-embed');
});

test('the bubble offers a card, not an embed, for the account (X2)', async ({ page }) => {
  // **No provider claims a profile URL, and that is how an account gets a card** (§10.4); the absence
  // below is the whole feature.
  await openWith(page, `<https://x.com/ClaudeDevs>\n\n本文\n`);

  await page.locator('.ProseMirror a').first().click();
  await expect(page.getByRole('button', { name: 'コピー' })).toBeVisible();
  await expect(page.getByRole('button', { name: '埋め込みにする' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'カードにする' })).toBeVisible();
  await shot(page, '02-bubble-account-card');
});

test('the block renders the post and takes the height it is told (§10.5)', async ({ page }) => {
  await openWith(page, `<${X_RESIZE_URL}>\n\n本文\n`);
  await page.locator('.ProseMirror a').first().click();
  await page.getByRole('button', { name: '埋め込みにする' }).click();

  await expect(embed(page)).toHaveCount(1);
  const iframe = embed(page).locator('iframe');
  // Minted per placement, so messages can be attributed (§10.5).
  await expect(iframe).toHaveAttribute(
    'src',
    new RegExp(
      `^https://platform\\.twitter\\.com/embed/Tweet\\.html\\?id=${X_RESIZE_ID}&lang=ja&embedId=.+`,
    ),
  );

  // §10.8: headless overlay scrollbars take no width, so the attribute is what is measurable.
  await expect(iframe).toHaveAttribute('scrolling', 'no');

  // Published at a guess, corrected by the provider: only a browser shows the correction.
  const frame = embed(page).locator('.embed-frame');
  await expect
    .poll(async () => Math.round((await frame.boundingBox())!.height), { timeout: 10_000 })
    .toBe(X_HEIGHT);

  // The reference round-trips untouched (E1).
  expect(await markdown(page)).toBe(
    `<div class="embed" data-href="${X_RESIZE_URL}"></div>\n\n本文`,
  );
  await shot(page, '03-editor-post-sized');
});

test('the box ends where the player ends (§10.9)', async ({ page }) => {
  await openWith(page, `<div class="embed" data-href="${X_RESIZE_URL}"></div>\n\n本文\n`);
  await expect(embed(page)).toHaveCount(1);

  const column = (await page.locator('.ProseMirror').boundingBox())!;
  const box = (await embed(page).boundingBox())!;
  const frame = (await embed(page).locator('.embed-frame').boundingBox())!;

  // The column must be wide enough for an uncapped box to show.
  expect(Math.round(column.width - box.width)).toBeGreaterThan(100);
  expect(Math.round(frame.width)).toBe(550);
  // The shape: the band's border hugs the player by equal padding on both sides.
  const leftGap = Math.round(frame.x - box.x);
  const rightGap = Math.round(box.x + box.width - (frame.x + frame.width));
  expect(rightGap).toBe(leftGap);
});

test('an unfetchable post tells the author, and does not become a link (§10.6)', async ({
  page,
}) => {
  await openWith(page, `<${X_MISSING_URL}>\n\n本文\n`);
  await page.locator('.ProseMirror a').first().click();
  await page.getByRole('button', { name: '埋め込みにする' }).click();
  await expect(embed(page)).toHaveCount(1);

  await expect(note(page)).toBeVisible({ timeout: 10_000 });
  await expect(note(page)).toContainText('取得できない投稿');
  await expect(note(page)).toContainText(X_MISSING_URL);
  // **Not the published answer**: a link would take the reference from the one who can fix it.
  await expect(embed(page).locator('iframe')).toHaveCount(0);
  await expect(embed(page)).toHaveClass(/embed-unresolved/);
  await shot(page, '04-editor-missing-note');

  // Unchanged: the note is NodeView state, not an edit.
  expect(await markdown(page)).toBe(
    `<div class="embed" data-href="${X_MISSING_URL}"></div>\n\n本文`,
  );
});

test('silence becomes the same note, once the block has been on screen (§10.6)', async ({
  page,
}) => {
  // A changed entry point: the iframe loads and never speaks (§10.3).
  await openWith(page, `<${X_SILENT_URL}>\n\n本文\n`);
  await page.locator('.ProseMirror a').first().click();
  await page.getByRole('button', { name: '埋め込みにする' }).click();
  await expect(embed(page).locator('iframe')).toHaveCount(1);

  // Still a player after a load-started clock would have expired, since the block only just came into
  // view; the note comes after 8s visible.
  await expect(note(page)).toHaveCount(0);
  await expect(note(page)).toBeVisible({ timeout: 20_000 });
  await expect(note(page)).toContainText('取得できない投稿');
});

test('リンクに戻す gives the reference back, from either state (§10.6)', async ({ page }) => {
  await openWith(page, `<${X_MISSING_URL}>\n\n本文\n`);
  await page.locator('.ProseMirror a').first().click();
  await page.getByRole('button', { name: '埋め込みにする' }).click();
  // Undone from the failure state, so the control must survive the swap.
  await expect(note(page)).toBeVisible({ timeout: 10_000 });
  await embed(page).getByRole('button', { name: 'リンクに戻す' }).click();

  await expect(embed(page)).toHaveCount(0);
  expect(await markdown(page)).toBe(`<${X_MISSING_URL}>\n\n本文`);
});

// §10.10. **A copy of the block is not a copy of its frame**: the preview's `cloneNode(true)` gave a
// cloned `<iframe>` its own browsing context under the same `embedId`, and its reply resized the
// block in the document for the whole drag.
test('dragging the block leaves its height alone (§10.10)', async ({ page }) => {
  await openWith(page, `<div class="embed" data-href="${X_RESIZE_URL}"></div>\n\n後の段落\n`);
  const frame = embed(page).locator('.embed-frame');
  await expect
    .poll(async () => Math.round((await frame.boundingBox())!.height), { timeout: 10_000 })
    .toBe(X_HEIGHT);

  const handle = page.locator('.ProseMirror .block-drag-handle').first();
  const handleBox = await handle.boundingBox();
  const target = await page.locator('.ProseMirror p', { hasText: '後の段落' }).boundingBox();
  if (!handleBox || !target) throw new Error('missing bounding box');
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height - 2, { steps: 8 });

  const preview = page.locator('.block-drag-preview');
  await expect(preview).toBeVisible();
  // A token naming the block, no browsing context: one frame on the page is the safety assertion.
  await expect(preview.locator('iframe')).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveCount(1);
  // **Which post**, from the URL, no fetch.
  await expect(preview.locator('.embed-drag-token-lead')).toHaveText('@ClaudeDevs');
  await expect(preview.locator('.embed-drag-token-detail')).toHaveCount(0);
  await expect(preview.locator('.embed-drag-token svg')).toHaveCount(1);

  // Past the stub's reply time by a margin, derived from it so the two cannot drift apart: a clone
  // would have answered by now.
  await page.waitForTimeout(REPLY_MS + 1000);
  expect(Math.round((await frame.boundingBox())!.height)).toBe(X_HEIGHT);
  await shot(page, '08-dragging-keeps-height');

  await page.mouse.up();
});

// The other half: anything holding the `embedId` can speak for the placement, so the NodeView also
// checks the message came from its own frame.
test('a frame answering under this block’s embedId is ignored (§10.10)', async ({ page }) => {
  await openWith(page, `<div class="embed" data-href="${X_RESIZE_URL}"></div>\n\n本文\n`);
  const frame = embed(page).locator('.embed-frame');
  await expect
    .poll(async () => Math.round((await frame.boundingBox())!.height), { timeout: 10_000 })
    .toBe(X_HEIGHT);

  const src = await embed(page).locator('iframe').getAttribute('src');
  const embedId = new URL(src!).searchParams.get('embedId');
  expect(embedId).toBeTruthy();

  // A second frame at X's origin with this block's name; counted, so the message surely arrived.
  await page.evaluate(
    ([id, tallId, height]) => {
      const w = window as unknown as { __tall: number };
      w.__tall = 0;
      window.addEventListener('message', (event) => {
        if (typeof event.data === 'string' && event.data.includes(`"height":${height}`)) {
          w.__tall += 1;
        }
      });
      const rogue = document.createElement('iframe');
      rogue.src = `https://platform.twitter.com/embed/Tweet.html?id=${tallId}&lang=ja&embedId=${id}`;
      rogue.style.cssText = 'position:fixed;left:0;bottom:0;width:300px;height:100px';
      document.body.appendChild(rogue);
    },
    [embedId!, X_TALL_ID, String(X_TALL_HEIGHT)] as const,
  );

  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __tall: number }).__tall))
    .toBeGreaterThan(0);
  // Heard by the page, refused by the block.
  expect(Math.round((await frame.boundingBox())!.height)).toBe(X_HEIGHT);
});

// §8.2: the box stops at 550px, left-aligned (§10.9), and a click beside it fell through to the
// browser's caret search, landing in the next block.
test('a click beside the box selects the embed, not the next block (§8.2)', async ({ page }) => {
  await openWith(page, `<div class="embed" data-href="${X_RESIZE_URL}"></div>\n\n後の段落\n`);
  const frame = embed(page).locator('.embed-frame');
  await expect
    .poll(async () => Math.round((await frame.boundingBox())!.height), { timeout: 10_000 })
    .toBe(X_HEIGHT);

  const box = (await embed(page).boundingBox())!;
  const column = (await page.locator('.ProseMirror').boundingBox())!;
  // A real gap between the box and the column edge.
  expect(column.x + column.width - (box.x + box.width)).toBeGreaterThan(20);

  await page.mouse.click(
    box.x + box.width + (column.x + column.width - (box.x + box.width)) / 2,
    box.y + box.height / 2,
  );

  await expect(embed(page)).toHaveClass(/ProseMirror-selectednode/);
  const nextParaSelected = await page
    .locator('.ProseMirror p', { hasText: '後の段落' })
    .evaluate((el) => el.classList.contains('ProseMirror-selectednode'));
  expect(nextParaSelected).toBe(false);
});

// docs/embed-requirements.md §8.4: a reorder rebuilds the jumped-over embed's NodeView, resetting
// `answered`, `visible` and the silence clock, so a frame that did not speak again would become
// 「取得できない」. Only X and gist answer back (§10.5, §18.5). `moveBlockAbove` (editor-authoring.ts)
// reorders by transaction; the marks prove the rebuild.

test('a frame rebuilt by a reorder announces its height again (§8.4)', async ({ page }) => {
  await openWith(
    page,
    `前の段落\n\n<div class="embed" data-href="${X_RESIZE_URL}"></div>\n\n後の段落\n`,
  );

  const frame = embed(page).locator('.embed-frame');
  const iframe = frame.locator('iframe');
  await expect
    .poll(async () => Math.round((await frame.boundingBox())!.height), { timeout: 10_000 })
    .toBe(X_HEIGHT);
  const firstEmbedId = new URL((await iframe.getAttribute('src'))!).searchParams.get('embedId');
  expect(firstEmbedId).toBeTruthy();

  // Both stamped: the iframe (§8.4) and the `.embed-frame` div with the inline height, which, if kept,
  // would fake a new announce.
  await page.evaluate(() => {
    document.querySelector('.embed-view iframe')?.setAttribute('data-mark', '1');
    document.querySelector('.embed-view .embed-frame')?.setAttribute('data-mark', '1');
  });

  await moveBlockAbove(page, '後の段落', 'embed');

  // **The gate** (§8.4 row 1): the other direction rebuilds the moved block instead.
  await expect(embed(page).locator('[data-mark]')).toHaveCount(0);
  // A new `instanceId` in the src: the frame echoes it, and a stale id would read as silence.
  const secondEmbedId = new URL((await iframe.getAttribute('src'))!).searchParams.get('embedId');
  expect(secondEmbedId).toBeTruthy();
  expect(secondEmbedId).not.toBe(firstEmbedId);

  // The height lands on a box with no inline style, so it was announced.
  await expect
    .poll(async () => Math.round((await frame.boundingBox())!.height), { timeout: 10_000 })
    .toBe(X_HEIGHT);

  // The re-armed clock expires without firing. Waited out: `toHaveCount(0)` passes at once.
  await page.waitForTimeout(9_000);
  await expect(note(page)).toHaveCount(0);
  await expect(frame).toBeVisible();
});
