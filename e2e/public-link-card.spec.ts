import { test, expect, type Page } from '@playwright/test';
import { expectAutosaved, expectPublished, loadMarkdown, ensureCategory } from './editor-authoring';
import { publishedPath } from './published-post';

// The link card on the published page (docs/link-card-requirements.md §6, criteria 1c/2a–2e).
// Beyond lib/render.test.ts's string: (1) the real `resolveCard` (lib/resolve-card.ts, over
// getPostBySlug), which no vitest case runs; (2) the CSS: `.prose a.link-card` (0,2,1) keeping
// `.prose a` (0,1,1) from painting the whole card blue and underlined.

// Seeded from the data/blog.db copy (e2e/prepare-db.mts).
const TARGET_SLUG = 'second-post';
const TARGET_TITLE = 'React Server Components を学ぶよ';
// From the body's opening: the card reads lib/excerpt.ts's excerpt (docs/cms-features.md
// 「説明文の自動抽出」), whose exact shape is lib/excerpt.test.ts's.
const TARGET_DESCRIPTION = 'サーバー側でレンダリングされる React コンポーネント';

const BLUE_LIGHT = 'rgb(9, 105, 218)'; // #0969da — the `.prose a` colour this must not inherit

// Publishes `source`, returning the public URL: the published side is the claim.
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

test('a published card resolves against the real posts table (1c/2a)', async ({ page }) => {
  const href = await publish(
    page,
    'Public link card spec',
    `本文の前。\n\n<div class="link-card" data-href="/posts/${TARGET_SLUG}"></div>\n\n本文の後。\n`,
  );
  await page.goto(href);

  const card = page.locator('.prose a.link-card');
  await expect(card).toHaveCount(1);
  // The title can only come through resolveCard → getPostBySlug.
  await expect(card.locator('.link-card-title')).toHaveText(TARGET_TITLE);
  await expect(card.locator('.link-card-description')).toContainText(TARGET_DESCRIPTION);
  await expect(card).toHaveAttribute('href', `/posts/${TARGET_SLUG}`);
  // No date line (lib/rehype-link-card.ts says why). `.link-card-meta` is still live in the editor
  // (§13.1).
  await expect(card.locator('.link-card-meta')).toHaveCount(0);

  // 2a: had sanitize stripped `class` or `data-href`, an empty `<div>` would be here.
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
  // The two assertions the specificity argument rests on.
  await expect(card).toHaveCSS('text-decoration-line', 'none');
  expect(await card.evaluate((el) => getComputedStyle(el).color)).not.toBe(BLUE_LIGHT);

  // Control: `.prose a` still applies on the page.
  const ordinary = page.locator('.prose a:not(.link-card)');
  await expect(ordinary).toHaveCount(1);
  await expect(ordinary).toHaveCSS('color', BLUE_LIGHT);
});

test('an unresolvable reference falls back to a plain link (2d/2e)', async ({ page }) => {
  // A draft reference looks the same: getPostBySlug returns null for both (§6.1).
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
  // Nothing empty left: a link, so the mistake is findable.
  await expect(page.locator('.prose div.link-card')).toHaveCount(0);
});

test('a hand-written javascript: reference produces no link at all (2c)', async ({ page }) => {
  // §4.4 end to end: `html: true` and rehype-raw let an author type this, and only rehypeLinkCard's
  // shape test stands in the way.
  const href = await publish(
    page,
    'Public link card protocol spec',
    '<div class="link-card" data-href="javascript:alert(1)"></div>\n\nあと。\n',
  );
  await page.goto(href);

  // `#post-body`: the page has other `.prose` boxes.
  const body = page.locator('#post-body');
  await expect(body).toContainText('あと。');
  expect(await body.innerHTML()).not.toContain('javascript:');
  await expect(body.locator('a')).toHaveCount(0);
  await expect(body.locator('div.link-card')).toHaveCount(0);
});

// The external card (§14.9). The seeded `link_previews` rows are the claim, not a convenience: the
// published page reads the table and never fetches (§14.1).
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
  // Both strings came from `link_previews`.
  await expect(card.locator('.link-card-title')).toHaveText('外部ページの見出し');
  await expect(card.locator('.link-card-description')).toHaveText('外部ページの説明文');
  // The provenance line (§12's empty slot).
  await expect(card.locator('.link-card-domain')).toHaveText('example.com');
  await expect(card).toHaveAttribute('href', EXTERNAL_HREF);
  // The picture is its own test below.
});

test('an external reference with no stored row falls back to a plain link (14d)', async ({
  page,
}) => {
  // No row, and the page does not look: the §6.1 fallback.
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
  // §14.4: the emitted `src` is a same-origin signed path. The seeded image is a loopback literal the
  // address guard refuses without DNS.
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

  // The signature is the route's whole gate (readers load it); a tampered one is refused before any
  // fetch.
  const tampered = src!.replace(/sig=.*$/, 'sig=00000000000000000000');
  expect((await page.request.get(tampered)).status()).toBe(404);
  // An unsigned URL: the open-proxy case.
  const unsigned = '/api/link-image?url=' + encodeURIComponent('https://evil.example/x.png');
  expect((await page.request.get(unsigned)).status()).toBe(404);
});

// §17.3, criterion 17d: the wrong wordmark is black on the dark tint. `currentSrc` in a dark context;
// the light half is in thumbnail.spec.ts, and both are needed against a `<source>` that always
// matches.
test.describe('in a dark colour scheme', () => {
  test.use({ colorScheme: 'dark' });

  test('the house mark loads its dark file (17d)', async ({ page }) => {
    const href = await publish(
      page,
      'Public card dark mark spec',
      `<div class="link-card" data-href="/posts/${TARGET_SLUG}"></div>\n`,
    );
    await page.goto(href);

    // `second-post` has no image, so the mark.
    const image = page.locator('.prose a.link-card img.link-card-placeholder');
    await expect(image).toHaveCount(1);
    await expect
      .poll(async () => image.evaluate((el: HTMLImageElement) => el.currentSrc))
      .toContain('/link-card-placeholder-dark.svg');
    // The tint follows the same query, from the stylesheet.
    await expect(image).toHaveCSS('background-color', 'rgb(28, 33, 40)');
  });
});
