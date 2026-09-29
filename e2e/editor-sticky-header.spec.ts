import { test, expect, type Page } from '@playwright/test';
import {
  expectAutosaved,
  expectDraft,
  expectPublished,
  loadMarkdown,
  ensureCategory,
} from './editor-authoring';

// Two stacked sticky layers: the page header and the format toolbar, which pins against the header's
// measured height (useMeasuredHeight.ts), since the header wraps. Geometry, not a Slice (AGENTS.md).

// The sticky boxes themselves: the toolbar's buttons sit inside theirs (`py-0.5`).
const header = (page: Page) => page.locator('[data-publish-state]');
const toolbar = (page: Page) => page.locator('div.sticky:not([data-publish-state])');

// A post long enough that the middle of it is nowhere near either end.
const LONG_POST = Array.from({ length: 60 }, (_, i) => `段落 ${i + 1} の本文。`).join('\n\n');

async function box(page: Page, locator: ReturnType<typeof header>) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error('element has no box');
  return rect;
}

test('both sticky layers survive the middle of a long post, stacked and not overlapping', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill('E2E sticky header');
  await loadMarkdown(page, LONG_POST);

  // Move the document, so its content goes past the bars.
  await page.locator('.ProseMirror p', { hasText: '段落 30 の本文。' }).scrollIntoViewIfNeeded();

  const headerBox = await box(page, header(page));
  const toolbarBox = await box(page, toolbar(page));

  // The header is the form's direct child, so it stays stuck past the settings panel.
  expect(headerBox.y).toBeLessThanOrEqual(1);

  // Directly under it; a pixel's tolerance, as offsetHeight is an integer.
  expect(toolbarBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 1);
  expect(toolbarBox.y).toBeLessThanOrEqual(headerBox.y + headerBox.height + 1);

  // Both reachable.
  await expect(page.getByRole('button', { name: '投稿' })).toBeVisible();
  await expect(page.getByRole('button', { name: '太字' })).toBeVisible();
});

test('the header stands as tall as SiteHeader, on a pointer', async ({ page }) => {
  // A pointer never hits the 34px touch floor (app/globals.css, `@media (hover: none)`), so the
  // header gets its own padding to match SiteHeader's 61px (components/SiteHeader.tsx). Two
  // navigations: the headers are never on screen together.
  await page.goto('/');
  const siteHeaderHeight = (await box(page, page.locator('header'))).height;

  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  const editorHeaderHeight = (await box(page, header(page))).height;

  expect(editorHeaderHeight).toBe(siteHeaderHeight);
});

test('記事の設定 dims the full screen, not a margin-shortened strip of it', async ({ page }) => {
  // The drawer's `fixed` `bottom-0` resolves against its margin box, which an inherited `space-y-*`
  // margin shortened, leaving the page bottom undimmed. `!mb-0` fixes it; this guards it.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByRole('button', { name: '記事の設定' }).click();
  await expect(page.getByLabel('カテゴリ')).toBeVisible();

  const backdropHeight = (await box(page, page.locator('[aria-hidden="true"].bg-black\\/40')))
    .height;
  const panelHeight = (await box(page, page.locator('#post-settings-panel'))).height;
  expect(backdropHeight).toBe(800);
  expect(panelHeight).toBe(800);
});

test("記事の設定 gets a background fill while open, ToolbarButton's own active state", async ({
  page,
}) => {
  // This toggle predates ToolbarButton's `active`, so it showed no open state beyond `aria-expanded`.
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  const toggle = page.getByRole('button', { name: '記事の設定' });

  const closed = await toggle.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(closed).toBe('rgba(0, 0, 0, 0)');

  await toggle.click();
  await expect(page.getByLabel('カテゴリ')).toBeVisible();
  const open = await toggle.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(open).not.toBe('rgba(0, 0, 0, 0)');
});

test('記事の設定 stops being modal once the drawer clears the editor column (§12.25)', async ({
  page,
}) => {
  // `min-width: 106rem` (app/globals.css) is chosen with margin past the measured crossover (~1652px),
  // not the crossover itself. 1280 stays modal; 1700 must not be.
  await page.setViewportSize({ width: 1700, height: 900 });
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByRole('button', { name: '記事の設定' }).click();
  await expect(page.getByLabel('カテゴリ')).toBeVisible();

  const pointerEvents = await page
    .locator('.post-settings-backdrop')
    .evaluate((el) => getComputedStyle(el).pointerEvents);
  expect(pointerEvents).toBe('none');

  // The editor is reachable and the drawer stays: `useDismiss` reads the same computed style, since
  // the press reaches the editor, not the backdrop.
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Still editing at 1700px.');
  await expect(page.locator('.ProseMirror')).toContainText('Still editing at 1700px.');
  await expect(page.getByRole('button', { name: '記事の設定' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );

  // The page scrolls too: the lock follows the breakpoint through React state
  // (PostSettingsPanel.tsx says why), so a resize back under it must relock.
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');
});

test('closing 記事の設定 at that width never flashes black (§12.25)', async ({ browser }) => {
  // Needs real motion (the project default is `reducedMotion: 'reduce'`). Transparency scoped to
  // `.is-open` (docs/editor-requirements.md §12.25) reverted the instant a close started, before
  // `opacity` faded; on the bare class nothing reverts.
  const context = await browser.newContext({ reducedMotion: 'no-preference' });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1700, height: 900 });
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByRole('button', { name: '記事の設定' }).click();
  await expect(page.getByLabel('カテゴリ')).toBeVisible();

  await page.getByRole('button', { name: '閉じる' }).click();
  // Sampled at once: `background-color` is not transitioned, so any non-transparent read fails.
  const backgroundColor = await page.evaluate(() => {
    const el = document.querySelector('.post-settings-backdrop') as HTMLElement;
    return getComputedStyle(el).backgroundColor;
  });
  expect(backgroundColor).toBe('rgba(0, 0, 0, 0)');

  await context.close();
});

test('the header rule spans the window while its contents keep the column', async ({ page }) => {
  // Wider than the column (`--container-editor`), or the claim is vacuous.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();

  const headerBox = await box(page, header(page));
  const titleBox = await box(page, page.getByLabel('タイトル'));
  // `document.body.clientWidth` (1265 at 1280): the viewport figures include the scrollbar.

  // Edge to edge: `-mx-4` reaches the window only with a bare PageMain around the form.
  expect(headerBox.x).toBeLessThanOrEqual(1);
  const pageWidth = await page.evaluate(() => document.body.clientWidth);
  expect(headerBox.width).toBeGreaterThanOrEqual(pageWidth - 1);

  // 記事一覧's glyph, not its box, shares the title's left edge (§12.6).
  const glyphBox = await box(page, page.getByRole('link', { name: '記事一覧' }).locator('svg'));
  expect(Math.abs(glyphBox.x - titleBox.x)).toBeLessThanOrEqual(1);
  expect(titleBox.width).toBeLessThan(pageWidth);
});

test('the toolbar follows the header when a narrow viewport wraps it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill('E2E sticky header narrow');
  await loadMarkdown(page, LONG_POST);
  await page.locator('.ProseMirror p', { hasText: '段落 30 の本文。' }).scrollIntoViewIfNeeded();

  const headerBox = await box(page, header(page));
  const toolbarBox = await box(page, toolbar(page));

  // Not that it wrapped (label widths decide), but that the offset follows the header's height.
  expect(toolbarBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 1);
  expect(toolbarBox.y).toBeLessThanOrEqual(headerBox.y + headerBox.height + 1);
  await expect(page.getByRole('button', { name: '投稿' })).toBeVisible();
});

test('Enter in the title does not reach 投稿', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();

  // 投稿 is the form's first submit, so an implicit submit from a field would publish;
  // blockImplicitSubmit on the fields' wrapper stops it.
  await page.getByLabel('タイトル').fill('E2E implicit submit');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Body.');
  await expectAutosaved(page);

  await page.getByLabel('タイトル').click();
  await page.keyboard.press('Enter');

  // Still a draft: the state is the claim, not the URL.
  await expectDraft(page);
  await expect(page.getByRole('button', { name: '投稿' })).toBeVisible();
});

// 記事の設定's 公開 switch (docs/editor-requirements.md §12.27): `aria-checked` follows
// `isPublished`, the server's answer.
test('公開 in 記事の設定 appears after the first 投稿, then unpublishes and publishes again', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill('E2E publish switch');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Take me down.');
  await expectAutosaved(page);

  // Never published: the first publish, which stamps the date, is 投稿's alone.
  await page.getByRole('button', { name: '記事の設定' }).click();
  await expect(page.getByRole('switch', { name: '公開' })).toHaveCount(0);
  await page.getByRole('button', { name: '閉じる' }).click();

  await ensureCategory(page);

  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);

  // Not on the header bar, one click away all session.
  await expect(header(page).getByRole('switch')).toHaveCount(0);

  await page.getByRole('button', { name: '記事の設定' }).click();
  // 36px on a pointer (§12.28, CloseButton.tsx).
  const closeBox = (await page.getByRole('button', { name: '閉じる' }).boundingBox())!;
  expect([closeBox.width, closeBox.height]).toEqual([36, 36]);
  const toggle = page.getByRole('switch', { name: '公開' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expectDraft(page);
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('button', { name: '投稿' })).toBeVisible();

  // The drawer stays open, so the same switch reverses it.
  await toggle.click();
  await expectPublished(page);
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
});

// A refusal says why in the drawer, whose backdrop dims the header's copy. A note-less reference is
// refused server-side (`incompleteFootnotes`).
test('a refused 公開 leaves the switch off and shows the reason in the drawer', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill('E2E refused publish switch');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Body.');
  await expectAutosaved(page);
  await ensureCategory(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);

  await page.getByRole('button', { name: '記事の設定' }).click();
  const toggle = page.getByRole('switch', { name: '公開' });
  await toggle.click();
  await expectDraft(page);
  await page.getByRole('button', { name: '閉じる' }).click();
  await loadMarkdown(page, '本文[^a]\n\n[^a]:\n');
  await expectAutosaved(page);

  await page.getByRole('button', { name: '記事の設定' }).click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();

  const drawer = page.getByRole('dialog', { name: '記事の設定' });
  await expect(drawer.getByRole('alert')).toContainText('脚注が 1 件、空のままです。');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expectDraft(page);
});

// A refused first 投稿 from /admin/posts/new: autosave has moved the URL to /edit, and the proxy's
// session refresh used to revalidate the page and remount the editor (proxy.ts's `next-action`
// check, §12.27).
test('a refused first 投稿 keeps its message and the editor', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill('E2E refused first publish');
  await loadMarkdown(page, '本文[^a]\n\n[^a]:\n');
  await expectAutosaved(page);
  await page.evaluate(() => {
    (document.querySelector('form') as HTMLFormElement).dataset.mountProbe = 'kept';
  });

  await ensureCategory(page);

  await page.getByRole('button', { name: '投稿' }).click();

  await expect(header(page).getByText('脚注が 1 件、空のままです。')).toBeVisible();
  await expectDraft(page);
  // The same <form>: a remount would drop the marker.
  await expect(page.locator('form[data-mount-probe="kept"]')).toHaveCount(1);
});

// 記事の設定's focus (docs/editor-requirements.md §12.29): into the drawer on open, back to the gear
// on close, trapped while modal.
test.describe('記事の設定 focus', () => {
  const panelHasFocus = (page: Page) =>
    page.evaluate(() => Boolean(document.activeElement?.closest('#post-settings-panel')));

  test('opens onto the drawer, keeps Tab inside, and returns to the gear', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/admin/posts/new');
    await expect(page.locator('.ProseMirror')).toBeVisible();
    const gear = page.getByRole('button', { name: '記事の設定' });
    const drawer = page.getByRole('dialog', { name: '記事の設定' });

    await gear.click();
    await expect(drawer).toBeFocused();
    await expect(drawer).toHaveAttribute('aria-modal', 'true');

    // More presses than stops, both ways.
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      expect(await panelHasFocus(page)).toBe(true);
    }
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await panelHasFocus(page)).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(gear).toBeFocused();

    await gear.click();
    await page.getByRole('button', { name: '閉じる' }).click();
    await expect(gear).toBeFocused();

    await gear.click();
    await page.mouse.click(100, 400);
    await expect(drawer).toBeHidden();
    await expect(gear).toBeFocused();
  });

  // Past 106rem not modal (§12.25): no trap, and Escape in the editor is the editor's.
  test('past the modal width, Escape closes it only from inside', async ({ page }) => {
    await page.setViewportSize({ width: 1700, height: 900 });
    await page.goto('/admin/posts/new');
    await expect(page.locator('.ProseMirror')).toBeVisible();
    const gear = page.getByRole('button', { name: '記事の設定' });
    const drawer = page.getByRole('dialog', { name: '記事の設定' });

    await gear.click();
    await expect(drawer).toBeFocused();
    await expect(drawer).not.toHaveAttribute('aria-modal', 'true');

    await page.locator('.ProseMirror').click();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeVisible();
    await expect(page.locator('.ProseMirror')).toBeFocused();

    await page.getByRole('combobox', { name: 'タグ' }).click();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(gear).toBeFocused();
  });
});

// 投稿 with no title deep in a post (docs/editor-requirements.md §12.34): the browser's minimal scroll
// put the field under the sticky header. Measured where the field lands.
test('a 投稿 refused for an empty title brings the title out from under the header', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await loadMarkdown(page, LONG_POST);
  await page.locator('.ProseMirror p', { hasText: '段落 30 の本文。' }).scrollIntoViewIfNeeded();
  const title = page.getByLabel('記事タイトル');
  // Out of sight above, so the browser must scroll.
  expect((await box(page, title)).y).toBeLessThan(0);

  await ensureCategory(page);

  await page.getByRole('button', { name: '投稿' }).click();

  await expect(title).toBeFocused();
  const headerBox = await box(page, header(page));
  expect((await box(page, title)).y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height);
  expect(await title.evaluate((input: HTMLInputElement) => input.validationMessage)).toBe(
    'タイトルを入力してください。',
  );

  // Typing clears the invalid state.
  await title.fill('E2E title required');
  expect(await title.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(true);
});
