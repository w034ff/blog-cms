import { test, expect, type Page } from '@playwright/test';
import { loadMarkdown } from './editor-authoring';
import { shot } from './editor-probe';

// The YouTube embed on the *published* page (docs/embed-requirements.md §6, §9.5).
//
// lib/render.test.ts measures the rehype stage against a string. Two things exist only beyond that
// string, and this file is where they are:
//
//   1. The stage's position in the real pipeline. `<iframe>` is not in the sanitize schema, so an
//      iframe on a published page is itself the evidence that rehypeEmbed runs after
//      rehypeSanitize — move it before, and the element the stage builds is stripped.
// Everything is scoped to `#post-body`: `.prose` also matches the two footnote popovers on the
// page, which are empty and would make any text assertion a strict-mode violation.
//
//   2. The CSS. The ratio is held by a wrapper because an `<iframe>` given `aspect-ratio` alone
//      negotiates its own size — a claim about layout that nothing but a browser can settle.

const ID = 'hDPybQwAuVo';
const SRC = `https://www.youtube-nocookie.com/embed/${ID}`;

async function publish(page: Page, title: string, source: string): Promise<string> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill(title);
  await loadMarkdown(page, source);

  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '投稿' }).click();
  await expect(page.getByText('公開済み（最新）')).toBeVisible({ timeout: 20_000 });

  const href = await page.getByRole('link', { name: '表示' }).getAttribute('href');
  expect(href).toMatch(/^\/posts\/[0-9a-f]+$/);
  return href!;
}

test('a published reference becomes an iframe in a 16:9 box (§9.5)', async ({ page }) => {
  const href = await publish(
    page,
    'Public embed spec',
    `本文の前。\n\n<div class="embed" data-href="https://www.youtube.com/watch?v=${ID}&amp;t=90"></div>\n\n本文の後。\n`,
  );
  await page.goto(href);

  const frame = page.locator('#post-body .embed-youtube .embed-frame');
  await expect(frame).toHaveCount(1);
  const iframe = frame.locator('iframe');
  await expect(iframe).toHaveAttribute('src', `${SRC}?start=90`);
  // Below the fold this is what keeps the third party unasked until the reader scrolls (§9.5). The
  // request itself cannot be removed — that is §8-① — only made to follow the reader's attention.
  await expect(iframe).toHaveAttribute('loading', 'lazy');

  // The ratio, measured rather than read off the stylesheet: the wrapper exists precisely because
  // an iframe given `aspect-ratio` by itself does not take it.
  const box = await frame.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width / box!.height).toBeCloseTo(16 / 9, 1);
  // The player fills the box it was given, rather than sizing the box.
  const inner = await iframe.boundingBox();
  expect(inner!.height).toBeCloseTo(box!.height, 0);

  await expect(page.locator('#post-body')).toContainText('本文の前。');
  await shot(page, '06-public-embed');
});

test('a reference naming no single video is published as a plain link (Y4)', async ({ page }) => {
  const href = await publish(
    page,
    'Public embed fallback spec',
    '<div class="embed" data-href="https://www.youtube.com/playlist?list=PLabc"></div>\n',
  );
  await page.goto(href);

  await expect(page.locator('#post-body iframe')).toHaveCount(0);
  // Nothing is lost for the reader, and the author sees a link where they expected a player —
  // dropping the node instead would make the body silently shorter.
  await expect(
    page.locator('#post-body a[href="https://www.youtube.com/playlist?list=PLabc"]'),
  ).toHaveCount(1);
});

test('a hand-written javascript: reference becomes nothing at all (E2)', async ({ page }) => {
  // Both exits have to refuse it: the iframe, and the plain-link fallback — which is published
  // markup built after sanitize as well, and which let it through until lib/render.test.ts asked.
  const href = await publish(
    page,
    'Public embed protocol spec',
    '本文。\n\n<div class="embed" data-href="javascript:alert(1)"></div>\n',
  );
  await page.goto(href);

  await expect(page.locator('#post-body')).toContainText('本文。');
  await expect(page.locator('#post-body iframe')).toHaveCount(0);
  expect(await page.locator('#post-body').innerHTML()).not.toContain('javascript:');
});

// docs/embed-requirements.md §14.4, criterion S6. The deck itself is never fetched: SlideShare is
// routed to a blank page of our own, because what this measures is the box, and a spec that leans
// on a third party's uptime measures that instead. The stub also stands in for the `302 →
// embed_code/key/<KEY>` the real host answers with (§14.3) — the redirect belongs to the reader's
// browser, and nothing here depends on where it lands.
const DECK = 'https://www.slideshare.net/slideshow/slidesharesample-260753333/260753333';

test('a deck reference is published in a 597:486 box the player fills (S6)', async ({ page }) => {
  await page.route('https://www.slideshare.net/slideshow/embed_code/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>stub</title>' }),
  );
  const href = await publish(
    page,
    'Public slideshare spec',
    `本文の前。\n\n<div class="embed" data-href="${DECK}"></div>\n\n本文の後。\n`,
  );
  await page.goto(href);

  const frame = page.locator('#post-body .embed-slideshare .embed-frame');
  await expect(frame).toHaveCount(1);
  const iframe = frame.locator('iframe');
  await expect(iframe).toHaveAttribute(
    'src',
    'https://www.slideshare.net/slideshow/embed_code/260753333',
  );
  // Full screen is this attribute's business and not the `allow` string's (§14.4).
  await expect(iframe).toHaveAttribute('allowfullscreen', '');
  await expect(iframe).toHaveAttribute('loading', 'lazy');

  // The ratio, measured rather than read off the stylesheet — the wrapper is what holds it.
  const box = await frame.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width / box!.height).toBeCloseTo(597 / 486, 1);
  // Wide enough that the criterion is not vacuous: a box narrower than the column would pass the
  // ratio check while saying nothing about the column it sits in.
  expect(box!.width).toBeGreaterThan(400);
  const inner = await iframe.boundingBox();
  expect(inner!.height).toBeCloseTo(box!.height, 0);
});
