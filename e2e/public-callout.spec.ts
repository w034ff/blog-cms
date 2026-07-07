import { test, expect } from '@playwright/test';

// End-to-end over the *public* render path (which no other spec touches): author a
// `> [!CAUTION]` callout in the editor, publish it, then open the public post and
// confirm the alert renders as a titled callout with its icon. This guards the
// whole chain — editor markdown (escaped `\[!CAUTION\]`) → remark transform →
// sanitize → the icon CSS in globals.css.
test('a published [!CAUTION] callout renders with title + icon on the public page', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await page.getByLabel('タイトル').fill('Public callout spec');
  await editor.click();
  await page.keyboard.type('> [!CAUTION]');
  await page.keyboard.press('Enter');
  await page.keyboard.type('破壊的操作の前に確認してください。');

  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '投稿' }).click();
  await expect(page.getByText('公開済み（最新）')).toBeVisible({ timeout: 20_000 });

  const href = await page.getByRole('link', { name: '表示' }).getAttribute('href');
  expect(href).toMatch(/^\/posts\/[0-9a-f]+$/);
  await page.goto(href!);

  // Rendered as a div callout (not a blockquote), marker stripped, title present.
  const alert = page.locator('.markdown-alert.markdown-alert-caution');
  await expect(alert).toBeVisible();
  const title = alert.locator('.markdown-alert-title');
  await expect(title).toHaveText('注意');
  await expect(alert).not.toContainText('[!CAUTION]');

  // The icon is a masked SVG tinted to the caution accent, drawn on the title's
  // ::before — assert both the mask (icon present) and the accent tint.
  const icon = await title.evaluate((el) => {
    const s = getComputedStyle(el, '::before');
    return { mask: s.maskImage || s.webkitMaskImage, bg: s.backgroundColor };
  });
  expect(icon.mask).toContain('svg');
  expect(icon.bg).toBe('rgb(207, 34, 46)'); // caution accent (#cf222e), light theme
});
