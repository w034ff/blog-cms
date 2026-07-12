import { test, expect } from '@playwright/test';

// Drives the toolbar's callout-insert menu (CalloutMenu): open the dropdown, pick a
// type, and confirm it drops the canonical `> [!TYPE]` blockquote that the preview
// tints, that the cursor lands in the body (so the marker line survives and typing
// fills the body), and that it all round-trips to the stored markdown. Browser-only:
// the insert command, the tint decoration, and the markdown serialization only exist
// in the live editor.
test('the callout menu inserts a tinted [!NOTE] callout and the body round-trips', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');

  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  // Focus the editor first so the insert lands in the body, then open the menu and
  // pick 情報.
  await editor.click();
  await page.getByRole('button', { name: 'コールアウト' }).click();
  await page.getByRole('button', { name: '情報' }).click();

  // The inserted blockquote is tinted as a note callout by AlertHighlight.
  const quote = editor.locator('blockquote').first();
  await expect(quote).toHaveClass(/markdown-alert markdown-alert-note/);
  // The marker sits alone on the first line.
  await expect(quote.locator('p').first()).toHaveText('[!NOTE]');

  // The cursor was left in the empty body paragraph, so typing (no extra click)
  // fills the body — not the marker line.
  await page.keyboard.type('補足の説明です。');
  await expect(quote).toContainText('補足の説明です。');
  await expect(quote.locator('p').first()).toHaveText('[!NOTE]');

  // The whole thing round-trips to the stored markdown (mirrored into the hidden
  // body input). Markdown escapes the marker's brackets (`\[!NOTE\]`), so compare
  // with the backslashes stripped.
  const body = (await page.locator('input[name="body"]').inputValue()).replace(/\\/g, '');
  expect(body).toContain('> [!NOTE]');
  expect(body).toContain('> 補足の説明です。');
});

// The other two tiers wire the same way — assert each menu choice inserts a
// blockquote carrying the matching marker + tint class.
for (const { label, marker, cls } of [
  { label: '警告', marker: '[!WARNING]', cls: 'markdown-alert-warning' },
  { label: '注意', marker: '[!CAUTION]', cls: 'markdown-alert-caution' },
] as const) {
  test(`the callout menu inserts a ${marker} callout`, async ({ page }) => {
    await page.goto('/admin/posts/new');

    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();

    await editor.click();
    await page.getByRole('button', { name: 'コールアウト' }).click();
    await page.getByRole('button', { name: label, exact: true }).click();

    const quote = editor.locator('blockquote').first();
    await expect(quote).toHaveClass(new RegExp(`markdown-alert ${cls}`));
    await expect(quote.locator('p').first()).toHaveText(marker);
  });
}
