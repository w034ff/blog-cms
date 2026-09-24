import { test, expect } from '@playwright/test';
import { expectAutosaved, expectPublished, ensureCategory } from './editor-authoring';
import { gotoPublished } from './published-post';

// End-to-end over the *public* render path (which no other spec touches): author a
// `> [!CAUTION]` callout in the editor, publish it, then open the public post and
// confirm the alert renders as a titled callout with its icon. This guards the
// whole chain — the Callout node's markdown (`> [!CAUTION]`) → remark transform →
// sanitize → the icon CSS in globals.css.
test('a published [!CAUTION] callout renders with title + icon on the public page', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await page.getByLabel('タイトル').fill('Public callout spec');
  await editor.click();
  // `> [!CAUTION]` + Enter commits the marker into a callout node with the caret already in
  // the body (the Enter is the trigger, consumed by the conversion), then type the content.
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

  // The icon is a masked SVG tinted to the caution accent, drawn on the title's
  // ::before — assert both the mask (icon present) and the accent tint.
  const icon = await title.evaluate((el) => {
    const s = getComputedStyle(el, '::before');
    return { mask: s.maskImage || s.webkitMaskImage, bg: s.backgroundColor };
  });
  expect(icon.mask).toContain('svg');
  expect(icon.bg).toBe('rgb(154, 103, 0)'); // caution accent (#9a6700, amber after the warning/caution color swap), light theme
});
