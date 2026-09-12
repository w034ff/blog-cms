import { test, expect, type Page } from '@playwright/test';
import { expectPublished } from './editor-authoring';
import { gotoPublished } from './published-post';

// The copy button is injected client-side (components/CodeCopyButtons.tsx) into each code block
// on the public post page. Guards: the button appears, shows "Copied!" feedback, and copies the
// code with its NEWLINES preserved (the reason we join per-line text rather than use textContent).
test('the public code block copy button copies the code with newlines', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await page.getByLabel('タイトル').fill('Copy button spec');
  await editor.click();
  await page.keyboard.type('```ts ');
  await page.keyboard.type('const a = 1;');
  await page.keyboard.press('Enter');
  await page.keyboard.type('const b = 2;');

  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);
  await gotoPublished(page);

  const button = page.locator('.code-copy-btn');
  await expect(button).toBeVisible(); // injected after mount
  await button.click();

  // "Copied!" appears to the left of the icon.
  await expect(button.locator('.code-copy-label')).toHaveText('Copied!');

  // The clipboard holds the two lines with their newline intact (not collapsed to one line).
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain('const a = 1;\nconst b = 2;');
});

// The button carries an invisible `::before` halo that enlarges the tap target past its visible
// box. Guard it: a click just OUTSIDE the visible button still triggers a copy.
test('a click just outside the visible copy button still copies (enlarged hit area)', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await page.getByLabel('タイトル').fill('Copy hit-area spec');
  await editor.click();
  await page.keyboard.type('```ts ');
  await page.keyboard.type('const a = 1;');

  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);
  await gotoPublished(page);

  const button = page.locator('.code-copy-btn');
  await expect(button).toBeVisible();
  const box = (await button.boundingBox())!;
  // 2px left of the left edge — outside the visible box but comfortably inside the -0.25rem
  // (~4px) halo (clicking at the ~4px boundary itself would be sub-pixel flaky).
  await page.mouse.click(box.x - 2, box.y + box.height / 2);
  await expect(button.locator('.code-copy-label')).toHaveText('Copied!');
});

async function publishCodeBlock(page: Page, withFilename: boolean) {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await page.getByLabel('タイトル').fill('Copy button background spec');
  await editor.click();
  await page.keyboard.type('```ts ');
  await page.keyboard.type('const x = 1;');
  if (withFilename) {
    const block = editor.locator('.code-block');
    await block.hover();
    await block.locator('.code-block-filename').fill('index.ts');
    await block.locator('.code-block-filename').blur();
  }
  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);
  await gotoPublished(page);
  await expect(page.locator('.code-copy-btn')).toBeVisible();
}

// The button's OPAQUE background is meant to sit seamlessly on whatever is directly beneath it,
// so it reads as part of the block rather than a chip floating over the code (globals.css):
//   - with a filename bar, the button overlaps the bar → match the bar's shade
//   - without one, it overlaps the code area           → match the code's shade
//   - on hover, both cases brighten to the same highlight
// Each scheme has its own trio of shades; the assertions pin them so a restyle can't silently
// reintroduce the "faint patch" this seamless-masking was added to remove.
//
// toHaveCSS auto-retries, so it rides out the 0.12s background transition — a one-shot
// getComputedStyle read right after hover() would catch the pre-transition (rest) color.
for (const scheme of ['dark', 'light'] as const) {
  const shades =
    scheme === 'dark'
      ? { bar: 'rgb(28, 33, 40)', code: 'rgb(22, 27, 34)', hover: 'rgb(48, 54, 61)' } // #1c2128 / #161b22 / #30363d
      : { bar: 'rgb(234, 238, 242)', code: 'rgb(246, 248, 250)', hover: 'rgb(223, 227, 232)' }; // #eaeef2 / #f6f8fa / #dfe3e8

  test.describe(`the ${scheme}-scheme copy button background stays seamless with the block`, () => {
    test.use({ colorScheme: scheme });

    test('with a filename bar: rest matches the bar, hover highlights', async ({ page }) => {
      await publishCodeBlock(page, true);
      const button = page.locator('.code-copy-btn');
      await page.mouse.move(0, 0); // ensure not hovering
      await expect(button).toHaveCSS('background-color', shades.bar); // rest = filename bar
      await button.hover();
      await expect(button).toHaveCSS('background-color', shades.hover);
    });

    test('without a filename: rest matches the code area, hover highlights', async ({ page }) => {
      await publishCodeBlock(page, false);
      const button = page.locator('.code-copy-btn');
      await page.mouse.move(0, 0); // ensure not hovering
      await expect(button).toHaveCSS('background-color', shades.code); // rest = code area
      await button.hover();
      await expect(button).toHaveCSS('background-color', shades.hover);
    });
  });
}
