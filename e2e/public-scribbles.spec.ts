import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { TEST_DB_PATH } from './constants';

function randomHexSlug(): string {
  return crypto.randomBytes(10).toString('hex');
}

type SeedOptions = {
  slug?: string;
  title?: string;
  date?: string;
  body?: string;
  draft?: boolean;
  kind?: 'post' | 'scribble';
  tags?: Array<{ slug: string; name: string }>;
};

function seedDbPost(options: SeedOptions = {}): {
  id: number;
  slug: string;
  title: string;
} {
  const db = new Database(TEST_DB_PATH);
  try {
    const slug = options.slug ?? randomHexSlug();
    const title = options.title ?? `Scribble ${slug}`;
    const date = options.date ?? '2026-10-15T09:00:00.000Z';
    const body = options.body ?? '本文です。';
    const draft = options.draft ? 1 : 0;
    const kind = options.kind ?? 'scribble';

    const tagSlugs: string[] = [];
    if (options.tags && options.tags.length > 0) {
      const insertTag = db.prepare(
        'INSERT OR IGNORE INTO tags (slug, name, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
      );
      for (const t of options.tags) {
        insertTag.run(t.slug, t.name);
        tagSlugs.push(t.slug);
      }
    }

    const stmt = db.prepare(`
      INSERT INTO posts (
        slug, title, date, description, category, tags, draft, body,
        thumbnail, unlisted, edited_at, kind, created_at, updated_at
      ) VALUES (
        ?, ?, ?, '', 'uncategorized', ?, ?, ?,
        '', 0, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `);

    const result = stmt.run(slug, title, date, JSON.stringify(tagSlugs), draft, body, kind);
    return { id: Number(result.lastInsertRowid), slug, title };
  } finally {
    db.close();
  }
}

test('SiteHeader links to /scribbles and does not wrap at 360px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  const header = page.locator('header');
  const box1280 = await header.boundingBox();
  expect(box1280).not.toBeNull();

  await page.setViewportSize({ width: 360, height: 640 });
  const box360 = await header.boundingBox();
  expect(box360).not.toBeNull();
  expect(box360!.height).toBe(box1280!.height);

  // Clicking "走り書き" navigates to /scribbles
  await page.getByRole('link', { name: '走り書き' }).click();
  await expect(page).toHaveURL(/\/scribbles$/);
  await expect(page.getByRole('heading', { level: 1, name: '走り書き' })).toBeVisible();
});

test('Claim 3: a published scribble appears on /scribbles, but not on home, tag page, or RSS', async ({
  page,
}) => {
  const tagSlug = `tag-${randomHexSlug().slice(0, 8)}`;
  const tagName = `タグ${tagSlug}`;
  const scribble = seedDbPost({
    kind: 'scribble',
    title: `Claim3 Scribble ${randomHexSlug()}`,
    tags: [{ slug: tagSlug, name: tagName }],
  });

  // Appears on /scribbles
  await page.goto('/scribbles');
  await expect(page.getByText(scribble.title)).toBeVisible();

  // Does not appear on home
  await page.goto('/');
  await expect(page.getByText(scribble.title)).toHaveCount(0);

  // Tag page for tag with only scribbles 404s (or does not contain scribble)
  const tagResponse = await page.goto(`/tags/${encodeURIComponent(tagSlug)}`);
  expect(tagResponse?.status()).toBe(404);
  await expect(page.getByText(scribble.title)).toHaveCount(0);

  // Does not appear in RSS feed
  const rssResponse = await page.request.get('/rss.xml');
  expect(rssResponse.status()).toBe(200);
  const rssText = await rssResponse.text();
  expect(rssText).not.toContain(scribble.title);
});

test('Claim 4: /posts/<scribble> and /scribbles/<post> both return 404', async ({ page }) => {
  const scribble = seedDbPost({ kind: 'scribble' });
  const post = seedDbPost({ kind: 'post' });

  const res1 = await page.goto(`/posts/${scribble.slug}`);
  expect(res1?.status()).toBe(404);

  const res2 = await page.goto(`/scribbles/${post.slug}`);
  expect(res2?.status()).toBe(404);
});

test('Claim 5: robots meta contains noindex on /scribbles and /scribbles/<slug>', async ({
  page,
}) => {
  const scribble = seedDbPost({ kind: 'scribble' });

  await page.goto('/scribbles');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

  await page.goto(`/scribbles/${scribble.slug}`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});

test.describe('Claim 6: draft scribbles preview', () => {
  test('with no session, draft scribble returns 404 and reveals nothing', async ({ browser }) => {
    const unauthed = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const draft = seedDbPost({
        kind: 'scribble',
        draft: true,
        body: '秘密の下書き本文です。',
      });
      const unauthedPage = await unauthed.newPage();
      const res = await unauthedPage.goto(`/scribbles/${draft.slug}`);
      expect(res?.status()).toBe(404);
      await expect(unauthedPage.locator('#scribble-body')).toHaveCount(0);
      await expect(unauthedPage.getByText('下書きのプレビュー')).toHaveCount(0);
    } finally {
      await unauthed.close();
    }
  });

  test('logged-in author can preview a draft scribble with the preview banner', async ({
    page,
  }) => {
    const draft = seedDbPost({
      kind: 'scribble',
      draft: true,
      body: '下書きプレビューの本文です。',
    });

    await page.goto(`/scribbles/${draft.slug}`);
    await expect(page.locator('#scribble-body')).toContainText('下書きプレビューの本文です。');
    await expect(page.getByRole('status')).toContainText('下書きのプレビュー');
    await expect(page.getByRole('link', { name: '編集に戻る' })).toHaveAttribute(
      'href',
      `/admin/posts/${draft.id}/edit`,
    );
  });
});

test('Claim 11: long scribble card is clipped at 300px with 続きを読む, short card is not', async ({
  page,
}) => {
  const longBody = Array.from(
    { length: 30 },
    (_, i) => `段落 ${i + 1} の長い本文テキストです。`,
  ).join('\n\n');
  const longScribble = seedDbPost({
    kind: 'scribble',
    title: `Long ${randomHexSlug()}`,
    body: longBody,
  });

  const shortScribble = seedDbPost({
    kind: 'scribble',
    title: `Short ${randomHexSlug()}`,
    body: '短い本文です。',
  });

  await page.goto('/scribbles');

  const longRow = page.locator('li', { hasText: longScribble.title });
  const shortRow = page.locator('li', { hasText: shortScribble.title });

  // Long card gets "続きを読む →" link
  const readMore = longRow.getByRole('link', { name: '続きを読む →' });
  await expect(readMore).toBeVisible();

  // Clipped body box height is <= 300px
  const longBodyBox = await longRow.locator('[data-scribble-body-box]').boundingBox();
  expect(longBodyBox).not.toBeNull();
  expect(longBodyBox!.height).toBeLessThanOrEqual(300);

  // Short card does not get "続きを読む →" link
  await expect(shortRow.getByRole('link', { name: '続きを読む →' })).toHaveCount(0);
});

test('Claim 12 wiring: embed in scribble renders as link on list and iframe on detail page', async ({
  page,
}) => {
  const embedBody =
    '<div class="embed" data-href="https://www.youtube.com/watch?v=hDPybQwAuVo"></div>';
  const scribble = seedDbPost({
    kind: 'scribble',
    title: `Embed Scribble ${randomHexSlug()}`,
    body: embedBody,
  });

  // On list: no iframe, plain link
  await page.goto('/scribbles');
  const card = page.locator('li', { hasText: scribble.title });
  await expect(card.locator('iframe')).toHaveCount(0);
  await expect(card.locator('a[href="https://www.youtube.com/watch?v=hDPybQwAuVo"]')).toBeVisible();

  // On detail page: iframe renders
  await page.goto(`/scribbles/${scribble.slug}`);
  await expect(page.locator('iframe[src*="youtube"]')).toBeVisible();
});
