import { test, expect } from '@playwright/test';

// The `/` slash menu (components/editor/callout-slash-command.ts) is built on the official
// @tiptap/suggestion utility with a custom popup (CalloutSlashList). Browser-only: the
// suggestion trigger, the floating popup, and the setCallout command only run in the editor.
test('the slash menu opens on `/` and inserts the chosen callout', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  await page.keyboard.type('/');
  const menu = page.locator('[data-callout-slash]');
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('情報');
  await expect(menu).toContainText('警告');
  await expect(menu).toContainText('注意');

  // Choosing 警告 inserts a warning callout and removes the typed `/`.
  await menu.getByRole('button', { name: '警告' }).click();
  await expect(editor.locator('div.markdown-alert.markdown-alert-warning')).toBeVisible();
  await expect(editor).not.toContainText('/');
});

test('the slash menu filters by query and inserts with Enter', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  // `danger` is the keyword for 警告 only.
  await page.keyboard.type('/danger');
  const menu = page.locator('[data-callout-slash]');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button')).toHaveCount(1);
  await expect(menu).toContainText('警告');

  await page.keyboard.press('Enter');
  await expect(editor.locator('div.markdown-alert.markdown-alert-warning')).toBeVisible();
});

test('Escape closes the slash menu without inserting', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  await page.keyboard.type('/');
  const menu = page.locator('[data-callout-slash]');
  await expect(menu).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(editor.locator('div.markdown-alert')).toHaveCount(0);
});
