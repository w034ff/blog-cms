import { test, expect, type Page } from '@playwright/test';
import { loadMarkdown } from './editor-authoring';

// The post's card image, end to end: the editor's bubble menu, the column it writes, the
// body-derived fallback, and the four surfaces that show the result
// (docs/link-card-requirements.md §8.2).
//
// lib/thumbnail.test.ts measures `resolveThumbnail` as a pure function — a string in, a string out.
// What only exists in a browser is everything around it: whether clicking an image selects it as a
// NodeSelection the bubble menu shows for, whether the chosen path survives the trip through the
// form into the column (useAutosave reads the live form DOM, not React state, so a field that
// renders correctly can still save nothing), and whether the published pages read the resolver
// rather than the raw column.

// The bubble menu's own container class (ImageBubble.tsx), so its buttons are found within it
// rather than by a bare accessible name that another control could also answer to.
const imageBubble = (page: Page) => page.locator('.image-bubble');

// setImage replaces the current selection, and inserting an image leaves a NodeSelection on what
// it just placed (prosemirror-transform's replaceSelectionWith, for a node with no content to step
// into) — so a second upload right after the first would replace it rather than adding a second
// image. Clicking well below the image moves the caret into the trailing paragraph TrailingNode
// always keeps at the document's end, a plain TextSelection the next upload can insert beside.
async function clickPastLastImage(page: Page): Promise<void> {
  await page.locator('.ProseMirror').click({ position: { x: 10, y: 400 } });
}

const PNG_1x1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG_1x1 = Buffer.from(PNG_1x1_BASE64, 'base64');

// A second, differently-coloured 1x1 PNG — /api/uploads names files by the sha256 of their bytes
// (app/api/uploads/route.ts), so uploading PNG_1x1 twice under two different filenames would still
// land at the same path. The tests below need two images with two distinct src values.
const PNG_1x1_RED_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const PNG_1x1_RED = Buffer.from(PNG_1x1_RED_BASE64, 'base64');

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

// The explicit half. There are two routes to a choice — the bubble menu marks an image already in
// the body (ImageBubble.tsx), ThumbnailField's picker uploads one the body need not contain — and
// either way the chosen path has to reach the column through the hidden input, since that is what
// `new FormData(form)` sees.
test('the bubble menu sets an explicit thumbnail that survives a reload', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();

  // Nothing chosen and nothing in the body: the field says so rather than showing a stale box.
  await expect(page.getByText('未設定。本文に画像を入れると自動で使われます。')).toBeVisible();

  await page.getByTestId('image-picker').setInputFiles({
    name: 'e2e-thumb.png',
    mimeType: 'image/png',
    buffer: PNG_1x1,
  });
  await expect(page.locator('.ProseMirror img')).toBeVisible({ timeout: 20_000 });

  await page.locator('.ProseMirror img').click();
  await imageBubble(page).getByRole('button', { name: 'サムネイルに設定', exact: true }).click();

  const preview = page.locator('input[name="thumbnail"]');
  await expect(preview).toHaveValue(UPLOAD_SRC);
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
// field's label carries — and the reason the two states cannot share one message. Two images in
// the body, so the explicit choice (the second) actually differs from the fallback (the first) —
// with only one image the two states would look identical on screen.
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

  // With nothing chosen, the body's first image is already what the card would use.
  await expect(page.getByText('本文の最初の画像を自動で使用中。')).toBeVisible();
  await expect(page.locator('input[name="thumbnail"]')).toHaveValue('');

  await bodyImages.nth(1).click();
  await imageBubble(page).getByRole('button', { name: 'サムネイルに設定', exact: true }).click();
  await expect(page.getByText('この記事用に指定した画像です。')).toBeVisible();
  const secondSrc = await bodyImages.nth(1).getAttribute('src');
  await expect(page.locator('input[name="thumbnail"]')).toHaveValue(secondSrc ?? '');

  // `exact`, because the bubble menu's own toggle now reads 「サムネイルを解除」 when the image
  // it is on is the chosen one, and an accessible name matches by substring by default.
  await page.getByRole('button', { name: '解除', exact: true }).click();
  await expect(page.locator('input[name="thumbnail"]')).toHaveValue('');
  await expect(page.getByText('本文の最初の画像を自動で使用中。')).toBeVisible();
});

// A marked image is a body reference, not an independent choice — deleting it from the body (via
// the bubble menu's own 削除, the mobile-friendly path §22's design record argues for) has to drop
// the stale pointer back to the fallback, not leave the column naming an upload the post no longer
// shows.
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
  await expect(page.locator('input[name="thumbnail"]')).not.toHaveValue('');

  await bodyImages.nth(1).click();
  await imageBubble(page).getByRole('button', { name: '削除' }).click();
  await expect(page.locator('.ProseMirror img')).toHaveCount(1);
  await expect(page.locator('input[name="thumbnail"]')).toHaveValue('');
  await expect(page.getByText('本文の最初の画像を自動で使用中。')).toBeVisible();
});

// The other route, and the one thing that can quietly undo it. A picture chosen through
// ThumbnailField's picker is not in the body at all, so the rule that drops a stale marked image
// (§22) must not read its absence as staleness — the test is that the image DISAPPEARED from the
// body, not that it is missing from it.
//
// Two moments make this red under a bare absence check: the first body edit after the pick, and
// the first edit after a reload (where nothing records which route the stored path came from).
// The body carries a different image throughout, so a cleared column would show as the fallback
// rather than as an empty field that could be read either way.
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

  await page.getByTestId('thumbnail-picker').setInputFiles({
    name: 'e2e-card.png',
    mimeType: 'image/png',
    buffer: PNG_1x1,
  });
  const chosenField = page.locator('input[name="thumbnail"]');
  await expect(chosenField).toHaveValue(UPLOAD_SRC, { timeout: 20_000 });
  await expect(page.getByText('この記事用に指定した画像です。')).toBeVisible();
  const chosen = await chosenField.inputValue();
  expect(chosen).not.toBe(bodySrc);

  // The body changes and the choice does not.
  await clickPastLastImage(page);
  await page.keyboard.type('本文を足す');
  await expect(page.locator('.ProseMirror')).toContainText('本文を足す');
  await expect(chosenField).toHaveValue(chosen);

  await page.getByLabel('タイトル').fill('別枠のサムネイル');
  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await expect(page.locator('input[name="thumbnail"]')).toHaveValue(chosen);

  // The reload is where provenance is gone: the reopened post knows only the path.
  await clickPastLastImage(page);
  await page.keyboard.type('もう一行');
  await expect(page.locator('.ProseMirror')).toContainText('もう一行');
  await expect(page.locator('input[name="thumbnail"]')).toHaveValue(chosen);
});

// The published side, all four surfaces from one post. Two images in the body, and the second is
// the explicit choice — so if any surface fell back to the body's first image instead of reading
// the column, the mismatch would be visible rather than accidentally matching.
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
  // Let the autosave the thumbnail click armed settle before publish, so publish's own wait for
  // 保存済み isn't racing a save already in flight (the same separation test 1 above keeps).
  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });

  const href = await publish(page, 'サムネイル公開', '');
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

  // The admin post list, which reads the same resolver — so the row shows the picture the reader
  // gets. Located by src for the same reason as the row above: the image is decoration and carries
  // no accessible name.
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
  // Empty alt: the title is inside the same anchor, so a described image is read twice.
  await expect(card.locator('img.link-card-image')).toHaveAttribute('alt', '');

  // The box is the stylesheet's, not the file's. Uploads arrive at whatever size the author had,
  // and a card that sized itself to its picture would make a column of cards ragged — so this
  // measures the rendered box rather than trusting that the rule matched. The fixture is a 1x1
  // PNG, which makes the two outcomes unmistakable: a 256-wide box is the rule, 1x1 is no rule.
  //
  // The height is not a number any more. The picture runs the card's full height, so what pins it
  // is that it meets the border on three sides — a fixed number here would have to be recomputed
  // every time the text above it changes by a line.
  const cardBox = (await card.boundingBox())!;
  const box = (await card.locator('img.link-card-image').boundingBox())!;
  expect(box.width).toBeCloseTo(256, 0);
  expect(box.height).toBeCloseTo(cardBox.height - 2, 0);
  expect(box.y - cardBox.y).toBeCloseTo(1, 0);
  expect(cardBox.x + cardBox.width - (box.x + box.width)).toBeCloseTo(1, 0);

  // The editor's card shows the same image, in the same box (criterion 4f, §13). Measured from the
  // post just published rather than from a seeded one, because the seeded posts have no image at
  // all — this is the only place in the suite where a card in the editor has one to show.
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, `<div class="link-card" data-href="/posts/${slug}"></div>\n\n本文\n`);

  // The NodeView resolves over `/api/posts/search`, and loadMarkdown is back before that lands, so
  // the wait is on the attribute rather than on the element merely existing.
  const editorImage = page.locator('.ProseMirror .link-card-view img.link-card-image');
  await expect(editorImage).toHaveAttribute('src', chosen, { timeout: 20_000 });
  await expect(editorImage).toHaveAttribute('alt', '');

  // The new layout rule is `.link-card-view` becoming a flex row; that the shared
  // `.prose .link-card-image` reaches a NodeView it was not written for is the assumption worth
  // measuring. Same 1x1 fixture, so the same two outcomes are unmistakable.
  const editorCardBox = (await page.locator('.ProseMirror .link-card-view').boundingBox())!;
  const editorBox = (await editorImage.boundingBox())!;
  expect(editorBox.width).toBeCloseTo(256, 0);
  expect(editorBox.height).toBeCloseTo(editorCardBox.height - 2, 0);
  expect(editorBox.y - editorCardBox.y).toBeCloseTo(1, 0);
  expect(editorCardBox.x + editorCardBox.width - (editorBox.x + editorBox.width)).toBeCloseTo(1, 0);

  // Right of the text, not left: the editor teaching a layout the reader never sees is the one way
  // this change could make things worse (§13).
  const textBox = await page.locator('.ProseMirror .link-card-body').boundingBox();
  expect(textBox).not.toBeNull();
  expect(editorBox!.x).toBeGreaterThan(textBox!.x);

  // A card drawn from the cache draws the same card. Loading the same source again builds a fresh
  // NodeView for the same href, and `postCache` is warm by now, so the lookup is skipped and the
  // cached answer is all the card has to draw from. That path drawing less than the fetch's did —
  // the title but not the image — is the bug §13 fixes, and it is invisible on a first render.
  // Measured by reverting `draw` to a title-only cache branch: this assertion goes red, the ones
  // above stay green.
  // Cleared first on purpose: reloading identical source leaves ProseMirror's own diffing nothing
  // to redraw, so the NodeView is never rebuilt and the old DOM sits there passing the assertion
  // whatever the code does (measured — that version of this test passed against a card that could
  // not draw an image from the cache at all).
  await loadMarkdown(page, '別の本文\n');
  await expect(page.locator('.ProseMirror .link-card-view')).toHaveCount(0);
  await loadMarkdown(page, `<div class="link-card" data-href="/posts/${slug}"></div>\n\n本文\n`);
  await expect(editorImage).toHaveAttribute('src', chosen);
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
// anywhere (criteria 5f, 17b). The two surfaces answer differently on purpose — the list still
// shows nothing, because the mark is the card's furniture and not the list's (§17) — so this
// measures both rather than assuming they agree.
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
  // The literal path rather than the constant: what is measured here is that the file the card
  // asks for is the one this site serves, and importing the constant would make the assertion
  // agree with the code by construction.
  await expect(image).toHaveAttribute('src', '/link-card-placeholder.svg');
  await expect(image).toHaveClass(/link-card-placeholder/);
  await expect(image).toHaveAttribute('alt', '');
  // The mark has a file per colour scheme and the page chooses (§17.3). This context is the light
  // one, so what must actually be loaded is the light file — `currentSrc`, not `src`, since `src`
  // says nothing about which `<source>` won.
  await expect
    .poll(async () => image.evaluate((el: HTMLImageElement) => el.currentSrc))
    .toContain('/link-card-placeholder.svg');
  await expect(card.locator('picture source')).toHaveAttribute(
    'srcset',
    '/link-card-placeholder-dark.svg',
  );

  // The mark sits in the same frame a real picture would, meeting the border on three sides — the
  // point of §17 is that the card keeps one shape, not that it gains a second one.
  const cardBox = (await card.boundingBox())!;
  const box = (await image.boundingBox())!;
  expect(box.width).toBeCloseTo(256, 0);
  expect(box.height).toBeCloseTo(cardBox.height - 2, 0);
  expect(box.y - cardBox.y).toBeCloseTo(1, 0);
  expect(cardBox.x + cardBox.width - (box.x + box.width)).toBeCloseTo(1, 0);

  // Drawn to fit on its tint, not cropped to fill: that rule is the whole difference between
  // furniture and a photograph, and it is the reason the second class exists.
  expect(await image.evaluate((el) => getComputedStyle(el).objectFit)).toBe('contain');
  expect(await image.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
    'rgba(0, 0, 0, 0)',
  );
  // And the file actually arrived. A 404 leaves the box, the class and the src exactly as asserted
  // above and shows nothing at all, which is the failure this whole test would otherwise miss.
  await expect
    .poll(async () => image.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);

  // The text column is there either way, so the card's shape does not depend on having a picture.
  await expect(card.locator('.link-card-text')).toHaveCount(1);
});
