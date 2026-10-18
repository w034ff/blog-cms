import { test, expect } from '@playwright/test';
import { expectAutosaved } from './editor-authoring';

// docs/abuse-limits-requirements.md §8 row 12. Whether a body is too long is
// app/api/drafts/route.test.ts's; this spec owns the wiring: a 413 from autosave reaches the
// header, and the next save that goes through takes it away. The refusal is fulfilled here rather
// than provoked with 100,000 characters, which would measure TipTap's typing speed instead.
test('an autosave refused for length says so in the header, and recovers on the next save', async ({
  page,
}) => {
  await page.route('**/api/drafts', (route) =>
    route.fulfill({
      status: 413,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'body too long' }),
    }),
  );

  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await page.getByLabel('タイトル').fill('E2E body limit');
  await editor.click();
  await page.keyboard.type('本文です。');

  const notice = page.getByText('本文が長すぎます（100,000 字まで）');
  await expect(notice).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('保存に失敗', { exact: true })).toHaveCount(0);

  await page.unroute('**/api/drafts');
  await page.keyboard.type('追記');
  await expectAutosaved(page);
  await expect(notice).toHaveCount(0);
});
