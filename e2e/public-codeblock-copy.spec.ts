import { test, expect, type Page } from '@playwright/test';
import { expectAutosaved, expectPublished, ensureCategory } from './editor-authoring';
import { gotoPublished } from './published-post';

// The copy button (components/CodeCopyButtons.tsx): appears, says "Copied!", and keeps newlines
// (joined per line rather than textContent).
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

  await expectAutosaved(page);
  await ensureCategory(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);
  await gotoPublished(page);

  const button = page.locator('.code-copy-btn');
  await expect(button).toBeVisible(); // injected after mount
  await button.click();

  // "Copied!" appears to the left of the icon.
  await expect(button.locator('.code-copy-label')).toHaveText('Copied!');

  // Two lines, newline intact.
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain('const a = 1;\nconst b = 2;');
});

// An invisible `::before` halo enlarges the target past the visible box.
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

  await expectAutosaved(page);
  await ensureCategory(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);
  await gotoPublished(page);

  const button = page.locator('.code-copy-btn');
  await expect(button).toBeVisible();
  const box = (await button.boundingBox())!;
  // 2px outside, well inside the ~4px halo (its boundary would be sub-pixel flaky).
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
  await expectAutosaved(page);
  await ensureCategory(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);
  await gotoPublished(page);
  await expect(page.locator('.code-copy-btn')).toBeVisible();
}

// The opaque background matches what lies beneath (globals.css): the filename bar, the code, and a
// shared hover highlight, per scheme, so a restyle cannot bring back the faint patch. toHaveCSS
// retries past the 0.12s transition.
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
