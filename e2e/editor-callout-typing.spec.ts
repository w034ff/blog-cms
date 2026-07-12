import { test, expect } from '@playwright/test';

// The Callout node upgrades a hand-typed `> [!WARNING]` blockquote into a real callout
// node (components/editor/callout-extension.ts): the marker becomes a non-editable label
// chip and only the body stays editable, so it can't be broken by typing after the `]`.
// Browser-only — the auto-convert plugin and the NodeView only exist in the live editor.
test('typing `> [!WARNING]` upgrades the blockquote to a protected callout node', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  await page.keyboard.type('> [!WARNING]');

  // The blockquote became a callout <div> (not a <blockquote>), tinted for the type.
  const callout = editor.locator('div.markdown-alert.markdown-alert-warning');
  await expect(callout).toBeVisible();
  await expect(editor.locator('blockquote')).toHaveCount(0);
  // The type shows as the non-editable label chip (screen-reader text), not the marker.
  await expect(callout.locator('.markdown-alert-title-label')).toHaveText('警告');

  // The caret was left in the body, so typing (no extra key) fills the body, and the
  // `[!WARNING]` marker never exists as editable text.
  await page.keyboard.type('注意事項です。');
  await expect(callout.locator('.markdown-alert-content')).toContainText('注意事項です。');
  await expect(editor).not.toContainText('[!WARNING]');
  // Still a callout after typing — the marker can't be corrupted into a plain quote.
  await expect(callout).toBeVisible();
});

test('an ordinary blockquote is left as a plain quote', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.keyboard.type('> ただの引用です。');

  const quote = editor.locator('blockquote').first();
  await expect(quote).toBeVisible();
  await expect(quote).not.toHaveClass(/markdown-alert/);
  await expect(editor.locator('div.markdown-alert')).toHaveCount(0);
});
