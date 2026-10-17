import { test, expect, type Page } from '@playwright/test';
import {
  addTag,
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

async function publish(
  page: Page,
  title: string,
  source: string,
  options: { category?: string; tag?: string } = {},
): Promise<string> {
  await page.getByLabel('タイトル').fill(title);
  if (source !== '') await loadMarkdown(page, source);
  if (options.category || options.tag) {
    await openPostSettings(page);
    if (options.category) await page.getByRole('radio', { name: options.category }).check();
    if (options.tag) await addTag(page, options.tag);
    await closePostSettings(page);
  }
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

// What `var(--category-…)` resolves to in this page's scheme, as the `rgb()` string a computed `fill`
// reports: a probe element, so the test reads the token rather than copying its hex.
async function tokenColour(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, token);
}

// The list row's frame of a post by title, and what is drawn in it.
function rowFrame(page: Page, title: string) {
  return page.locator(`article:has-text("${title}") .category-art`);
}

// No image anywhere (docs/category-mark-requirements.md §3, CM-5/CM-6): the row is drawn as the
// site's mark in the category's colour, in the frame a photo would have.
for (const { label, category } of [
  { label: '技術記事', category: 'tech' },
  { label: 'ブログ', category: 'blog' },
]) {
  test(`a ${category} post with no image gets a ${category}-coloured mark in the list (CM-5, CM-6)`, async ({
    page,
  }) => {
    await page.goto('/admin/posts/new');
    await expect(page.locator('.ProseMirror')).toBeVisible();
    const title = `画像なしの${category}記事 ${Date.now()}`;
    await publish(page, title, '文字だけの本文。\n', { category: label });

    await page.goto('/');
    const frame = rowFrame(page, title);
    await expect(frame).toHaveCount(1);
    await expect(frame).toHaveAttribute('data-category', category);

    // The same frame a photo has (160×96 at this width), and a mark that has a size: an `<svg>`
    // built without one is 0×0 and invisible (docs/editor-pitfalls.md §3.2), which no attribute
    // assertion notices.
    const frameBox = (await frame.boundingBox())!;
    expect(frameBox.width).toBeCloseTo(160, 0);
    expect(frameBox.height).toBeCloseTo(96, 0);
    const svgBox = (await frame.locator('svg').boundingBox())!;
    expect(svgBox.height).toBeGreaterThan(0);
    // 40% of the frame's content box, inside its 1px border.
    expect(svgBox.height).toBeCloseTo((96 - 2) * 0.4, 0);
    expect(svgBox.width).toBeCloseTo(svgBox.height, 0);

    // The tile is the category's colour in this scheme; the glyph knocks out to the surface.
    expect(
      await frame.locator('.category-art-tile').evaluate((el) => getComputedStyle(el).fill),
    ).toBe(await tokenColour(page, `--category-${category}`));
  });
}

// CM-5's other half: a post with an image keeps its photo and gets no mark.
test('a post with an image keeps its photo in the list (CM-5)', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await page.getByTestId('image-picker').setInputFiles({
    name: 'e2e-list-photo.png',
    mimeType: 'image/png',
    buffer: PNG_1x1,
  });
  await expect(page.locator('.ProseMirror img')).toBeVisible({ timeout: 20_000 });
  const title = `写真つきの記事 ${Date.now()}`;
  await publish(page, title, '');

  await page.goto('/');
  const row = page.locator(`article:has-text("${title}")`);
  await expect(row.locator('img')).toHaveCount(1);
  await expect(row.locator('.category-art')).toHaveCount(0);
  const box = (await row.locator('img').boundingBox())!;
  expect(box.width).toBeCloseTo(160, 0);
  expect(box.height).toBeCloseTo(96, 0);
});

// CM-8 / CM-9: below `sm` the row keeps title, date, category and picture, and the picture's frame is
// 128×80; from `sm` the excerpt and tags are back and the frame is 160×96 (§5).
const NARROW = { width: 360, height: 800 };
const WIDE = { width: 1280, height: 800 };

async function publishRowWithExcerptAndTag(page: Page): Promise<string> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  const title = `行の中身 ${Date.now()}`;
  await publish(page, title, '一覧の説明文になる本文。\n', { tag: `t${Date.now()}` });
  return title;
}

test('a narrow viewport drops the excerpt and tags and keeps the 128×80 frame (CM-8)', async ({
  page,
}) => {
  const title = await publishRowWithExcerptAndTag(page);

  await page.setViewportSize(NARROW);
  await page.goto('/');
  const row = page.locator(`article:has-text("${title}")`);
  // Hidden by CSS, not removed: the row still holds them for assistive tech and crawlers (§5).
  await expect(row.locator('p')).toHaveCount(1);
  await expect(row.locator('p')).toBeHidden();
  await expect(row.locator('ul')).toBeHidden();
  await expect(row.locator('h2')).toBeVisible();
  await expect(row.locator('time')).toBeVisible();

  const box = (await row.locator('.category-art').boundingBox())!;
  expect(box.width).toBeCloseTo(128, 0);
  expect(box.height).toBeCloseTo(80, 0);
  // 40% of the frame's content box inside its 1px border: 31.2px, the "32px" of §3.2.
  expect((await row.locator('.category-art svg').boundingBox())!.height).toBeCloseTo(31.2, 0);
});

test('a wide viewport keeps the excerpt and tags (CM-9)', async ({ page }) => {
  const title = await publishRowWithExcerptAndTag(page);

  await page.setViewportSize(WIDE);
  await page.goto('/');
  const row = page.locator(`article:has-text("${title}")`);
  await expect(row.locator('p')).toBeVisible();
  await expect(row.locator('ul')).toBeVisible();
  // `line-clamp-2` sets `display: -webkit-box`, which this Chrome reports as `flow-root`; a later
  // `display: block` (`sm:block`) would leave the two-line cut to Chrome's leniency, and browsers
  // that need the box would not cut at all.
  await expect(row.locator('p')).not.toHaveCSS('display', 'block');
  const box = (await row.locator('.category-art').boundingBox())!;
  expect(box.width).toBeCloseTo(160, 0);
  expect(box.height).toBeCloseTo(96, 0);
});

// The published card for a post with no image: the same mark in the card's frame (CM-6). Its
// geometry is measured in public-link-card.spec.ts. The mark replaces a file, so `naturalWidth` is
// gone: what the old check guarded (a 404 leaves box, class and src as asserted) is now whether the
// `<svg>` has a size.
test('a card to a post with no image draws the mark inline (CM-6)', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  const href = await publish(page, `画像なしの記事 ${Date.now()}`, '文字だけの本文。\n');
  const slug = href.slice('/posts/'.length);

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
  const mark = card.locator('.link-card-image.category-art');
  await expect(mark).toHaveCount(1);
  await expect(mark).toHaveAttribute('data-category', /^(tech|blog)$/);
  await expect(card.locator('img')).toHaveCount(0);
  const svgBox = (await mark.locator('svg').boundingBox())!;
  expect(svgBox.width).toBeGreaterThan(0);
  expect(svgBox.height).toBeGreaterThan(0);
  // The text column exists either way.
  await expect(card.locator('.link-card-text')).toHaveCount(1);
});
