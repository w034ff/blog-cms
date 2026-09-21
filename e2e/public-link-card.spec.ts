import { test, expect, type Page } from '@playwright/test';
import { expectAutosaved, expectPublished, loadMarkdown } from './editor-authoring';
import { publishedPath } from './published-post';

// The link card on the *published* page (docs/link-card-requirements.md §6, criteria 1c/2a–2e).
//
// lib/render.test.ts measures the rehype stage against a stub resolver — a string in, a string out.
// Two things only exist beyond that string, and this file is where they are:
//
//   1. `resolveCard` itself. The real one lives in app/posts/[slug]/page.tsx, closes over
//      getPostBySlug, and is the only route a card's data takes in production. Every vitest case
//      hands over a literal instead, so nothing else executes it.
//   2. The CSS. The card is one big `<a>`, and `.prose a { color: #0969da }` (0,1,1) would paint the
//      whole of it blue and underlined. `.prose a.link-card` (0,2,1) is what stops that — a
//      specificity argument read off the stylesheet, which is exactly the kind of claim that is
//      wrong for free until something measures it.

// `second-post` is seeded from the real data/blog.db copy (e2e/prepare-db.mts).
const TARGET_SLUG = 'second-post';
const TARGET_TITLE = 'React Server Components を学ぶよ';
// A phrase from the opening of that post's body, not a stored field: a post has no description
// field, and the card reads lib/excerpt.ts's excerpt of the body (docs/cms-features.md
// 「説明文の自動抽出」). A substring, because the excerpt's exact shape is lib/excerpt.test.ts's
// claim — this spec only shows the real resolveCard delivers it.
const TARGET_DESCRIPTION = 'サーバー側でレンダリングされる React コンポーネント';

const BLUE_LIGHT = 'rgb(9, 105, 218)'; // #0969da — the `.prose a` colour this must not inherit

// Publishes a post whose body is `source` and returns its public URL. Published rather than
// previewed because the published side is the whole claim here.
async function publish(page: Page, title: string, source: string): Promise<string> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill(title);
  await loadMarkdown(page, source);

  await expectAutosaved(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);

  return publishedPath(page);
}

test('a published card resolves against the real posts table (1c/2a)', async ({ page }) => {
  const href = await publish(
    page,
    'Public link card spec',
    `本文の前。\n\n<div class="link-card" data-href="/posts/${TARGET_SLUG}"></div>\n\n本文の後。\n`,
  );
  await page.goto(href);

  const card = page.locator('.prose a.link-card');
  await expect(card).toHaveCount(1);
  // The title is in neither the body nor the stylesheet — it can only have come through
  // resolveCard → getPostBySlug, which nothing else in the suite runs.
  await expect(card.locator('.link-card-title')).toHaveText(TARGET_TITLE);
  await expect(card.locator('.link-card-description')).toContainText(TARGET_DESCRIPTION);
  await expect(card).toHaveAttribute('href', `/posts/${TARGET_SLUG}`);
  // Title and description are the whole card — the target's date was dropped 2026-08-15
  // (lib/rehype-link-card.ts carries the reason). Asserted rather than assumed because
  // `.link-card-meta` is still a live class: the editor's NodeView uses it for the line that says
  // the target is a draft or cannot be found (§13.1).
  await expect(card.locator('.link-card-meta')).toHaveCount(0);

  // 2a, from the other end: had `class` or `data-href` been stripped by sanitize, the stage would
  // never have seen the div and this would be an empty `<div>` on the page.
  await expect(page.locator('.prose div.link-card')).toHaveCount(0);
});

test('the card is not painted like an ordinary link (§7.1 regression)', async ({ page }) => {
  const href = await publish(
    page,
    'Public link card colour spec',
    `<div class="link-card" data-href="/posts/${TARGET_SLUG}"></div>\n\n本文と[ふつうのリンク](https://example.com)。\n`,
  );
  await page.goto(href);

  const card = page.locator('.prose a.link-card');
  await expect(card).toHaveCount(1);
  // The two assertions the specificity argument actually rests on.
  await expect(card).toHaveCSS('text-decoration-line', 'none');
  expect(await card.evaluate((el) => getComputedStyle(el).color)).not.toBe(BLUE_LIGHT);

  // …and the control: the rule the card is escaping is still doing its job on the same page, so
  // this passing cannot mean `.prose a` simply stopped applying to anything.
  const ordinary = page.locator('.prose a:not(.link-card)');
  await expect(ordinary).toHaveCount(1);
  await expect(ordinary).toHaveCSS('color', BLUE_LIGHT);
});

test('an unresolvable reference falls back to a plain link (2d/2e)', async ({ page }) => {
  // `/posts/does-not-exist` is the shape a draft reference also takes: getPostBySlug returns null
  // for both, so the published page cannot tell them apart and §6.1 chose one answer for both.
  const href = await publish(
    page,
    'Public link card fallback spec',
    '<div class="link-card" data-href="/posts/does-not-exist"></div>\n',
  );
  await page.goto(href);

  await expect(page.locator('.prose a.link-card')).toHaveCount(0);
  const fallback = page.locator('.prose a[href="/posts/does-not-exist"]');
  await expect(fallback).toHaveCount(1);
  await expect(fallback).toHaveText('/posts/does-not-exist');
  // Nothing empty left behind: the author sees a link where they expected a card, which is what
  // makes the mistake findable after publishing.
  await expect(page.locator('.prose div.link-card')).toHaveCount(0);
});

test('a hand-written javascript: reference produces no link at all (2c)', async ({ page }) => {
  // The §4.4 hole end to end: `html: true` in the editor and rehype-raw on the public side mean an
  // author can type this, and no protocol check stands between it and the page — rehypeLinkCard's
  // own shape test is the only thing that does. Measured on the real page, not just on a string.
  const href = await publish(
    page,
    'Public link card protocol spec',
    '<div class="link-card" data-href="javascript:alert(1)"></div>\n\nあと。\n',
  );
  await page.goto(href);

  // `#post-body` rather than `.prose`: the public page has three `.prose` boxes (the body and
  // the two table-of-contents rails), and this one is the article body.
  const body = page.locator('#post-body');
  await expect(body).toContainText('あと。');
  expect(await body.innerHTML()).not.toContain('javascript:');
  await expect(body.locator('a')).toHaveCount(0);
  await expect(body.locator('div.link-card')).toHaveCount(0);
});

// The external card on the published page (docs/link-card-requirements.md §14.9). `example.com` and
// `unreachable.example` have seeded `link_previews` rows (e2e/prepare-db.mts) — which is not a
// convenience but the claim itself: the published page reads the table and never fetches (§14.1),
// so a spec that had to reach the network would be measuring the wrong design.
const EXTERNAL_HREF = 'https://example.com/article';

test('a published external card is built from the stored row (14i/14j)', async ({ page }) => {
  const href = await publish(
    page,
    'Public external card spec',
    `前。\n\n<div class="link-card" data-href="${EXTERNAL_HREF}"></div>\n\n後。\n`,
  );
  await page.goto(href);

  const card = page.locator('.prose a.link-card');
  await expect(card).toHaveCount(1);
  // Neither string is in the body — both came out of `link_previews` through resolveCard.
  await expect(card.locator('.link-card-title')).toHaveText('外部ページの見出し');
  await expect(card.locator('.link-card-description')).toHaveText('外部ページの説明文');
  // The provenance line, which is the slot §12 left empty while every card pointed at this blog.
  await expect(card.locator('.link-card-domain')).toHaveText('example.com');
  await expect(card).toHaveAttribute('href', EXTERNAL_HREF);
  // Where the picture comes from is its own test below — this one is about the text.
});

test('an external reference with no stored row falls back to a plain link (14d)', async ({
  page,
}) => {
  // Nothing has ever resolved this URL, so there is no row — and the page does not go looking for
  // one. Same fallback a draft or an unknown slug gets (§6.1): the reader still has the link.
  const unknown = 'https://never-resolved.example/x';
  const href = await publish(
    page,
    'Public external fallback spec',
    `<div class="link-card" data-href="${unknown}"></div>\n`,
  );
  await page.goto(href);

  await expect(page.locator('.prose a.link-card')).toHaveCount(0);
  const link = page.locator('.prose a', { hasText: unknown });
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAttribute('href', unknown);
});

test('a published external card serves its picture through this site (14j)', async ({ page }) => {
  // §14.4. The reader's browser must never be pointed at the target's CDN, so what matters is the
  // `src` this page emits — a same-origin signed path — rather than whether the bytes arrive. The
  // seeded image URL is a loopback literal (e2e/prepare-db.mts), which the address guard refuses
  // without asking a resolver: no network, and nothing about the assertion changes.
  const href = await publish(
    page,
    'Public external card image spec',
    `<div class="link-card" data-href="${EXTERNAL_HREF}"></div>\n`,
  );
  await page.goto(href);

  const img = page.locator('.prose a.link-card img.link-card-image');
  await expect(img).toHaveCount(1);
  const src = await img.getAttribute('src');
  expect(src).toMatch(/^\/api\/link-image\?url=/);
  expect(src).toContain(encodeURIComponent('http://127.0.0.1/og.png'));

  // The signature is the whole gate on that route — it cannot be admin-gated, since readers load
  // it. A tampered one is refused before anything is fetched.
  const tampered = src!.replace(/sig=.*$/, 'sig=00000000000000000000');
  expect((await page.request.get(tampered)).status()).toBe(404);
  // And a URL nobody signed, which is the open-proxy case.
  const unsigned = '/api/link-image?url=' + encodeURIComponent('https://evil.example/x.png');
  expect((await page.request.get(unsigned)).status()).toBe(404);
});

// §17.3, criterion 17d. The house mark is the site's name in the foreground colour, so it is two
// files and the page picks — and the wrong pick is not a shade off, it is a black wordmark on the
// dark tint. `src` cannot answer which one won, so this reads `currentSrc` in a dark context; the
// light half is measured in thumbnail.spec.ts, and both halves are needed because a `<source>` that
// matched unconditionally would pass either one alone.
test.describe('in a dark colour scheme', () => {
  test.use({ colorScheme: 'dark' });

  test('the house mark loads its dark file (17d)', async ({ page }) => {
    const href = await publish(
      page,
      'Public card dark mark spec',
      `<div class="link-card" data-href="/posts/${TARGET_SLUG}"></div>\n`,
    );
    await page.goto(href);

    // `second-post` is seeded with no thumbnail and no image in its body, so this card resolves to
    // the mark rather than to a picture.
    const image = page.locator('.prose a.link-card img.link-card-placeholder');
    await expect(image).toHaveCount(1);
    await expect
      .poll(async () => image.evaluate((el: HTMLImageElement) => el.currentSrc))
      .toContain('/link-card-placeholder-dark.svg');
    // The tint under it moves with the same query, from the stylesheet rather than from the file.
    await expect(image).toHaveCSS('background-color', 'rgb(28, 33, 40)');
  });
});
