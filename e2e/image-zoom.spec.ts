import { test, expect, type Page } from '@playwright/test';
import { expectAutosaved, expectPublished } from './editor-authoring';
import { publishedPath } from './published-post';

// Clicking a body image on a published post opens it full-window (docs/cms-features.md「画像の拡大」).
// Everything here needs a browser: the dialog lives in the top layer, the close paths are Escape,
// the backdrop and the history entry, and the scoping claim — that none of it reaches the editor —
// can only be checked by opening the editor.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const zoom = (page: Page) => page.locator('dialog.image-zoom');

// A computed colour's three channels on 0-255, whichever notation the engine chose:
// `rgb(255, 255, 255)` / `rgba(…)` carry 0-255 already, while Chrome serializes a `color-mix()`
// result as `color(srgb 1 1 1 / 0.8)` with 0-1 floats.
function channels(value: string): number[] {
  const numbers = (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  return value.startsWith('color(') ? numbers.map((n) => Math.round(n * 255)) : numbers;
}

// The alpha, or 1 when the notation carries none.
function alphaOf(value: string): number {
  const parts = value.match(/[\d.]+/g) ?? [];
  return parts.length > 3 ? Number(parts[3]) : 1;
}

// A published post whose body is a paragraph, a captioned image, and a paragraph.
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
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);
  return publishedPath(page);
}

test('a body image opens full-window and carries its caption', async ({ page }) => {
  const href = await publishWithImage(page, '図1 キャプション');
  await page.goto(href);

  // Offered on every author image, note's way — no test of whether the column shrinks it.
  const image = page.locator('#post-body figure.image-figure > img');
  await expect(image).toHaveCSS('cursor', 'zoom-in');
  // The dialog is built at mount and waits closed, so what is asserted before the click is that
  // it is not showing — not that it is absent.
  await expect(zoom(page)).toBeHidden();

  await image.click();
  await expect(zoom(page)).toBeVisible();
  // Modal, not just shown: `showModal()` is what brings Escape, the backdrop and the inert page.
  expect(await zoom(page).evaluate((el: HTMLDialogElement) => el.matches(':modal'))).toBe(true);
  // The caption travels with the picture, and names the dialog — an uploaded image has no alt to
  // do it (useImageUpload.ts).
  await expect(page.locator('.image-zoom-caption')).toHaveText('図1 キャプション');
  await expect(zoom(page)).toHaveAttribute('aria-label', '図1 キャプション');

  // The way out is on screen, and it is where the focus already is: `showModal()` takes the first
  // focusable child, which is why the button is built first.
  const closeButton = zoom(page).getByRole('button', { name: '閉じる' });
  await expect(closeButton).toBeVisible();
  await expect(closeButton).toBeFocused();
  await closeButton.click();
  await expect(zoom(page)).toBeHidden();

  await image.click();
  await expect(zoom(page)).toBeVisible();

  // The magnifier sits on the picture, and the picture is what closes it. The space around it
  // keeps the plain arrow even though a press there closes it too.
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

  // The empty space around the picture is the dialog's own box, so a press there is the backdrop.
  await image.click();
  await expect(zoom(page)).toBeVisible();
  await zoom(page).click({ position: { x: 4, y: 4 } });
  await expect(zoom(page)).toBeHidden();
  // Closing that way takes back the history entry opening pushed, so the reader is still on the
  // post — otherwise the next Back press would appear to do nothing.
  await expect(page).toHaveURL(new RegExp(`${href}$`));

  await image.click();
  await expect(zoom(page)).toBeVisible();
  await page.goBack();
  await expect(zoom(page)).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
});

test('the article does not scroll under the picture', async ({ page }) => {
  const href = await publishWithImage(page, '図1');
  // Short enough that the post certainly overflows it, which is what makes the control below real.
  await page.setViewportSize({ width: 1280, height: 400 });
  await page.goto(href);

  await page.locator('#post-body figure.image-figure > img').click();
  await expect(zoom(page)).toBeVisible();
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // The control: with the picture closed the same gesture does scroll, so the assertion above is
  // about the overlay and not about a page that could never move.
  await page.keyboard.press('Escape');
  await expect(zoom(page)).toBeHidden();
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});

// The wash is the page's own ground made translucent, which is what both sites do (measured
// 2026-09-08 with the scheme switched: note paints its body colour at .9, Zenn at .8 with a 2px
// blur). So the assertion is a relation — overlay follows page — rather than a colour literal, and
// it is checked in both schemes because a fixed light or dark value passes one and fails the other.
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
    // Same three channels as the page, and translucent — `color-mix(… 80%, transparent)`. The two
    // values arrive in different notations (`rgb(255, 255, 255)` against Chrome's serialization of
    // a mix, `color(srgb 1 1 1 / 0.8)`), so both are normalised to 0-255 before comparing.
    expect(channels(wash.background)).toEqual(channels(pageGround));
    expect(alphaOf(wash.background)).toBeCloseTo(0.8, 2);
    expect(wash.blur).toBe('blur(2px)');

    // And the chrome on top of it reads: the caption is the page's foreground, not a fixed light.
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
  // The scoping claim. `.prose` is shared by both surfaces, so a rule written there would follow
  // the editor, where a click on an image already means "select this node".
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
  // And the click still does what the editor means by it.
  await expect(page.locator('.image-bubble')).toBeVisible();
});
