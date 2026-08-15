import { test, expect, type Page } from '@playwright/test';
import { loadMarkdown } from './editor-authoring';

// The post's card image, end to end: the editor's picker, the column it writes, the body-derived
// fallback, and the three surfaces that show the result (docs/link-card-requirements.md §8.2).
//
// lib/thumbnail.test.ts measures `resolveThumbnail` as a pure function — a string in, a string out.
// What only exists in a browser is everything around it: whether the picked path survives the trip
// through the form into the column (useAutosave reads the live form DOM, not React state, so a
// field that renders correctly can still save nothing), and whether the published pages read the
// resolver rather than the raw column.

const PNG_1x1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG_1x1 = Buffer.from(PNG_1x1_BASE64, 'base64');

const UPLOAD_SRC = /^\/uploads\/[0-9a-f]+\.png$/;

async function publish(page: Page, title: string, source: string): Promise<string> {
  await page.getByLabel('タイトル').fill(title);
  if (source !== '') await loadMarkdown(page, source);
  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '投稿' }).click();
  await expect(page.getByText('公開済み（最新）')).toBeVisible({ timeout: 20_000 });
  const href = await page.getByRole('link', { name: '表示' }).getAttribute('href');
  expect(href).toMatch(/^\/posts\/[0-9a-f]+$/);
  return href!;
}

// The explicit half. The picker uploads through the same /api/uploads the editor's own image
// button uses, and the chosen path has to reach the column — which it can only do through the
// hidden input, since that is what `new FormData(form)` sees.
test('the picker sets an explicit thumbnail that survives a reload', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();

  // Nothing chosen and nothing in the body: the field says so rather than showing a stale box.
  await expect(page.getByText('未設定。本文に画像を入れると自動で使われます。')).toBeVisible();

  await page.getByTestId('thumbnail-picker').setInputFiles({
    name: 'e2e-thumb.png',
    mimeType: 'image/png',
    buffer: PNG_1x1,
  });

  const preview = page.locator('input[name="thumbnail"]');
  await expect(preview).toHaveValue(UPLOAD_SRC, { timeout: 20_000 });
  await expect(page.getByText('この記事用に指定した画像です。')).toBeVisible();

  const chosen = await preview.inputValue();
  await page.getByLabel('タイトル').fill('サムネイル指定');
  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });

  // The round trip is the claim: autosave snapshots the form, so a field that displays correctly
  // but is not in the FormData saves an empty column and only a reload reveals it.
  await page.reload();
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await expect(page.locator('input[name="thumbnail"]')).toHaveValue(chosen);
});

// 解除 puts the post back to the fallback rather than to "no image", which is the distinction the
// field's label carries — and the reason the two states cannot share one message.
test('解除 drops back to the body’s first image', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();

  await page.getByTestId('image-picker').setInputFiles({
    name: 'e2e-body.png',
    mimeType: 'image/png',
    buffer: PNG_1x1,
  });
  await expect(page.locator('.ProseMirror img')).toBeVisible({ timeout: 20_000 });

  // With nothing chosen, the body's image is already what the card would use.
  await expect(page.getByText('本文の最初の画像を自動で使用中。')).toBeVisible();
  await expect(page.locator('input[name="thumbnail"]')).toHaveValue('');

  await page.getByTestId('thumbnail-picker').setInputFiles({
    name: 'e2e-thumb.png',
    mimeType: 'image/png',
    buffer: PNG_1x1,
  });
  await expect(page.getByText('この記事用に指定した画像です。')).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: '解除' }).click();
  await expect(page.locator('input[name="thumbnail"]')).toHaveValue('');
  await expect(page.getByText('本文の最初の画像を自動で使用中。')).toBeVisible();
});

// The published side, all three surfaces from one post. The body carries no image at all, so
// anything shown here can only have come from the column.
test('an explicit thumbnail reaches the list, the card and og:image', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByTestId('thumbnail-picker').setInputFiles({
    name: 'e2e-thumb.png',
    mimeType: 'image/png',
    buffer: PNG_1x1,
  });
  await expect(page.locator('input[name="thumbnail"]')).toHaveValue(UPLOAD_SRC, {
    timeout: 20_000,
  });
  const chosen = await page.locator('input[name="thumbnail"]').inputValue();
  const href = await publish(page, 'サムネイル公開', '本文に画像は無い。\n');
  const slug = href.slice('/posts/'.length);

  // og:image, resolved to an absolute URL against metadataBase.
  await page.goto(href);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    'content',
    new RegExp(`${chosen}$`),
  );

  // The post list. Its image is decoration beside a title that already links to the same place,
  // so it is aria-hidden — locate it by src rather than by role.
  await page.goto('/');
  await expect(page.locator(`article:has-text("サムネイル公開") img[src="${chosen}"]`)).toHaveCount(
    1,
  );

  // The link card on another post's page (criterion 5f).
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  const cardHref = await publish(
    page,
    'カードから参照',
    `<div class="link-card" data-href="/posts/${slug}"></div>\n`,
  );
  await page.goto(cardHref);
  const card = page.locator('.prose a.link-card');
  await expect(card).toHaveCount(1);
  await expect(card.locator('img.link-card-image')).toHaveAttribute('src', chosen);
  // Empty alt: the title is inside the same anchor, so a described image is read twice.
  await expect(card.locator('img.link-card-image')).toHaveAttribute('alt', '');

  // The box is the stylesheet's, not the file's. Uploads arrive at whatever size the author had,
  // and a card that sized itself to its picture would make a column of cards ragged — so this
  // measures the rendered box rather than trusting that the rule matched. The fixture is a 1x1
  // PNG, which makes the two outcomes unmistakable: 128x80 is the rule, 1x1 is no rule at all.
  const box = await card.locator('img.link-card-image').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeCloseTo(128, 0);
  expect(box!.height).toBeCloseTo(80, 0);
});

// The fallback half, on the published side. Nothing was chosen, so a picture here proves the list
// reads `resolveThumbnail` and not the column — the whole reason the existing archive gained
// images without being re-edited.
test('a post with no chosen image still shows the body’s first one', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();

  await page.getByTestId('image-picker').setInputFiles({
    name: 'e2e-body.png',
    mimeType: 'image/png',
    buffer: PNG_1x1,
  });
  await expect(page.locator('.ProseMirror img')).toBeVisible({ timeout: 20_000 });
  const bodySrc = await page.locator('.ProseMirror img').getAttribute('src');

  await expect(page.locator('input[name="thumbnail"]')).toHaveValue('');
  await publish(page, '本文から拾う', '');

  await page.goto('/');
  await expect(page.locator(`article:has-text("本文から拾う") img[src="${bodySrc}"]`)).toHaveCount(
    1,
  );
});

// The other direction, which is the half a positive-only test would let rot: a post with no image
// anywhere carries no <img> on either surface rather than an empty frame (criterion 5f).
test('a post with no image anywhere shows no image box', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  const href = await publish(page, '画像なしの記事', '文字だけの本文。\n');
  const slug = href.slice('/posts/'.length);

  await page.goto('/');
  await expect(page.locator('article:has-text("画像なしの記事") img')).toHaveCount(0);

  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  const cardHref = await publish(
    page,
    '画像なしを参照',
    `<div class="link-card" data-href="/posts/${slug}"></div>\n`,
  );
  await page.goto(cardHref);
  await expect(page.locator('.prose a.link-card')).toHaveCount(1);
  await expect(page.locator('.prose a.link-card img')).toHaveCount(0);
  // The text column is there either way, so the card's shape does not depend on having a picture.
  await expect(page.locator('.prose a.link-card .link-card-text')).toHaveCount(1);
});
