import { test, expect, type Page } from '@playwright/test';
import { loadMarkdown } from './editor-authoring';
import { markdown, shot } from './editor-probe';
import {
  stubX,
  X_HEIGHT,
  X_MISSING_URL,
  X_RESIZE_ID,
  X_RESIZE_URL,
  X_SILENT_URL,
  X_TALL_HEIGHT,
  X_TALL_ID,
} from './x-embed-stub';

// The X embed in the live editor (docs/embed-requirements.md §10). Browser-only twice over: the
// NodeView's height arrives in a postMessage, and §10.6's failure state is a DOM swap driven by one.
//
// **The editor is the third surface** (§10.6, amended 2026-08-23). The published page degrades an
// unfetchable post to a plain link because the reader can do nothing about it; here the author can
// still fix the reference, so it is told to them — the same shape §7.2 settled for a reference no
// provider claims.

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

  // A provider claims it, so the card is not even offered — one URL, one meaning (§5).
  await page.locator('.ProseMirror a').first().click();
  await expect(page.getByRole('button', { name: 'コピー' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'カードにする' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '埋め込みにする' })).toBeVisible();
  await shot(page, '01-bubble-post-embed');
});

test('the bubble offers a card, not an embed, for the account (X2)', async ({ page }) => {
  // **No provider claims a profile URL, and that null IS how the account gets a card** (§10.4).
  // Nothing in the codebase decides this a second time, so the absence below is the whole feature.
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
  // The id is minted per placement, so the message can be attributed (§10.5).
  await expect(iframe).toHaveAttribute(
    'src',
    new RegExp(
      `^https://platform\\.twitter\\.com/embed/Tweet\\.html\\?id=${X_RESIZE_ID}&lang=ja&embedId=.+`,
    ),
  );

  // §10.8. The bar X's own document reserves takes no width under a headless browser's overlay
  // scrollbars, so what is measurable here is the attribute that removes it, not its absence.
  await expect(iframe).toHaveAttribute('scrolling', 'no');

  // The box is published at a guess and corrected by the provider — the correction is the thing
  // only a browser can show happening.
  const frame = embed(page).locator('.embed-frame');
  await expect
    .poll(async () => Math.round((await frame.boundingBox())!.height), { timeout: 10_000 })
    .toBe(X_HEIGHT);

  // The reference round-trips untouched whatever the iframe said (E1).
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

  // Not vacuous: the column has to be wide enough that an uncapped box would be visibly wider.
  expect(Math.round(column.width - box.width)).toBeGreaterThan(100);
  expect(Math.round(frame.width)).toBe(550);
  // The claim is the shape, not the pixel count: the band's border hugs the player by the same
  // padding on both sides, rather than running out to the column edge on the right. Asserted this
  // way so a change of font size does not have to be restated here.
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
  // **Not the published page's answer.** A plain link here would take the reference out of the
  // author's reach at the one moment they could still correct it.
  await expect(embed(page).locator('iframe')).toHaveCount(0);
  await expect(embed(page)).toHaveClass(/embed-unresolved/);
  await shot(page, '04-editor-missing-note');

  // The document is unchanged — the note is a NodeView state, not an edit.
  expect(await markdown(page)).toBe(
    `<div class="embed" data-href="${X_MISSING_URL}"></div>\n\n本文`,
  );
});

test('silence becomes the same note, once the block has been on screen (§10.6)', async ({
  page,
}) => {
  // What a changed entry point looks like: the iframe loads and never speaks (§10.3).
  await openWith(page, `<${X_SILENT_URL}>\n\n本文\n`);
  await page.locator('.ProseMirror a').first().click();
  await page.getByRole('button', { name: '埋め込みにする' }).click();
  await expect(embed(page).locator('iframe')).toHaveCount(1);

  // Still a player well after a load-started clock would have expired, because the block was only
  // just scrolled into view — and then the note, once the 8s the block has actually been visible
  // for run out.
  await expect(note(page)).toHaveCount(0);
  await expect(note(page)).toBeVisible({ timeout: 20_000 });
  await expect(note(page)).toContainText('取得できない投稿');
});

test('リンクに戻す gives the reference back, from either state (§10.6)', async ({ page }) => {
  await openWith(page, `<${X_MISSING_URL}>\n\n本文\n`);
  await page.locator('.ProseMirror a').first().click();
  await page.getByRole('button', { name: '埋め込みにする' }).click();
  // Undone from the failure state, which is the one an author actually wants to undo — and the
  // control has to survive the swap between the two states to be reachable at all.
  await expect(note(page)).toBeVisible({ timeout: 10_000 });
  await embed(page).getByRole('button', { name: 'リンクに戻す' }).click();

  await expect(embed(page)).toHaveCount(0);
  expect(await markdown(page)).toBe(`<${X_MISSING_URL}>\n\n本文`);
});

// §10.10. **A copy of the block is not a copy of its frame.** The drag handle's preview is a
// `cloneNode(true)` of the dragged block, and a cloned `<iframe>` gets a browsing context of its
// own — it loads the same src, `embedId` and all. Measured 2026-08-24 before the fix: picking up an
// X embed put a second frame on the page under the first one's name, and the block still sitting in
// the document took the height that frame's narrower box called for (1550px → 1092px), in front of
// the author, for the whole drag.
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
  // What the cursor carries is a token naming the block, not a copy of it — and no browsing
  // context of any kind. One frame on the page is the whole safety assertion: a second one is a
  // second speaker.
  await expect(preview.locator('iframe')).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveCount(1);
  // **Which post**, not what kind — the account comes out of the URL, so no fetch is involved, and
  // 「X の投稿」 beside the X mark would be the same words on every post.
  await expect(preview.locator('.embed-drag-token-lead')).toHaveText('@ClaudeDevs');
  await expect(preview.locator('.embed-drag-token-detail')).toHaveCount(0);
  await expect(preview.locator('.embed-drag-token svg')).toHaveCount(1);

  // Long enough for a clone's own reply (the stub answers 300ms after load).
  await page.waitForTimeout(800);
  expect(Math.round((await frame.boundingBox())!.height)).toBe(X_HEIGHT);
  await shot(page, '08-dragging-keeps-height');

  await page.mouse.up();
});

// The same rule from the other side, and the reason the fix is two things rather than one: the
// `embedId` names a placement, so anything holding a copy of it can speak for that placement. The
// clone is gone, but the NodeView now also asks whether the message came from ITS frame.
test('a frame answering under this block’s embedId is ignored (§10.10)', async ({ page }) => {
  await openWith(page, `<div class="embed" data-href="${X_RESIZE_URL}"></div>\n\n本文\n`);
  const frame = embed(page).locator('.embed-frame');
  await expect
    .poll(async () => Math.round((await frame.boundingBox())!.height), { timeout: 10_000 })
    .toBe(X_HEIGHT);

  const src = await embed(page).locator('iframe').getAttribute('src');
  const embedId = new URL(src!).searchParams.get('embedId');
  expect(embedId).toBeTruthy();

  // A second frame at X's own origin, carrying this block's name and a height of its own. Counted
  // as it arrives, so the assertion below cannot pass by the message never being sent.
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
