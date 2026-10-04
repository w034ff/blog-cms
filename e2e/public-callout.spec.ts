import { test, expect } from '@playwright/test';
import { expectAutosaved, expectPublished, ensureCategory } from './editor-authoring';
import { gotoPublished } from './published-post';

// The public render path end to end: the Callout's `> [!CAUTION]` → remark transform → sanitize →
// the icon CSS in globals.css.
test('a published [!CAUTION] callout renders with title + icon on the public page', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await page.getByLabel('タイトル').fill('Public callout spec');
  await editor.click();
  // Enter commits the marker (consumed), leaving the caret in the body.
  await page.keyboard.type('> [!CAUTION]');
  await page.keyboard.press('Enter');
  await page.keyboard.type('破壊的操作の前に確認してください。');

  await expectAutosaved(page);
  await ensureCategory(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);

  await gotoPublished(page);

  // Rendered as a div callout (not a blockquote), marker stripped, title present.
  const alert = page.locator('.markdown-alert.markdown-alert-caution');
  await expect(alert).toBeVisible();
  const title = alert.locator('.markdown-alert-title');
  await expect(title).toHaveText('注意');
  await expect(alert).not.toContainText('[!CAUTION]');

  // 2-column layout: the container is a flex row and the body sits in its own
  // content column beside the icon.
  const display = await alert.evaluate((el) => getComputedStyle(el).display);
  expect(display).toBe('flex');
  await expect(alert.locator('.markdown-alert-content')).toContainText(
    '破壊的操作の前に確認してください。',
  );

  // A masked SVG on the title's ::before, tinted to the accent: both asserted.
  const icon = await title.evaluate((el) => {
    const s = getComputedStyle(el, '::before');
    return { mask: s.maskImage || s.webkitMaskImage, bg: s.backgroundColor };
  });
  expect(icon.mask).toContain('svg');
  expect(icon.bg).toBe('rgb(154, 103, 0)'); // caution accent (#9a6700, amber after the warning/caution color swap), light theme
});
