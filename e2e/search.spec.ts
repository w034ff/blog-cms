import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { TEST_DB_PATH } from './constants';

function randomHex(): string {
  return crypto.randomBytes(8).toString('hex');
}

type SeedOptions = {
  slug?: string;
  title?: string;
  date?: string;
  body?: string;
  draft?: boolean;
  kind?: 'post' | 'scribble';
};

function seedDbPost(options: SeedOptions = {}): {
  id: number;
  slug: string;
  title: string;
} {
  const db = new Database(TEST_DB_PATH);
  try {
    const slug = options.slug ?? randomHex();
    const title = options.title ?? `Post ${slug}`;
    const date = options.date ?? '2026-10-15T09:00:00.000Z';
    const body = options.body ?? '本文です。';
    const draft = options.draft ? 1 : 0;
    const kind = options.kind ?? 'post';

    const stmt = db.prepare(`
      INSERT INTO posts (
        slug, title, date, description, category, tags, draft, body,
        thumbnail, unlisted, edited_at, kind, created_at, updated_at
      ) VALUES (
        ?, ?, ?, '', 'tech', '[]', ?, ?,
        '', 0, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `);

    const result = stmt.run(slug, title, date, draft, body, kind);
    return { id: Number(result.lastInsertRowid), slug, title };
  } finally {
    db.close();
  }
}

test('navigation from header menu to /search, query submission, and results with kind badges (docs/search-requirements.md §6 id=8)', async ({
  page,
}) => {
  const keyword = `kwd${randomHex()}`;
  const post = seedDbPost({
    title: `Article with ${keyword}`,
    body: `Body containing ${keyword} for searching.`,
    kind: 'post',
  });
  const scribble = seedDbPost({
    title: `Scribble with ${keyword}`,
    body: `Quick note with ${keyword}.`,
    kind: 'scribble',
  });

  await page.goto('/');

  // 1. Open "記事" dropdown from header and click "検索"
  const header = page.locator('header');
  const articlesButton = header.getByRole('button', { name: '記事' });
  await articlesButton.click();
  const searchMenuLink = header.getByRole('link', { name: '検索' });
  await expect(searchMenuLink).toBeVisible();
  await searchMenuLink.click();

  await expect(page).toHaveURL(/\/search$/);

  // 2. Input keyword and submit search
  const input = page.getByRole('searchbox', { name: '検索キーワード' });
  await expect(input).toBeVisible();
  await input.fill(keyword);
  await page.getByRole('button', { name: '検索' }).click();

  await expect(page).toHaveURL(new RegExp(`/search\\?q=${keyword}`));

  // 3. Verify results contain both items with appropriate kind badges
  const resultsRegion = page.locator('ol');
  await expect(resultsRegion).toBeVisible();

  const articleItem = resultsRegion.filter({ hasText: post.title });
  await expect(articleItem).toBeVisible();
  await expect(articleItem.getByText('記事', { exact: true })).toBeVisible();

  const scribbleItem = resultsRegion.filter({ hasText: scribble.title });
  await expect(scribbleItem).toBeVisible();
  await expect(scribbleItem.getByText('走り書き', { exact: true })).toBeVisible();
});

test('search form works without JavaScript enabled', async ({ browser }) => {
  const keyword = `nojs${randomHex()}`;
  const post = seedDbPost({
    title: `NoJS Article ${keyword}`,
    body: `Body content for NoJS ${keyword}.`,
    kind: 'post',
  });

  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto('/search');

    const input = page.locator('input[name="q"]');
    await input.fill(keyword);
    await page.locator('button[type="submit"]').click();

    await expect(page).toHaveURL(new RegExp(`/search\\?q=${keyword}`));
    await expect(page.getByText(post.title)).toBeVisible();
  } finally {
    await context.close();
  }
});

test('HTML tags in title or body are rendered safely as literal text without creating DOM elements (docs/search-requirements.md §6 id=6)', async ({
  page,
}) => {
  const keyword = `html${randomHex()}`;
  const htmlTitle = `<b>SafeBold_${keyword}</b>`;
  seedDbPost({
    title: htmlTitle,
    body: `Testing raw html safety with ${keyword}.`,
    kind: 'post',
  });

  await page.goto(`/search?q=${keyword}`);

  // The text literal `<b>...</b>` must be visible
  await expect(page.getByText(htmlTitle)).toBeVisible();

  // No <b> DOM element should be created for SafeBold
  const bElement = page.locator('ol h2 b');
  await expect(bElement).toHaveCount(0);
});

test('search page outputs noindex meta tag and activates the articles header section (docs/search-requirements.md §6 id=9)', async ({
  page,
}) => {
  await page.goto('/search');

  // Verify meta robots is noindex
  const robotsMeta = page.locator('meta[name="robots"]');
  await expect(robotsMeta).toHaveAttribute('content', /noindex/);

  // Verify "記事" button in header has active styling
  const header = page.locator('header');
  const articlesButton = header.getByRole('button', { name: '記事' });
  const scribblesLink = header.getByRole('link', { name: '走り書き' });

  const articlesColor = await articlesButton.evaluate((el) => window.getComputedStyle(el).color);
  const scribblesColor = await scribblesLink.evaluate((el) => window.getComputedStyle(el).color);
  expect(articlesColor).not.toBe(scribblesColor);
});

test('at 360px viewport the search input and results do not horizontally overflow (docs/search-requirements.md §6 id=10)', async ({
  page,
}) => {
  const keyword = `overflow${randomHex()}`;
  const longWord = 'Supercalifragilisticexpialidocious_VeryLongWordWithoutSpacesToTestWrapping';
  seedDbPost({
    title: `Long Title ${keyword} ${longWord}`,
    body: `Snippet content ${keyword} with very long characters ${longWord} repeated.`,
    kind: 'post',
  });

  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(`/search?q=${keyword}`);

  await expect(page.getByText(keyword).first()).toBeVisible();

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(360);
});
