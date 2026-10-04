import { test, expect, type Page } from '@playwright/test';
import { expectAutosaved, expectPublished, loadMarkdown, ensureCategory } from './editor-authoring';
import { shot } from './editor-probe';
import {
  stubX,
  X_HEIGHT,
  X_MISSING_URL,
  X_RESIZE_URL,
  X_SILENT_URL,
  X_TALL_HEIGHT,
  X_TALL_ID,
} from './x-embed-stub';
import { publishedPath } from './published-post';

// The X embed on the published page (docs/embed-requirements.md §10.5, §10.6), criteria X5 and X6.
// components/EmbedFrames.tsx is unreachable by unit tests: it hears a message, corrects a height,
// swaps a box for a link. **X6 is why this file exists**: the silence timeout bounds the risk of X
// changing its entry point (§10.3), but a misfire replaces working posts, so it starts on
// visibility, and the entry paths below reach a page without scrolling everything.

async function publish(page: Page, title: string, source: string): Promise<string> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill(title);
  await loadMarkdown(page, source);
  await expectAutosaved(page);
  await ensureCategory(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);
  return publishedPath(page);
}

const ref = (url: string) => `<div class="embed" data-href="${url}"></div>`;
// Pushes what follows below any viewport.
const FILLER = Array.from({ length: 40 }, (_, i) => `段落 ${i}。`).join('\n\n');

const box = (page: Page) => page.locator('#post-body .embed-x');
const frameHeight = async (page: Page) =>
  Math.round((await page.locator('#post-body .embed-x .embed-frame').boundingBox())!.height);

test('the box stops at the width the post can use, on the left rail (§10.9)', async ({ page }) => {
  const href = await publish(
    page,
    'Public X embed width',
    `前。\n\n${ref(X_RESIZE_URL)}\n\n後。\n`,
  );
  await stubX(page);
  await page.goto(href);
  await expect(box(page)).toHaveCount(1);

  const column = (await page.locator('#post-body').boundingBox())!;
  const frame = (await page.locator('#post-body .embed-x .embed-frame').boundingBox())!;
  // Vacuous unless the column is wider than the cap.
  expect(Math.round(column.width)).toBeGreaterThan(550);
  expect(Math.round(frame.width)).toBe(550);
  // Left rail, not centred.
  expect(Math.round(frame.x - column.x)).toBe(0);
});

test('a post takes the height its iframe reports (§10.5)', async ({ page }) => {
  const href = await publish(page, 'Public X embed', `前。\n\n${ref(X_RESIZE_URL)}\n\n後。\n`);
  await stubX(page);
  await page.goto(href);

  await expect(box(page)).toHaveCount(1);
  // The published guess, before any answer.
  await expect(box(page).locator('iframe')).toHaveCount(1);
  await expect.poll(() => frameHeight(page), { timeout: 15_000 }).toBe(X_HEIGHT);
  await shot(page, '01-public-post-sized');
});

// docs/embed-requirements.md §10.10, criterion X11: every X frame shares an origin, so
// `event.origin` says "an X frame", not "this one". A box answers only its own frame.
test('a frame answering under another box’s embedId is ignored (X11)', async ({ page }) => {
  const href = await publish(
    page,
    'Public X impersonation',
    `前。\n\n${ref(X_RESIZE_URL)}\n\n後。\n`,
  );
  await stubX(page);
  await page.goto(href);
  await expect.poll(() => frameHeight(page), { timeout: 15_000 }).toBe(X_HEIGHT);

  const embedId = await box(page).getAttribute('data-embed-id');
  expect(embedId).toBeTruthy();

  // A second frame at X's origin with this box's name; counted, so the message surely arrived.
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
  // Heard by the page, refused by the box.
  expect(await frameHeight(page)).toBe(X_HEIGHT);
});

test('an unfetchable post becomes the same link the render stage would build (X5)', async ({
  page,
}) => {
  // §10.6: the iframe is empty, so without a fallback the reader sees a gap. The anchor must match
  // `lib/embed-fallback.ts`, which lib/render.test.ts pins for the other path.
  const href = await publish(page, 'Public X missing', `前。\n\n${ref(X_MISSING_URL)}\n\n後。\n`);
  await stubX(page);
  await page.goto(href);

  await expect(box(page)).toHaveCount(0, { timeout: 15_000 });
  const link = page.locator(`#post-body a[href="${X_MISSING_URL}"]`);
  await expect(link).toHaveCount(1);
  await expect(link).toHaveText(X_MISSING_URL);
  // Added by the client, after the build pipeline (§10.6).
  await expect(link).toHaveAttribute('target', '_blank');
  expect(await link.getAttribute('rel')).toBeNull();
  await shot(page, '02-public-missing-link');
});

test('silence below the fold does NOT become a link, however long the page sits (X6)', async ({
  page,
}) => {
  // Decisive: a load-started clock would expire here on a post the reader has not reached.
  const href = await publish(
    page,
    'Public X below fold',
    `前。\n\n${FILLER}\n\n${ref(X_SILENT_URL)}\n\n後。\n`,
  );
  await stubX(page);
  await page.goto(href);
  await expect(box(page)).toHaveCount(1);

  // Past EMBED_SILENCE_MS, without scrolling.
  await page.waitForTimeout(11_000);
  await expect(box(page)).toHaveCount(1);
  await expect(box(page).locator('iframe')).toHaveCount(1);
  await expect(page.locator(`#post-body a[href="${X_SILENT_URL}"]`)).toHaveCount(0);

  // The clock starts once reached, or the assertion above passes for a timeout that never runs.
  await box(page).scrollIntoViewIfNeeded();
  await expect(page.locator(`#post-body a[href="${X_SILENT_URL}"]`)).toHaveCount(1, {
    timeout: 20_000,
  });
  await shot(page, '03-public-silent-fallback');
});

test('a post visible at first paint is not mistaken for a missing one (X6)', async ({ page }) => {
  const href = await publish(page, 'Public X above fold', `${ref(X_RESIZE_URL)}\n\n後。\n`);
  await stubX(page);
  await page.goto(href);

  await expect.poll(() => frameHeight(page), { timeout: 15_000 }).toBe(X_HEIGHT);
  // An answered embed stays answered: settling stopped the clock.
  await page.waitForTimeout(11_000);
  await expect(box(page)).toHaveCount(1);
  expect(await frameHeight(page)).toBe(X_HEIGHT);
});

test('an anchor landing mid-article does not misfire on what it skipped past (X6)', async ({
  page,
}) => {
  // Arriving on `#heading`, the embed above the landing point is never seen, so never judged.
  const href = await publish(
    page,
    'Public X anchor landing',
    `${ref(X_SILENT_URL)}\n\n${FILLER}\n\n## 見出し\n\n${ref(X_RESIZE_URL)}\n\n後。\n`,
  );
  await stubX(page);
  // The id from the served HTML: rendering first would show the top embed and start its clock, and a
  // fragment `goto` does not reload.
  const served = await (await page.request.get(href)).text();
  const id = /<h2[^>]*\sid="([^"]+)"/.exec(served)?.[1];
  expect(id).toBeTruthy();
  await page.goto(`${href}#${id}`);

  // The one at the landing point answers.
  await expect
    .poll(
      async () =>
        Math.round(
          (await page
            .locator(`#post-body .embed-x[data-href="${X_RESIZE_URL}"] .embed-frame`)
            .boundingBox())!.height,
        ),
      { timeout: 15_000 },
    )
    .toBe(X_HEIGHT);

  // The one above is still a box.
  await page.waitForTimeout(11_000);
  await expect(page.locator(`#post-body .embed-x[data-href="${X_SILENT_URL}"]`)).toHaveCount(1);
  await expect(page.locator(`#post-body a[href="${X_SILENT_URL}"]`)).toHaveCount(0);
});
