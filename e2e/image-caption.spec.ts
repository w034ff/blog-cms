import { test, expect, type Page } from '@playwright/test';
import { expectAutosaved, expectPublished, ensureCategory } from './editor-authoring';
import { gotoPublished } from './published-post';

// The image caption (docs/cms-features.md「画像キャプション」): one rule in the editor
// (image-caption-extension.ts), another on the page (lib/rehype-image-caption.ts). Measured: that
// they agree, and the markdown round-trips; lib/render.test.ts pins the published rule.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function insertImage(page: Page): Promise<void> {
  await page.getByTestId('image-picker').setInputFiles({
    name: 'caption.png',
    mimeType: 'image/png',
    buffer: PNG_1x1,
  });
  await expect(page.locator('.ProseMirror img')).toHaveCount(1, { timeout: 20_000 });
  // Below the image, in TrailingNode's paragraph.
  await page.locator('.ProseMirror').click({ position: { x: 10, y: 400 } });
}

test('the editor marks an italic-only paragraph under an image as the caption', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await insertImage(page);

  await page.keyboard.press('Control+i');
  await page.keyboard.type('キャプション');

  const caption = page.locator('.ProseMirror p.image-caption');
  await expect(caption).toHaveText('キャプション');
  // Centred and upright: the italic mark is notation, so `.prose em`'s skew is removed.
  await expect(caption).toHaveCSS('text-align', 'center');
  await expect(caption.locator('em')).toHaveCSS('transform', 'none');

  // The two-paragraph form the published rule reads.
  await expect(page.locator('input[name="body"]')).toHaveValue(
    // No alt: a file name is not one (useImageUpload.ts).
    /!\[\]\(\/uploads\/[0-9a-f]+\.png\)\n\n\*キャプション\*$/,
  );
});

// The entry point, as note puts a field in its editor.
test('the bubble menu opens a caption, and returns to the same one', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('本文の段落。');
  await page.keyboard.press('Enter');
  await insertImage(page);

  const paragraphsBefore = await page.locator('.ProseMirror > p').count();
  await page.locator('.ProseMirror img').click();
  await page.locator('.image-bubble').getByRole('button', { name: 'キャプション' }).click();

  // **The caret is centred before any character**: an empty paragraph is not a caption, so without
  // the pending state the text would jump to the centre on the first key.
  const pending = page.locator('.ProseMirror > p').last();
  await expect(pending).toHaveClass(/image-caption/);
  await expect(pending).toHaveCSS('text-align', 'center');

  // The placeholder hangs off `data-empty` (`:empty` cannot match a textblock's trailing `<br>`) and
  // takes no height, or the caret would move.
  const placeholder = (): Promise<string> =>
    pending.evaluate((el) => getComputedStyle(el, '::before').content);
  expect(await placeholder()).toContain('キャプションを入力');
  const emptyHeight = (await pending.boundingBox())!.height;

  // Typing continues italic; TrailingNode's paragraph was reused.
  await page.keyboard.type('図1');
  await expect(page.locator('.ProseMirror p.image-caption')).toHaveText('図1');
  expect(await page.locator('.ProseMirror > p').count()).toBe(paragraphsBefore);
  // The placeholder goes with the first character, and the line height is unchanged.
  expect(await placeholder()).not.toContain('キャプションを入力');
  expect((await pending.boundingBox())!.height).toBe(emptyHeight);

  // **The paragraph click makes the next a single click**: prosemirror-view reads a press within
  // 500ms near the last as a double click (`now - view.input.lastClick.time < 500 && isNear(...)`),
  // and the portalled button never reaches `view.dom`. Pressing elsewhere fails `isNear`.
  await page.locator('.ProseMirror p').first().click();

  // Pressing again edits the existing caption: caret at its end, nothing changed.
  await page.locator('.ProseMirror img').click();
  await page.locator('.image-bubble').getByRole('button', { name: 'キャプション' }).click();
  await page.keyboard.type('の続き');
  await expect(page.locator('.ProseMirror p.image-caption')).toHaveText('図1の続き');
  await expect(page.locator('.ProseMirror p.image-caption')).toHaveCount(1);
  await expect(page.locator('input[name="body"]')).toHaveValue(/\n\n\*図1の続き\*$/);
});

test('the editor does not mark prose, or an emphasis with anything beside it', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await insertImage(page);

  // A plain landing is not the pending state, so no caption.
  await expect(page.locator('.ProseMirror p.image-caption')).toHaveCount(0);

  // Plain text under the image is a paragraph.
  await page.keyboard.type('ふつうの本文');
  await expect(page.locator('.ProseMirror p.image-caption')).toHaveCount(0);

  // Nor is emphasis sharing its paragraph (a general-sibling rule's mistake).
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await page.locator('.ProseMirror').click({ position: { x: 10, y: 400 } });
  await insertImage(page);
  await page.keyboard.type('この図は');
  await page.keyboard.press('Control+i');
  await page.keyboard.type('重要');
  await page.keyboard.press('Control+i');
  await page.keyboard.type('です');
  await expect(page.locator('.ProseMirror p')).toContainText('この図は重要です');
  await expect(page.locator('.ProseMirror p.image-caption')).toHaveCount(0);
});

// Picture bottom to caption top: the surfaces build it from different boxes, so it drifts first.
// **Both rects in one evaluate**: between two round trips the autosave line can grow and shift the
// page.
function captionGap(page: Page, imageSelector: string, captionSelector: string): Promise<number> {
  return page.evaluate(
    ({ imageSelector: img, captionSelector: cap }) => {
      const image = document.querySelector(img)?.getBoundingClientRect();
      const caption = document.querySelector(cap)?.getBoundingClientRect();
      if (!image || !caption) throw new Error('caption gap: element not laid out');
      return caption.y - image.bottom;
    },
    { imageSelector, captionSelector },
  );
}

test('the caption survives publish and reads the same on the public page', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('本文の段落。');
  await page.keyboard.press('Enter');
  await insertImage(page);
  await page.keyboard.press('Control+i');
  await page.keyboard.type('図1 キャプション');

  const editorGap = await captionGap(page, '.ProseMirror img', '.ProseMirror p.image-caption');

  await page.getByLabel('タイトル').fill('キャプション付きの画像');
  await expectAutosaved(page);
  await ensureCategory(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);
  await gotoPublished(page);

  const figcaption = page.locator('.prose figure.image-figure > figcaption');
  await expect(figcaption).toHaveText('図1 キャプション');
  await expect(page.locator('.prose figure.image-figure > img')).toBeVisible();
  await expect(figcaption).toHaveCSS('text-align', 'center');

  // note's choice over Zenn's: the body's colour, compared with a real paragraph.
  const bodyColor = await page
    .locator('.prose p')
    .first()
    .evaluate((el) => getComputedStyle(el).color);
  await expect(figcaption).toHaveCSS('color', bodyColor);
  // Smaller than the body, as note draws it.
  const [captionSize, paraSize] = await Promise.all([
    figcaption.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    page
      .locator('.prose p')
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ]);
  expect(captionSize).toBeLessThan(paraSize);

  // The same picture on both surfaces (docs/link-card-requirements.md §22.1): only a measurement keeps
  // the two boxes together.
  const publicGap = await captionGap(
    page,
    '.prose figure.image-figure > img',
    '.prose figure.image-figure > figcaption',
  );
  expect(
    Math.abs(publicGap - editorGap),
    `editor ${editorGap} vs public ${publicGap}`,
  ).toBeLessThan(2);
  // The chosen 8px, not the same wrong number twice.
  expect(Math.abs(publicGap - 8), `public gap ${publicGap}`).toBeLessThan(1);
});
