import { test, expect, type Page } from '@playwright/test';
import { expectAutosaved, expectPublished } from './editor-authoring';
import { gotoPublished } from './published-post';

// The image caption, on both surfaces (docs/cms-features.md「画像キャプション」).
//
// The convention is a pair of rules written against different material — a ProseMirror document in
// the editor (components/editor/image-caption-extension.ts), hast on the published page
// (lib/rehype-image-caption.ts) — so what has to be measured is that they agree, and that the
// markdown between them round-trips. lib/render.test.ts already pins the published rule as a pure
// function; none of the rest exists outside a browser.
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
  // Below the image, into the trailing paragraph TrailingNode keeps at the document's end.
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
  // Centred, and upright — the italic mark is the notation, not a request for a slant, so the
  // skew `.prose em` applies to every other emphasis is taken off here.
  await expect(caption).toHaveCSS('text-align', 'center');
  await expect(caption.locator('em')).toHaveCSS('transform', 'none');

  // The stored markdown is the two-paragraph form the published rule reads.
  await expect(page.locator('input[name="body"]')).toHaveValue(
    // An uploaded image carries no alt — the file name is not one (useImageUpload.ts).
    /!\[\]\(\/uploads\/[0-9a-f]+\.png\)\n\n\*キャプション\*$/,
  );
});

// The entry point. Without it the convention is only reachable by an author who already knows it —
// Zenn has no entry point either, but this is a WYSIWYG editor and note, whose look this borrows,
// puts a field in the editor.
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

  // **The caret is centred before a single character exists.** An empty paragraph is not a caption
  // by the rule the published side reads — it serializes to nothing — so without the pending case
  // the caret would sit at the left margin and the text would jump to the centre on the first
  // keystroke.
  const pending = page.locator('.ProseMirror > p').last();
  await expect(pending).toHaveClass(/image-caption/);
  await expect(pending).toHaveCSS('text-align', 'center');

  // And it says what it is. The copy hangs off `data-empty` because `:empty` cannot match a
  // ProseMirror textblock (it holds a trailing `<br>`), and it must not take vertical space — a
  // placeholder that pushed the line down would move the caret the button just placed.
  const placeholder = (): Promise<string> =>
    pending.evaluate((el) => getComputedStyle(el, '::before').content);
  expect(await placeholder()).toContain('キャプションを入力');
  const emptyHeight = (await pending.boundingBox())!.height;

  // The caret is in a caption, and typing continues italic without the author reaching for the
  // mark. TrailingNode's own empty paragraph was reused rather than pushed aside.
  await page.keyboard.type('図1');
  await expect(page.locator('.ProseMirror p.image-caption')).toHaveText('図1');
  expect(await page.locator('.ProseMirror > p').count()).toBe(paragraphsBefore);
  // The copy goes as soon as there is a caption, and the line was the same height without it.
  expect(await placeholder()).not.toContain('キャプションを入力');
  expect((await pending.boundingBox())!.height).toBe(emptyHeight);

  // **The click on the paragraph is what makes the next one a single click, and it is not a
  // hedge.** prosemirror-view's `handlers.mousedown` reads a press within 500ms of the previous one
  // at the same point as a double click (`now - view.input.lastClick.time < 500 && isNear(...)`),
  // and the button press in between never reaches `view.dom` — the menu is portalled to `<body>` —
  // so `lastClick` still holds the first press on this picture. Pressing the same pixel again
  // inside that window runs `handleDoubleClick` and rings nothing. Moving the press elsewhere first
  // fails `isNear` and settles it by position instead of by timing; a person reaching back to the
  // picture has done the same. (True of every button in this menu, and of double-pressing any
  // image — not this feature's.)
  await page.locator('.ProseMirror p').first().click();

  // Pressing it again edits the caption that exists instead of starting a second one: the caret
  // lands at its end, and nothing about the caption changes.
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

  // The empty paragraph the caret is already sitting in is not a caption either — the pending
  // state the button leaves behind needs italic to be pending, which a plain landing is not.
  await expect(page.locator('.ProseMirror p.image-caption')).toHaveCount(0);

  // Plain text under the image is a paragraph, not a caption.
  await page.keyboard.type('ふつうの本文');
  await expect(page.locator('.ProseMirror p.image-caption')).toHaveCount(0);

  // Neither is an emphasis that shares its paragraph — the shape a general-sibling rule takes by
  // mistake (Zenn's, measured 2026-09-08).
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

// The vertical distance from the picture's bottom edge to the caption's top edge. The two
// surfaces build that gap out of different boxes — a `<figcaption>` under a `<figure>` on the
// page, a decorated paragraph under `.image-block` in the editor — so it is the number most
// likely to drift apart while both sides still "look like a caption".
//
// **Both rects are read in one evaluate, and that is not tidiness.** Two `boundingBox()` calls are
// two round trips, and in the editor the autosave status line above the editor grows by a line
// while they are in flight — the second rect is then measured against a page that has shifted, and
// the gap reads 8px too wide (measured 2026-09-08: a stable `editor 16 vs public 8` that became 8
// as soon as anything delayed the pair). One evaluate takes both from the same layout.
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
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);
  await gotoPublished(page);

  const figcaption = page.locator('.prose figure.image-figure > figcaption');
  await expect(figcaption).toHaveText('図1 キャプション');
  await expect(page.locator('.prose figure.image-figure > img')).toBeVisible();
  await expect(figcaption).toHaveCSS('text-align', 'center');

  // note's decision, and the one thing that separates this look from Zenn's: the caption carries
  // the BODY's colour rather than a muted grey (measured 2026-09-08). Compared against a real
  // paragraph on the same page, so a change to either side shows up here.
  const bodyColor = await page
    .locator('.prose p')
    .first()
    .evaluate((el) => getComputedStyle(el).color);
  await expect(figcaption).toHaveCSS('color', bodyColor);
  // Smaller than the body, the way note draws it.
  const [captionSize, paraSize] = await Promise.all([
    figcaption.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    page
      .locator('.prose p')
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ]);
  expect(captionSize).toBeLessThan(paraSize);

  // Same picture on both surfaces (docs/link-card-requirements.md §22.1), measured rather than
  // argued: the editor's gap is built from `.image-block`'s box and the published one from the
  // figure's, so nothing but a measurement keeps them together.
  const publicGap = await captionGap(
    page,
    '.prose figure.image-figure > img',
    '.prose figure.image-figure > figcaption',
  );
  expect(
    Math.abs(publicGap - editorGap),
    `editor ${editorGap} vs public ${publicGap}`,
  ).toBeLessThan(2);
  // And it is the chosen 8px, not the same wrong number twice.
  expect(Math.abs(publicGap - 8), `public gap ${publicGap}`).toBeLessThan(1);
});
