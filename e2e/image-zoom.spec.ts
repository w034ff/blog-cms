import { test, expect, type Page } from '@playwright/test';
import { expectAutosaved, expectPublished, ensureCategory } from './editor-authoring';
import { publishedPath } from './published-post';

// A body image opens full-window on click (docs/cms-features.md「画像の拡大」): top layer, Escape,
// backdrop, history, and not in the editor.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const zoom = (page: Page) => page.locator('dialog.image-zoom');

// A colour's channels on 0-255: `rgb(…)` already is, Chrome's `color(srgb 1 1 1 / 0.8)` is 0-1.
function channels(value: string): number[] {
  const numbers = (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  return value.startsWith('color(') ? numbers.map((n) => Math.round(n * 255)) : numbers;
}

// The alpha, or 1.
function alphaOf(value: string): number {
  const parts = value.match(/[\d.]+/g) ?? [];
  return parts.length > 3 ? Number(parts[3]) : 1;
}

// Paragraph, captioned image, paragraph.
async function publishWithImage(page: Page, caption: string): Promise<string> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('本文の段落。');
  await page.keyboard.press('Enter');
  await page.getByTestId('image-picker').setInputFiles({
    name: 'zoom.png',
    mimeType: 'image/png',
    buffer: PNG_1x1,
  });
  await expect(page.locator('.ProseMirror img')).toHaveCount(1, { timeout: 20_000 });
  await page.locator('.ProseMirror').click({ position: { x: 10, y: 400 } });
  if (caption !== '') {
    await page.keyboard.press('Control+i');
    await page.keyboard.type(caption);
  }

  await page.getByLabel('タイトル').fill('拡大できる画像');
  await expectAutosaved(page);
  await ensureCategory(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);
  return publishedPath(page);
}

test('a body image opens full-window and carries its caption', async ({ page }) => {
  const href = await publishWithImage(page, '図1 キャプション');
  await page.goto(href);

  // Every author image, as note does.
  const image = page.locator('#post-body figure.image-figure > img');
  await expect(image).toHaveCSS('cursor', 'zoom-in');
  // Built at mount and closed: not showing, not absent.
  await expect(zoom(page)).toBeHidden();

  await image.click();
  await expect(zoom(page)).toBeVisible();
  // Modal: `showModal()` brings Escape, backdrop and inertness.
  expect(await zoom(page).evaluate((el: HTMLDialogElement) => el.matches(':modal'))).toBe(true);
  // The caption names the dialog; uploads have no alt (useImageUpload.ts).
  await expect(page.locator('.image-zoom-caption')).toHaveText('図1 キャプション');
  await expect(zoom(page)).toHaveAttribute('aria-label', '図1 キャプション');

  // Focus starts on the close button: `showModal()` focuses the first focusable child.
  const closeButton = zoom(page).getByRole('button', { name: '閉じる' });
  await expect(closeButton).toBeVisible();
  await expect(closeButton).toBeFocused();
  await closeButton.click();
  await expect(zoom(page)).toBeHidden();

  await image.click();
  await expect(zoom(page)).toBeVisible();

  // The magnifier is on the picture, which closes it; the space around keeps the arrow.
  await expect(zoom(page).locator('img')).toHaveCSS('cursor', 'zoom-out');
  await expect(zoom(page)).toHaveCSS('cursor', 'auto');
  await zoom(page).locator('img').click();
  await expect(zoom(page)).toBeHidden();

  await image.click();
  await expect(zoom(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(zoom(page)).toBeHidden();
});

test('the backdrop and the back button both close it', async ({ page }) => {
  const href = await publishWithImage(page, '図1');
  await page.goto(href);
  const image = page.locator('#post-body figure.image-figure > img');

  // Around the picture is the dialog's own box: the backdrop.
  await image.click();
  await expect(zoom(page)).toBeVisible();
  await zoom(page).click({ position: { x: 4, y: 4 } });
  await expect(zoom(page)).toBeHidden();
  // Closing pops the pushed history entry, or the next Back would seem dead.
  await expect(page).toHaveURL(new RegExp(`${href}$`));

  await image.click();
  await expect(zoom(page)).toBeVisible();
  await page.goBack();
  await expect(zoom(page)).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
});

test('the article does not scroll under the picture', async ({ page }) => {
  const href = await publishWithImage(page, '図1');
  // The post overflows, so the control is real.
  await page.setViewportSize({ width: 1280, height: 400 });
  await page.goto(href);

  await page.locator('#post-body figure.image-figure > img').click();
  await expect(zoom(page)).toBeVisible();
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // Control: closed, the same gesture scrolls.
  await page.keyboard.press('Escape');
  await expect(zoom(page)).toBeHidden();
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});

// The wash is the page's own ground, translucent: a relation, in both schemes, since a fixed
// value passes one.
for (const scheme of ['light', 'dark'] as const) {
  test(`the overlay takes the page's own ground (${scheme})`, async ({ page }) => {
    const href = await publishWithImage(page, '図1');
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(href);

    const pageGround = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.locator('#post-body figure.image-figure > img').click();
    await expect(zoom(page)).toBeVisible();

    const wash = await zoom(page).evaluate((el) => ({
      background: getComputedStyle(el).backgroundColor,
      blur: getComputedStyle(el).backdropFilter,
    }));
    // The page's channels at `color-mix(… 80%, transparent)`, both normalized to 0-255.
    expect(channels(wash.background)).toEqual(channels(pageGround));
    expect(alphaOf(wash.background)).toBeCloseTo(0.8, 2);
    expect(wash.blur).toBe('blur(2px)');

    // The caption is the page's foreground.
    const foreground = await page.evaluate(() => getComputedStyle(document.body).color);
    await expect(page.locator('.image-zoom-caption')).toHaveCSS('color', foreground);
  });
}

test('an uncaptioned image opens with the fallback name and no caption line', async ({ page }) => {
  const href = await publishWithImage(page, '');
  await page.goto(href);
  await page.locator('#post-body img').first().click();
  await expect(zoom(page)).toBeVisible();
  await expect(zoom(page)).toHaveAttribute('aria-label', '画像');
  await expect(page.locator('.image-zoom-caption')).toBeHidden();
});

test('the editor is untouched: no zoom cursor, no dialog', async ({ page }) => {
  // The scoping claim: `.prose` is shared, and in the editor a click selects the image.
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await page.getByTestId('image-picker').setInputFiles({
    name: 'zoom.png',
    mimeType: 'image/png',
    buffer: PNG_1x1,
  });
  const image = page.locator('.ProseMirror img');
  await expect(image).toHaveCount(1, { timeout: 20_000 });

  await expect(image).not.toHaveCSS('cursor', 'zoom-in');
  await image.click();
  await expect(zoom(page)).toHaveCount(0);
  // The click still selects.
  await expect(page.locator('.image-bubble')).toBeVisible();
});
