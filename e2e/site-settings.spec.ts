import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { DEFAULT_SITE_NAME } from '../app/shared-metadata';
import { TEST_AUTHOR, TEST_DB_PATH } from './constants';

// docs/site-settings-requirements.md §6. Other files run beside this one on the same server, so
// the renamed site keeps the default name as a prefix: their header lookups match the link's name
// by substring, and the editor titles they assert match the part before the bar. The defaults
// go back however it ends.

function clearSettings(): void {
  const db = new Database(TEST_DB_PATH);
  try {
    db.prepare('DELETE FROM app_settings').run();
  } finally {
    db.close();
  }
}

test.beforeEach(clearSettings);
test.afterAll(clearSettings);

test('an admin renames the site and every surface shows it (id=2, 6)', async ({ page }) => {
  const name = `${DEFAULT_SITE_NAME} ${Date.now().toString(36)}`;
  const description = `説明 ${Date.now().toString(36)}`;

  await page.goto('/admin');
  await page
    .getByRole('navigation', { name: '管理' })
    .getByRole('link', { name: 'サイトの設定' })
    .click();
  await expect(page).toHaveURL(/\/admin\/settings$/);

  await page.getByLabel('サイトの名前').fill(name);
  await page.getByLabel('説明文').fill(description);
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('status')).toHaveText('保存しました');

  // id=6: the header on this very screen follows.
  const header = page.locator('header');
  await expect(header.getByRole('link', { name })).toBeVisible();
  await expect(page).toHaveTitle(`サイトの設定 | ${name}`);

  // id=2: title, og:site_name, description, footer on a public page.
  await page.goto('/');
  await expect(page).toHaveTitle(name);
  await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute('content', name);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', description);
  await expect(page.locator('footer')).toContainText(name);

  // id=2: the editor's tab title, set by the layout's template.
  await page.goto('/admin/posts/new');
  await expect(page).toHaveTitle(new RegExp(` \\| ${name}$`));

  // id=2: the feed's channel.
  const rss = await (await page.request.get('/rss.xml')).text();
  expect(rss).toContain(`<title><![CDATA[${name}]]></title>`);
  expect(rss).toContain(`<description><![CDATA[${description}]]></description>`);
});

// A 1x1 PNG the upload route accepts; its hash names the stored file.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test('a chosen share image becomes og:image, and clearing it restores the default (id=7)', async ({
  page,
}) => {
  await page.goto('/admin/settings');
  await expect(page.getByText('既定の画像', { exact: true })).toBeVisible();
  // The baked-in name only applies to the default image, so the note leaves with it (§9).
  const nameNote = page.getByText(`既定の画像には「${DEFAULT_SITE_NAME}」の名前が描かれていて`);
  await expect(nameNote).toBeVisible();
  await page.getByTestId('share-image-picker').setInputFiles({
    name: 'e2e-share.png',
    mimeType: 'image/png',
    buffer: PNG_1x1,
  });
  await expect(page.getByText('指定した画像', { exact: true })).toBeVisible();
  await expect(nameNote).toHaveCount(0);
  const chosen = await page.locator('input[name="shareImage"]').inputValue();
  expect(chosen).toMatch(/^\/uploads\/[0-9a-f]+\.png$/);
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('status')).toHaveText('保存しました');

  await page.goto('/');
  const ogImage = page.locator('meta[property="og:image"]');
  await expect(ogImage).toHaveAttribute('content', new RegExp(`${chosen}$`));
  // No size for an upload whose size is unknown (§9).
  await expect(page.locator('meta[property="og:image:width"]')).toHaveCount(0);

  // Reloaded, the field shows the saved choice; clearing it is a save like any other.
  await page.goto('/admin/settings');
  await expect(page.getByText('指定した画像', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '解除' }).click();
  await expect(page.getByText('既定の画像', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('status')).toHaveText('保存しました');

  await page.goto('/');
  await expect(ogImage).toHaveAttribute('content', /\/og\.png$/);
});

test('a refused value says why and changes nothing (id=4)', async ({ page }) => {
  await page.goto('/admin/settings');
  await page.getByLabel('サイトの名前').fill('');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('名前を入力してください')).toBeVisible();

  await page.goto('/');
  await expect(page).toHaveTitle(DEFAULT_SITE_NAME);
});

test.describe('as an author', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('sees no settings in the menu and gets a 404 by hand (id=5)', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('ユーザー名').fill(TEST_AUTHOR.username);
    await page.getByLabel('パスワード').fill(TEST_AUTHOR.password);
    await page.getByRole('button', { name: 'ログイン' }).click();
    await expect(page).toHaveURL(/\/admin$/);

    // The menu rendered, so the link's absence is the gate.
    const nav = page.getByRole('navigation', { name: '管理' });
    await expect(nav.getByRole('link', { name: '記事一覧' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'サイトの設定' })).toHaveCount(0);

    const response = await page.goto('/admin/settings');
    expect(response?.status()).toBe(404);
  });
});
