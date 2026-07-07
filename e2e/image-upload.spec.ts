import { test, expect } from '@playwright/test';

// A minimal valid 1×1 PNG. Uploads are content-addressed (sha256), so re-runs
// dedup to a single file in public/uploads and the GC sweep reclaims it.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

// Exercises the image pipeline end-to-end: file → /api/uploads → an inserted
// image node carrying the returned /uploads/ URL.
test('toolbar image upload inserts an uploaded image', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  // The 画像 toolbar control wraps a hidden <input type=file>; setInputFiles works
  // on hidden inputs and triggers the same upload path as the picker.
  await page.locator('input[type="file"]').setInputFiles({
    name: 'e2e-pixel.png',
    mimeType: 'image/png',
    buffer: PNG_1x1,
  });

  const img = editor.locator('img');
  await expect(img).toBeVisible({ timeout: 20_000 });
  await expect(img).toHaveAttribute('src', /^\/uploads\/[0-9a-f]+\.png$/);
});
