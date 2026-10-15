import { test, expect } from '@playwright/test';
import { TEST_ADMIN } from './constants';

test('an unauthenticated visitor sees no "投稿する", account button, or "管理" link (docs/site-header-requirements.md §7 id=1)', async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const page = await context.newPage();
    await page.goto('/');

    const header = page.locator('header');
    await expect(header.getByRole('button', { name: '投稿する' })).toHaveCount(0);
    await expect(header.getByRole('button', { name: 'アカウントのメニュー' })).toHaveCount(0);
    await expect(header.getByRole('link', { name: '管理' })).toHaveCount(0);

    // Visible public elements
    await expect(header.getByRole('link', { name: 'Tech Blog' })).toBeVisible();
    await expect(header.getByRole('button', { name: '記事' })).toBeVisible();
    await expect(header.getByRole('link', { name: '走り書き' })).toBeVisible();
  } finally {
    await context.close();
  }
});

test('site section styling and aria-current on active views (docs/site-header-requirements.md §7 id=2)', async ({
  page,
}) => {
  const header = page.locator('header');
  const siteNav = header.getByRole('navigation', { name: 'サイト' });

  // At /scribbles, '走り書き' has aria-current="page" and dark color
  await page.goto('/scribbles');
  const scribblesLink = siteNav.getByRole('link', { name: '走り書き' });
  await expect(scribblesLink).toHaveAttribute('aria-current', 'page');

  // Verify computed text color difference: active section is dark, inactive is muted
  const scribblesColor = await scribblesLink.evaluate((el) => window.getComputedStyle(el).color);
  const articlesButton = siteNav.getByRole('button', { name: '記事' });
  const articlesColor = await articlesButton.evaluate((el) => window.getComputedStyle(el).color);
  expect(scribblesColor).not.toBe(articlesColor);
  await expect(scribblesLink).toHaveClass(/text-zinc-900/);

  // At /tags, opening '記事' menu reveals 'タグ' with aria-current="page"
  await page.goto('/tags');
  await articlesButton.click();
  const tagsLink = siteNav.getByRole('link', { name: 'タグ' });
  await expect(tagsLink).toHaveAttribute('aria-current', 'page');
  const categoriesLink = siteNav.getByRole('link', { name: 'カテゴリ' });
  await expect(categoriesLink).not.toHaveAttribute('aria-current', 'page');
});

test('dropdown menus open on click, dismiss on Escape or outside click, restore focus, and are mutually exclusive (docs/site-header-requirements.md §7 id=3)', async ({
  page,
}) => {
  await page.goto('/');

  const header = page.locator('header');
  const siteNav = header.getByRole('navigation', { name: 'サイト' });
  const accountNav = header.getByRole('navigation', { name: 'アカウント' });

  const articlesBtn = siteNav.getByRole('button', { name: '記事' });
  const postBtn = accountNav.getByRole('button', { name: '投稿する' });
  const accountBtn = accountNav.getByRole('button', { name: 'アカウントのメニュー' });

  // 1. Click to open
  await articlesBtn.click();
  await expect(articlesBtn).toHaveAttribute('aria-expanded', 'true');
  const latestLink = siteNav.getByRole('link', { name: '最新の記事' });
  await expect(latestLink).toBeVisible();

  // 2. Escape to close, restores focus to trigger button
  await page.keyboard.press('Escape');
  await expect(articlesBtn).toHaveAttribute('aria-expanded', 'false');
  await expect(latestLink).toHaveCount(0);
  await expect(articlesBtn).toBeFocused();

  // 3. Click to open and click outside to close
  await articlesBtn.click();
  await expect(latestLink).toBeVisible();
  await header.click({ position: { x: 10, y: 10 } });
  await expect(articlesBtn).toHaveAttribute('aria-expanded', 'false');
  await expect(latestLink).toHaveCount(0);

  // 4. Mutually exclusive: opening account button while post menu is open closes post menu
  await postBtn.click();
  await expect(postBtn).toHaveAttribute('aria-expanded', 'true');
  await expect(accountNav.getByText('新しく書く')).toBeVisible();

  await accountBtn.click();
  await expect(postBtn).toHaveAttribute('aria-expanded', 'false');
  await expect(accountBtn).toHaveAttribute('aria-expanded', 'true');
  await expect(accountNav.getByText('新しく書く')).toHaveCount(0);
  await expect(accountNav.getByRole('link', { name: 'ライブラリ' })).toBeVisible();
});

test('signed-in user can navigate to new article and new scribble from "投稿する" menu (docs/site-header-requirements.md §7 id=4)', async ({
  page,
}) => {
  await page.goto('/');

  const header = page.locator('header');
  const accountNav = header.getByRole('navigation', { name: 'アカウント' });

  // 1. New article
  await accountNav.getByRole('button', { name: '投稿する' }).click();
  await accountNav.getByRole('link', { name: '記事' }).click();
  await expect(page).toHaveURL(/\/admin\/posts\/new$/);

  // 2. New scribble (navigate back to home first, since the editor does not carry SiteHeader)
  await page.goto('/');
  await accountNav.getByRole('button', { name: '投稿する' }).click();
  await accountNav.getByRole('link', { name: '走り書き' }).click();
  await expect(page).toHaveURL(/\/admin\/posts\/new\?kind=scribble$/);
});

test('account menu leads to library and admin, and logout resets the header to unauthenticated state (docs/site-header-requirements.md §7 id=5)', async ({
  browser,
}) => {
  // Use dedicated context to avoid invalidating the shared storageState
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const page = await context.newPage();
    await page.goto('/login');
    await page.getByLabel('ユーザー名').fill(TEST_ADMIN.username);
    await page.getByLabel('パスワード').fill(TEST_ADMIN.password);
    await page.getByRole('button', { name: 'ログイン' }).click();
    await page.waitForURL('**/admin');

    const header = page.locator('header');
    const accountNav = header.getByRole('navigation', { name: 'アカウント' });

    // Account menu -> ライブラリ
    await accountNav.getByRole('button', { name: 'アカウントのメニュー' }).click();
    await accountNav.getByRole('link', { name: 'ライブラリ' }).click();
    await expect(page).toHaveURL(/\/admin\/library$/);

    // Account menu -> 管理画面
    await accountNav.getByRole('button', { name: 'アカウントのメニュー' }).click();
    await accountNav.getByRole('link', { name: '管理画面' }).click();
    await expect(page).toHaveURL(/\/admin$/);

    // Account menu -> ログアウト
    await accountNav.getByRole('button', { name: 'アカウントのメニュー' }).click();
    await accountNav.getByRole('button', { name: 'ログアウト' }).click();
    await expect(page).toHaveURL(/\/login$/);

    // Navigating back to public site shows unauthenticated header
    await page.goto('/');
    await expect(header.getByRole('button', { name: '投稿する' })).toHaveCount(0);
    await expect(header.getByRole('button', { name: 'アカウントのメニュー' })).toHaveCount(0);
    await expect(header.getByRole('button', { name: '記事' })).toBeVisible();
    await expect(header.getByRole('link', { name: '走り書き' })).toBeVisible();
  } finally {
    await context.close();
  }
});

test('header stands at 61px on both 360px and 1280px viewports, unauthenticated and signed-in (docs/site-header-requirements.md §7 id=6)', async ({
  page,
  browser,
}) => {
  // 1. Signed-in state
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const authed1280 = await page.locator('header').boundingBox();
  expect(authed1280?.height).toBe(61);

  await page.setViewportSize({ width: 360, height: 640 });
  const authed360 = await page.locator('header').boundingBox();
  expect(authed360?.height).toBe(61);

  // 2. Unauthenticated state
  const unauthed = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const unauthedPage = await unauthed.newPage();

    await unauthedPage.setViewportSize({ width: 1280, height: 800 });
    await unauthedPage.goto('/');
    const unauthed1280 = await unauthedPage.locator('header').boundingBox();
    expect(unauthed1280?.height).toBe(61);

    await unauthedPage.setViewportSize({ width: 360, height: 640 });
    const unauthed360 = await unauthedPage.locator('header').boundingBox();
    expect(unauthed360?.height).toBe(61);
  } finally {
    await unauthed.close();
  }
});

test('admin screens lack logout in side/heading menus and lack "新規作成" in heading row (docs/site-header-requirements.md §7 id=7)', async ({
  page,
}) => {
  // 1. /admin
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: '記事一覧' })).toBeVisible();

  // Heading row does not have 新規作成 link
  const adminHeadingRow = page.locator('section > div.mb-6');
  await expect(adminHeadingRow.getByRole('link', { name: '新規作成' })).toHaveCount(0);

  // Left rail side nav has no logout
  const sideNav = page.getByRole('navigation', { name: '管理' });
  await expect(sideNav.getByRole('button', { name: 'ログアウト' })).toHaveCount(0);

  // Narrow viewport 360px: ScreenHeading popup has no logout
  await page.setViewportSize({ width: 360, height: 640 });
  await page.getByRole('button', { name: '記事一覧' }).click();
  const popup = page.locator('.admin-popup');
  await expect(popup).toBeVisible();
  await expect(popup.getByRole('button', { name: 'ログアウト' })).toHaveCount(0);

  // 2. /admin/scribbles
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/admin/scribbles');
  await expect(page.getByRole('heading', { name: '走り書き' })).toBeVisible();

  const scribblesHeadingRow = page.locator('section > div.mb-6');
  await expect(scribblesHeadingRow.getByRole('link', { name: '新規作成' })).toHaveCount(0);
});
