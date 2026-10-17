import { expect, test } from '@playwright/test';
import { expectAutosaved } from './editor-authoring';

const pageErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (error) => pageErrors.push(error.message));
});

test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

const draftBanner = (page: import('@playwright/test').Page) =>
  page.getByRole('alert').filter({ hasText: '保存されていない変更があります' });

async function expectDraftBufferBody(
  page: import('@playwright/test').Page,
  expectedSubstring: string,
) {
  await expect
    .poll(async () => {
      return await page.evaluate(() => {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key?.startsWith('draftBuffer:')) {
            try {
              const raw = localStorage.getItem(key);
              if (raw) {
                const parsed = JSON.parse(raw);
                if (typeof parsed?.content?.body === 'string') {
                  return parsed.content.body;
                }
              }
            } catch {
              // ignore
            }
          }
        }
        return '';
      });
    })
    .toContain(expectedSubstring);
}

test.describe('draft buffer (docs/draft-buffer-requirements.md)', () => {
  test('restores unsaved edits after save failure and persists them to server (§7 基準 1)', async ({
    page,
  }) => {
    await page.goto('/admin/posts/new');
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();

    await page.getByLabel('タイトル').fill('基準1 既存記事テスト');
    await editor.click();
    await page.keyboard.type('保存済みの本文。');
    await expectAutosaved(page);

    // Intercept autosave to simulate failure
    await page.route('**/api/drafts', (route) =>
      route.fulfill({ status: 500, body: JSON.stringify({ error: 'server error' }) }),
    );

    await editor.click();
    await page.keyboard.type(' 未保存の追加テキスト。');
    await expectDraftBufferBody(page, '未保存の追加テキスト。');

    // Reload with failed save
    await page.reload();

    const banner = draftBanner(page);
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('保存されていない変更があります');

    // Remove failure route so subsequent autosaves succeed
    await page.unroute('**/api/drafts');

    await page.getByRole('button', { name: '復元' }).click();
    await expect(editor).toContainText('未保存の追加テキスト。');

    // Restored edit is saved via normal autosave
    await expectAutosaved(page);

    // Reloading now opens with saved content and no banner
    await page.reload();
    await expect(editor).toContainText('未保存の追加テキスト。');
    await expect(draftBanner(page)).not.toBeVisible();
  });

  test('restores last keystroke when navigating away before debounce via in-app link (§7 基準 2)', async ({
    page,
  }) => {
    await page.goto('/admin/posts/new');
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();

    await page.getByLabel('タイトル').fill('基準2 離脱テスト');
    await editor.click();
    await page.keyboard.type('ベース本文');
    await expectAutosaved(page);

    await expect(page).toHaveURL(/\/admin\/posts\/\d+\/edit$/);
    const editUrl = page.url();

    // Type 1 character and immediately navigate away via in-app link before debounce finishes
    await editor.click();
    await page.keyboard.type('X');
    await page.getByRole('link', { name: '記事一覧' }).click();

    await expect(page).toHaveURL(/\/admin$/);

    // Return to the editor
    await page.goto(editUrl);

    const banner = draftBanner(page);
    await expect(banner).toBeVisible();
    await page.getByRole('button', { name: '復元' }).click();

    // The last character before in-app navigation was flushed and restored
    await expect(editor).toContainText('ベース本文X');
  });

  test('moves new post buffer from new:<kind> to post:<id> on first save (§7 基準 7)', async ({
    page,
  }) => {
    await page.goto('/admin/posts/new');
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();

    await page.getByLabel('タイトル').fill('基準7 新規移行テスト');
    await editor.click();
    await page.keyboard.type('最初の本文。');

    // Wait for the first autosave to materialize the post row and adopt its id
    await expect(page).toHaveURL(/\/admin\/posts\/\d+\/edit$/);
    const editUrl = page.url();

    // Fail subsequent autosaves
    await page.route('**/api/drafts', (route) =>
      route.fulfill({ status: 500, body: JSON.stringify({ error: 'server error' }) }),
    );

    await editor.click();
    await page.keyboard.type(' 失敗した編集。');
    await expectDraftBufferBody(page, '失敗した編集。');

    // Reopen the edit URL: buffer was migrated to post:<id> and surfaces on edit page
    await page.goto(editUrl);
    const banner = draftBanner(page);
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('保存されていない変更があります');
  });

  test('does not overwrite buffer while banner is visible (§7 基準 10)', async ({ page }) => {
    await page.goto('/admin/posts/new');
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();

    await page.getByLabel('タイトル').fill('基準10 上書き抑止テスト');
    await editor.click();
    await page.keyboard.type('保存された本文。');
    await expectAutosaved(page);

    // Fail autosave to create an unsaved buffer
    await page.route('**/api/drafts', (route) =>
      route.fulfill({ status: 500, body: JSON.stringify({ error: 'server error' }) }),
    );

    await editor.click();
    await page.keyboard.type('【控えの内容】');
    await expectDraftBufferBody(page, '【控えの内容】');

    // Reload to display the banner
    await page.reload();
    const banner = draftBanner(page);
    await expect(banner).toBeVisible();

    // While banner is visible, edit the content without clicking restore or discard
    await editor.click();
    await page.keyboard.type('【帯が出ている間の編集】');
    await expect(editor).toContainText('【帯が出ている間の編集】');

    // Reload again: the buffer must still hold the original buffered content, not the edit during banner
    await page.reload();
    await expect(banner).toBeVisible();
    await page.getByRole('button', { name: '復元' }).click();

    await expect(editor).toContainText('【控えの内容】');
    await expect(editor).not.toContainText('【帯が出ている間の編集】');
  });

  test('shows overwrite warning on reload when autosave succeeds while banner is active (§7 基準 11)', async ({
    page,
  }) => {
    await page.goto('/admin/posts/new');
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();

    await page.getByLabel('タイトル').fill('上書き警告テスト');
    await editor.click();
    await page.keyboard.type('初期保存本文。');
    await expectAutosaved(page);

    // Fail autosave to create an unsaved buffer
    await page.route('**/api/drafts', (route) =>
      route.fulfill({ status: 500, body: JSON.stringify({ error: 'server error' }) }),
    );

    await editor.click();
    await page.keyboard.type(' 未保存の編集。');
    await expectDraftBufferBody(page, '未保存の編集。');

    // Reload to display the banner (without overwrite warning initially)
    await page.reload();
    const banner = draftBanner(page);
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('保存されていない変更があります');
    await expect(banner).not.toContainText('この記事は控えの後に別の場所で保存されています');

    // Restore autosave so edits while banner is active reach the server
    await page.unroute('**/api/drafts');

    // Type while banner is active and let autosave succeed
    await editor.click();
    await page.keyboard.type(' 帯が出ている間の編集。');
    await expectAutosaved(page);

    // Reload: server's edited_at has progressed, while the buffer's baseEditedAt remained frozen.
    // The banner must now display the overwrite warning.
    await page.reload();
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('この記事は控えの後に別の場所で保存されています');

    // Restoring will restore the frozen buffer content
    await page.getByRole('button', { name: '復元' }).click();
    await expect(editor).toContainText('未保存の編集。');
    await expect(editor).not.toContainText('帯が出ている間の編集。');
  });
});
