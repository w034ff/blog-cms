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

// The X embed on the *published* page (docs/embed-requirements.md §10.5, §10.6) — basis X5 and X6.
//
// `components/EmbedFrames.tsx` is the only part of this feature that no unit test can reach: it
// listens for a message, corrects a height, and replaces a box with a link. All three are things a
// browser does or does not do.
//
// **X6 is the criterion this file exists for.** The silence timeout is what bounds the one risk
// measurement could not remove — an entry point X is free to change (§10.3) — but a timeout that
// misfires is worse than no timeout, because it replaces working posts with links. It is started by
// visibility for that reason, and the three entry paths below are the ways a reader arrives at a
// page without having scrolled to everything on it.

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
// Tall enough that what follows starts well below any viewport.
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
  // Vacuous unless the column is actually wider than the cap — which is the whole situation the
  // cap exists for.
  expect(Math.round(column.width)).toBeGreaterThan(550);
  expect(Math.round(frame.width)).toBe(550);
  // Left rail, not centred: the box starts where the paragraphs start.
  expect(Math.round(frame.x - column.x)).toBe(0);
});

test('a post takes the height its iframe reports (§10.5)', async ({ page }) => {
  const href = await publish(page, 'Public X embed', `前。\n\n${ref(X_RESIZE_URL)}\n\n後。\n`);
  await stubX(page);
  await page.goto(href);

  await expect(box(page)).toHaveCount(1);
  // The published guess, before anything has answered.
  await expect(box(page).locator('iframe')).toHaveCount(1);
  await expect.poll(() => frameHeight(page), { timeout: 15_000 }).toBe(X_HEIGHT);
  await shot(page, '01-public-post-sized');
});

// docs/embed-requirements.md §10.10, criterion X11. The editor has refused this since 2026-08-24;
// the published page did not until 2026-09-01, and `event.origin` does not cover it — every X embed
// on the page is served from the same origin, so the origin check says "an X frame" where the
// question is "THIS X frame". The box is now answered only by the frame inside it.
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

  // A second frame at X's own origin, carrying this box's name and a height of its own. Counted as
  // it arrives, so the assertion below cannot pass by the message never being sent.
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
  // §10.6: its iframe is completely empty, so a reader given no fallback sees a blank gap where the
  // author put a reference. The anchor must match `lib/embed-fallback.ts` — which is what
  // lib/render.test.ts pins the *other* code path against.
  const href = await publish(page, 'Public X missing', `前。\n\n${ref(X_MISSING_URL)}\n\n後。\n`);
  await stubX(page);
  await page.goto(href);

  await expect(box(page)).toHaveCount(0, { timeout: 15_000 });
  const link = page.locator(`#post-body a[href="${X_MISSING_URL}"]`);
  await expect(link).toHaveCount(1);
  await expect(link).toHaveText(X_MISSING_URL);
  // The build pipeline is long finished by now, so the client added this itself (§10.6).
  await expect(link).toHaveAttribute('target', '_blank');
  expect(await link.getAttribute('rel')).toBeNull();
  await shot(page, '02-public-missing-link');
});

test('silence below the fold does NOT become a link, however long the page sits (X6)', async ({
  page,
}) => {
  // The decisive one. A load-started clock expires here and replaces a post the reader has not even
  // reached; a visibility-started one has not begun.
  const href = await publish(
    page,
    'Public X below fold',
    `前。\n\n${FILLER}\n\n${ref(X_SILENT_URL)}\n\n後。\n`,
  );
  await stubX(page);
  await page.goto(href);
  await expect(box(page)).toHaveCount(1);

  // Comfortably past EMBED_SILENCE_MS, without scrolling.
  await page.waitForTimeout(11_000);
  await expect(box(page)).toHaveCount(1);
  await expect(box(page).locator('iframe')).toHaveCount(1);
  await expect(page.locator(`#post-body a[href="${X_SILENT_URL}"]`)).toHaveCount(0);

  // And the clock does start once the reader gets there — without which the assertion above would
  // pass for a timeout that never runs at all.
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
  // Past the timeout: an answered embed must stay answered, and settling must have stopped the
  // clock rather than merely beaten it.
  await page.waitForTimeout(11_000);
  await expect(box(page)).toHaveCount(1);
  expect(await frameHeight(page)).toBe(X_HEIGHT);
});

test('an anchor landing mid-article does not misfire on what it skipped past (X6)', async ({
  page,
}) => {
  // A reader arriving on `#heading` never scrolls through the top of the document. The embed above
  // the landing point is never seen, and must therefore never be judged.
  const href = await publish(
    page,
    'Public X anchor landing',
    `${ref(X_SILENT_URL)}\n\n${FILLER}\n\n## 見出し\n\n${ref(X_RESIZE_URL)}\n\n後。\n`,
  );
  await stubX(page);
  // The heading's id is read out of the served HTML rather than off a rendered page. **Rendering it
  // first would defeat the test**: the embed at the top would be on screen during that visit, its
  // clock would start there, and a fragment-only `goto` is a same-document navigation that never
  // reloads — so the expiry observed afterwards would be from a visit the reader never made.
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

  // The one scrolled past above it is still a box, not a link.
  await page.waitForTimeout(11_000);
  await expect(page.locator(`#post-body .embed-x[data-href="${X_SILENT_URL}"]`)).toHaveCount(1);
  await expect(page.locator(`#post-body a[href="${X_SILENT_URL}"]`)).toHaveCount(0);
});
