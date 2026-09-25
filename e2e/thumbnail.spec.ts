import { test, expect, type Page } from '@playwright/test';
import {
  closePostSettings,
  expectAutosaved,
  expectPublished,
  loadMarkdown,
  openPostSettings,
  ensureCategory,
} from './editor-authoring';
import { publishedPath } from './published-post';

// The post's card image end to end (docs/link-card-requirements.md §8.2): the bubble menu, the
// column, the body fallback, the four surfaces. lib/thumbnail.test.ts covers `resolveThumbnail`;
// here: the NodeSelection the menu shows for, the path surviving the form (useAutosave reads the
// form DOM, not React state), and published pages reading the resolver, not the column.

// Scoped to the menu (ImageBubble.tsx), not a bare accessible name.
const imageBubble = (page: Page) => page.locator('.image-bubble');

// An inserted image stays node-selected, so the next upload would replace it. A click below it
// lands in TrailingNode's paragraph, a TextSelection.
async function clickPastLastImage(page: Page): Promise<void> {
  await page.locator('.ProseMirror').click({ position: { x: 10, y: 400 } });
}

const PNG_1x1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG_1x1 = Buffer.from(PNG_1x1_BASE64, 'base64');

// Uploads are named by content hash (app/api/uploads/route.ts), so two images need two contents.
const PNG_1x1_RED_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const PNG_1x1_RED = Buffer.from(PNG_1x1_RED_BASE64, 'base64');

const UPLOAD_SRC = /^\/uploads\/[0-9a-f]+\.png$/;

async function publish(page: Page, title: string, source: string): Promise<string> {
  await page.getByLabel('タイトル').fill(title);
  if (source !== '') await loadMarkdown(page, source);
  await expectAutosaved(page);
  await ensureCategory(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);
  return publishedPath(page);
}

// The explicit half. Two routes (the bubble menu marks a body image; ThumbnailField's picker uploads
// one), both reaching the column through the hidden input `new FormData(form)` reads.
test('the bubble menu sets an explicit thumbnail that survives a reload', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  // The drawer is modal (PostSettingsPanel.tsx): open it for its status text, close it before
  // touching the body.
  await openPostSettings(page);
  // Nothing chosen or in the body: the field says so.
  await expect(page.getByText('本文の最初の画像が自動で入ります', { exact: true })).toBeVisible();
  await closePostSettings(page);

  await page.locator('.ProseMirror').click();
  await page.getByTestId('image-picker').setInputFiles({
    name: 'e2e-thumb.png',
    mimeType: 'image/png',
    buffer: PNG_1x1,
  });
  await expect(page.locator('.ProseMirror img')).toBeVisible({ timeout: 20_000 });

  await page.locator('.ProseMirror img').click();
  await imageBubble(page).getByRole('button', { name: 'サムネイルに設定', exact: true }).click();

  // A hidden input reports its value regardless of the panel.
  const preview = page.locator('input[name="thumbnail"]');
  await expect(preview).toHaveValue(UPLOAD_SRC);
  await openPostSettings(page);
  await expect(page.getByText('指定した画像', { exact: true })).toBeVisible();
  await closePostSettings(page);

  const chosen = await preview.inputValue();
  await page.getByLabel('タイトル').fill('サムネイル指定');
  await expectAutosaved(page);

  // The round trip is the claim: a field missing from the FormData shows right and saves empty.
  await page.reload();
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await expect(page.locator('input[name="thumbnail"]')).toHaveValue(chosen);
});

// 解除 returns to the fallback, not to "no image". Two images, so the choice (second) differs from
// the fallback (first).
test('解除 drops back to the body’s first image', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();

  await page.locator('.ProseMirror').click();
  await page.getByTestId('image-picker').setInputFiles({
    name: 'e2e-body-1.png',
    mimeType: 'image/png',
    buffer: PNG_1x1,
  });
  await expect(page.locator('.ProseMirror img')).toHaveCount(1, { timeout: 20_000 });
  await clickPastLastImage(page);
  await page.getByTestId('image-picker').setInputFiles({
    name: 'e2e-body-2.png',
    mimeType: 'image/png',
    buffer: PNG_1x1_RED,
  });
  await expect(page.locator('.ProseMirror img')).toHaveCount(2, { timeout: 20_000 });
  const bodyImages = page.locator('.ProseMirror img');

  // Nothing chosen: the body's first image. Open the modal panel only for its checks.
  await openPostSettings(page);
  await expect(page.getByText('本文の最初の画像（自動）', { exact: true })).toBeVisible();
  await expect(page.locator('input[name="thumbnail"]')).toHaveValue('');
  await closePostSettings(page);

  await bodyImages.nth(1).click();
  await imageBubble(page).getByRole('button', { name: 'サムネイルに設定', exact: true }).click();
  await openPostSettings(page);
  await expect(page.getByText('指定した画像', { exact: true })).toBeVisible();
  const secondSrc = await bodyImages.nth(1).getAttribute('src');
  await expect(page.locator('input[name="thumbnail"]')).toHaveValue(secondSrc ?? '');

  // `exact`: the bubble's 「サムネイルを解除」 matches 「解除」 as a substring.
  await page.getByRole('button', { name: '解除', exact: true }).click();
  await expect(page.locator('input[name="thumbnail"]')).toHaveValue('');
  await expect(page.getByText('本文の最初の画像（自動）', { exact: true })).toBeVisible();
});

// A marked image is a body reference, so deleting it (the bubble's 削除, §22) falls back rather than
// leaving the column naming an image the post no longer shows.
test('deleting the marked image clears the thumbnail back to the fallback', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();

  await page.getByTestId('image-picker').setInputFiles({
    name: 'e2e-body-1.png',
    mimeType: 'image/png',
    buffer: PNG_1x1,
  });
  await expect(page.locator('.ProseMirror img')).toHaveCount(1, { timeout: 20_000 });
  await clickPastLastImage(page);
  await page.getByTestId('image-picker').setInputFiles({
    name: 'e2e-body-2.png',
    mimeType: 'image/png',
    buffer: PNG_1x1_RED,
  });
  await expect(page.locator('.ProseMirror img')).toHaveCount(2, { timeout: 20_000 });
  const bodyImages = page.locator('.ProseMirror img');

  await bodyImages.nth(1).click();
  await imageBubble(page).getByRole('button', { name: 'サムネイルに設定', exact: true }).click();
  // A hidden input reports its value regardless of the panel.
  await expect(page.locator('input[name="thumbnail"]')).not.toHaveValue('');

  await bodyImages.nth(1).click();
  await imageBubble(page).getByRole('button', { name: '削除' }).click();
  await expect(page.locator('.ProseMirror img')).toHaveCount(1);
  await expect(page.locator('input[name="thumbnail"]')).toHaveValue('');
  // The modal panel must be open for its status text.
  await openPostSettings(page);
  await expect(page.getByText('本文の最初の画像（自動）', { exact: true })).toBeVisible();
});

// A picker-chosen image is not in the body, so the stale-mark rule (§22) must react to an image
// disappearing, not to its absence. Red points under a bare absence check: the first edit after
// the pick, and the first after a reload (which forgets the route). The body's other image makes a
// cleared column show as the fallback.
test('a picked thumbnail outside the body survives body edits and a reload', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();

  await page.locator('.ProseMirror').click();
  await page.getByTestId('image-picker').setInputFiles({
    name: 'e2e-body-1.png',
    mimeType: 'image/png',
    buffer: PNG_1x1_RED,
  });
  await expect(page.locator('.ProseMirror img')).toHaveCount(1, { timeout: 20_000 });
  const bodySrc = await page.locator('.ProseMirror img').getAttribute('src');

  // ThumbnailField's picker is inside the panel, so it must be open.
  await openPostSettings(page);
  await page.getByTestId('thumbnail-picker').setInputFiles({
    name: 'e2e-card.png',
    mimeType: 'image/png',
    buffer: PNG_1x1,
  });
  const chosenField = page.locator('input[name="thumbnail"]');
  await expect(chosenField).toHaveValue(UPLOAD_SRC, { timeout: 20_000 });
  await expect(page.getByText('指定した画像', { exact: true })).toBeVisible();
  const chosen = await chosenField.inputValue();
  expect(chosen).not.toBe(bodySrc);
  await closePostSettings(page);

  // The body changes, the choice does not.
  await clickPastLastImage(page);
  await page.keyboard.type('本文を足す');
  await expect(page.locator('.ProseMirror')).toContainText('本文を足す');
  await expect(chosenField).toHaveValue(chosen);

  await page.getByLabel('タイトル').fill('別枠のサムネイル');
  await expectAutosaved(page);
  await page.reload();
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await expect(page.locator('input[name="thumbnail"]')).toHaveValue(chosen);

  // After the reload, only the path is known.
  await clickPastLastImage(page);
  await page.keyboard.type('もう一行');
  await expect(page.locator('.ProseMirror')).toContainText('もう一行');
  await expect(page.locator('input[name="thumbnail"]')).toHaveValue(chosen);
});

// The four published surfaces from one post, the second image chosen, so a surface reading the
// body's first would show.
test('an explicit thumbnail reaches the list, the admin list, the card and og:image', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await page.getByTestId('image-picker').setInputFiles({
    name: 'e2e-first.png',
    mimeType: 'image/png',
    buffer: PNG_1x1,
  });
  await expect(page.locator('.ProseMirror img')).toHaveCount(1, { timeout: 20_000 });
  await clickPastLastImage(page);
  await page.getByTestId('image-picker').setInputFiles({
    name: 'e2e-second.png',
    mimeType: 'image/png',
    buffer: PNG_1x1_RED,
  });
  await expect(page.locator('.ProseMirror img')).toHaveCount(2, { timeout: 20_000 });
  const bodyImages = page.locator('.ProseMirror img');
  const firstSrc = await bodyImages.nth(0).getAttribute('src');

  await bodyImages.nth(1).click();
  await imageBubble(page).getByRole('button', { name: 'サムネイルに設定', exact: true }).click();
  await expect(page.locator('input[name="thumbnail"]')).toHaveValue(UPLOAD_SRC);
  const chosen = await page.locator('input[name="thumbnail"]').inputValue();
  expect(chosen).not.toBe(firstSrc);
  // Let the thumbnail's autosave settle before publishing.
  await expectAutosaved(page);

  const href = await publish(page, 'サムネイル公開', '');
  const slug = href.slice('/posts/'.length);

  // og:image, absolute via metadataBase.
  await page.goto(href);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    'content',
    new RegExp(`${chosen}$`),
  );

  // The post list: the image is aria-hidden decoration, so located by src.
  await page.goto('/');
  await expect(page.locator(`article:has-text("サムネイル公開") img[src="${chosen}"]`)).toHaveCount(
    1,
  );

  // The admin list reads the same resolver; located by src, as above.
  await page.goto('/admin');
  await expect(page.locator(`li:has-text("サムネイル公開") img[src="${chosen}"]`)).toHaveCount(1);

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
  // Empty alt: the title is in the same anchor.
  await expect(card.locator('img.link-card-image')).toHaveAttribute('alt', '');

  // The stylesheet's box, not the file's: a 1x1 fixture makes a 256-wide box unmistakably the rule.
  // The height is pinned by meeting the border on three sides, not a number.
  const cardBox = (await card.boundingBox())!;
  const box = (await card.locator('img.link-card-image').boundingBox())!;
  expect(box.width).toBeCloseTo(256, 0);
  expect(box.height).toBeCloseTo(cardBox.height - 2, 0);
  expect(box.y - cardBox.y).toBeCloseTo(1, 0);
  expect(cardBox.x + cardBox.width - (box.x + box.width)).toBeCloseTo(1, 0);

  // The editor's card shows the same image in the same box (criterion 4f, §13); the only card in the
  // suite with an image, since seeded posts have none.
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, `<div class="link-card" data-href="/posts/${slug}"></div>\n\n本文\n`);

  // Wait on the attribute: the NodeView resolves after loadMarkdown returns.
  const editorImage = page.locator('.ProseMirror .link-card-view img.link-card-image');
  await expect(editorImage).toHaveAttribute('src', chosen, { timeout: 20_000 });
  await expect(editorImage).toHaveAttribute('alt', '');

  // That the shared `.prose .link-card-image` reaches a NodeView is the assumption measured.
  const editorCardBox = (await page.locator('.ProseMirror .link-card-view').boundingBox())!;
  const editorBox = (await editorImage.boundingBox())!;
  expect(editorBox.width).toBeCloseTo(256, 0);
  expect(editorBox.height).toBeCloseTo(editorCardBox.height - 2, 0);
  expect(editorBox.y - editorCardBox.y).toBeCloseTo(1, 0);
  expect(editorCardBox.x + editorCardBox.width - (editorBox.x + editorBox.width)).toBeCloseTo(1, 0);

  // Right of the text, as the reader sees it (§13).
  const textBox = await page.locator('.ProseMirror .link-card-body').boundingBox();
  expect(textBox).not.toBeNull();
  expect(editorBox!.x).toBeGreaterThan(textBox!.x);

  // A card drawn from the warm `postCache` must draw the same card, image included (§13); a title-only
  // cache branch fails only this. Cleared first: reloading identical source rebuilds no NodeView, so
  // the old DOM would pass whatever the code does.
  await loadMarkdown(page, '別の本文\n');
  await expect(page.locator('.ProseMirror .link-card-view')).toHaveCount(0);
  await loadMarkdown(page, `<div class="link-card" data-href="/posts/${slug}"></div>\n\n本文\n`);
  await expect(editorImage).toHaveAttribute('src', chosen);
});

// The published fallback: a picture with nothing chosen proves the list reads `resolveThumbnail`.
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

// No image anywhere (criteria 5f, 17b): the card gets the house mark, the list nothing (the mark is
// the card's furniture, §17). Both measured.
test('a post with no image anywhere gets the house mark on its card (17b)', async ({ page }) => {
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
  const card = page.locator('.prose a.link-card');
  await expect(card).toHaveCount(1);
  const image = card.locator('img.link-card-image');
  // The literal path: importing the constant would agree by construction.
  await expect(image).toHaveAttribute('src', '/link-card-placeholder.svg');
  await expect(image).toHaveClass(/link-card-placeholder/);
  await expect(image).toHaveAttribute('alt', '');
  // One file per scheme (§17.3): `currentSrc` says which `<source>` won.
  await expect
    .poll(async () => image.evaluate((el: HTMLImageElement) => el.currentSrc))
    .toContain('/link-card-placeholder.svg');
  await expect(card.locator('picture source')).toHaveAttribute(
    'srcset',
    '/link-card-placeholder-dark.svg',
  );

  // The same frame as a real picture: the card keeps one shape (§17).
  const cardBox = (await card.boundingBox())!;
  const box = (await image.boundingBox())!;
  expect(box.width).toBeCloseTo(256, 0);
  expect(box.height).toBeCloseTo(cardBox.height - 2, 0);
  expect(box.y - cardBox.y).toBeCloseTo(1, 0);
  expect(cardBox.x + cardBox.width - (box.x + box.width)).toBeCloseTo(1, 0);

  // Fitted on its tint, not cropped: what the second class is for.
  expect(await image.evaluate((el) => getComputedStyle(el).objectFit)).toBe('contain');
  expect(await image.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
    'rgba(0, 0, 0, 0)',
  );
  // The file arrived: a 404 leaves box, class and src as asserted.
  await expect
    .poll(async () => image.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);

  // The text column exists either way.
  await expect(card.locator('.link-card-text')).toHaveCount(1);
});
