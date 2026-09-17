import { test, expect, type Page } from '@playwright/test';
import {
  expectAutosaved,
  expectDraft,
  expectPublished,
  loadMarkdown,
  openPostSettings,
} from './editor-authoring';

// The editor's chrome is two stacked sticky layers: the page header (記事一覧 / the autosave
// state / 記事の設定 / 更新) and the format toolbar inside the editor frame. The toolbar pins
// against the header's *measured* height (components/editor/useMeasuredHeight.ts), because
// the header wraps at narrow widths and no written-down constant survives that.
//
// Everything here is geometry, an Enter that must not reach a submit button, and a control that
// moved behind a disclosure — none of it is a claim about a Slice, so none of it can be a vitest
// case (AGENTS.md, "Where an editor test goes").

// The two sticky layers, located as what they are. The toolbar's own buttons sit a couple of
// pixels inside their sticky box (`py-0.5`), and it is the box's edge that has to meet the
// header's, so the boxes are what get measured.
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

  // Scroll to the middle by moving the document, not the window: what is being measured is where
  // the two bars end up once the page's own content has gone past them.
  await page.locator('.ProseMirror p', { hasText: '段落 30 の本文。' }).scrollIntoViewIfNeeded();

  const headerBox = await box(page, header(page));
  const toolbarBox = await box(page, toolbar(page));

  // The header is at the viewport top. It is the form's direct child, which is the whole reason
  // it is still here: pinned inside the metadata wrapper it would have come unstuck as soon as
  // the settings panel scrolled past, which is well above 段落 30.
  expect(headerBox.y).toBeLessThanOrEqual(1);

  // The toolbar sits directly under it — no overlap, and no gap for the post to show through.
  // The tolerance is a pixel because offsetHeight is an integer and the layout is not.
  expect(toolbarBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 1);
  expect(toolbarBox.y).toBeLessThanOrEqual(headerBox.y + headerBox.height + 1);

  // Both are reachable, which is the point of pinning either of them.
  await expect(page.getByRole('button', { name: '投稿' })).toBeVisible();
  await expect(page.getByRole('button', { name: '太字' })).toBeVisible();
});

test('the header rule spans the window while its contents keep the column', async ({ page }) => {
  // A viewport wider than the column (max-w-site is 50rem), or the two are the same box and the
  // claim is vacuous.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();

  const headerBox = await box(page, header(page));
  const titleBox = await box(page, page.getByLabel('タイトル'));
  // The page's own usable width — `document.body.clientWidth`, measured at 1265 against a 1280
  // viewport. Neither `page.viewportSize()` nor `documentElement.clientWidth` is the reference
  // here: both report 1280, while <html>, <body> and <main> all lay out at 1265, and an element
  // that spans the page is not supposed to reach under the scrollbar anyway.

  // Edge to edge: the bar cancels PageMain's px-4 with -mx-4, which only reaches the window
  // because the editor's layout hands it a bare PageMain with no column around the form.
  expect(headerBox.x).toBeLessThanOrEqual(1);
  const pageWidth = await page.evaluate(() => document.body.clientWidth);
  expect(headerBox.width).toBeGreaterThanOrEqual(pageWidth - 1);

  // The contents did not go with it: 記事一覧 still starts where the title does. The link carries
  // `-mx-1` to cancel its hover padding, hence the tolerance.
  const backBox = await box(page, page.getByRole('link', { name: '記事一覧' }));
  expect(Math.abs(backBox.x + 4 - titleBox.x)).toBeLessThanOrEqual(1);
  expect(titleBox.width).toBeLessThan(pageWidth);
});

test('the 限定公開 chip sits with the state, left of the controls', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();

  // The chip renders only for an unlisted post, so it has to actually be set — a version of this
  // test that skipped the checkbox would pass against a bar that never draws the chip at all.
  const chip = page.getByText('限定公開', { exact: true });
  await expect(chip).toHaveCount(0);
  await openPostSettings(page);
  await page.getByRole('checkbox', { name: '限定公開にする' }).check();

  await expect(chip).toBeVisible();
  const chipBox = await box(page, chip);
  const backBox = await box(page, page.getByRole('link', { name: '記事一覧' }));
  const settingsBox = await box(page, page.getByRole('button', { name: '記事の設定' }));

  // The left end of the bar is what is true about the post; the right end is what can be done to
  // it. The chip is a state, so it belongs after the way out and well before the controls.
  expect(chipBox.x).toBeGreaterThan(backBox.x);
  expect(chipBox.x).toBeLessThan(settingsBox.x);
});

test('the autosave status never nudges the chip beside it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill('E2E chip shift');
  await openPostSettings(page);
  await page.getByRole('checkbox', { name: '限定公開にする' }).check();

  const chip = page.getByText('限定公開', { exact: true });
  await expect(chip).toBeVisible();

  // Three positions, one per state the status passes through: silent, then 保存中… while the edit
  // is in flight, then 保存済み ✓ once it lands. The strings are different widths, so an item
  // placed after the status would sit somewhere different in each.
  const atRest = (await box(page, chip)).x;

  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Shift me.');
  await expect(page.getByText('保存中…')).toBeVisible();
  const whileSaving = (await box(page, chip)).x;

  await expect(page.getByText('保存済み ✓')).toBeVisible();
  const whenSaved = (await box(page, chip)).x;

  expect(whileSaving).toBe(atRest);
  expect(whenSaved).toBe(atRest);
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

  // Not asserting *that* it wrapped — that is a fact about label widths, and a viewport where it
  // happens not to wrap would make the assertion a lie rather than a failure. What must hold is
  // that the offset is whatever the header actually measures, at any height it takes.
  expect(toolbarBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 1);
  expect(toolbarBox.y).toBeLessThanOrEqual(headerBox.y + headerBox.height + 1);
  await expect(page.getByRole('button', { name: '投稿' })).toBeVisible();
});

test('Enter in the title does not reach 投稿', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();

  // 投稿 is the form's first submit button and the header is the form's first child, so an
  // implicit submit from a metadata field would publish. blockImplicitSubmit on the wrapper the
  // title still lives in is what stops it — the buttons moved out of that wrapper, the fields
  // did not.
  await page.getByLabel('タイトル').fill('E2E implicit submit');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Body.');
  await expectAutosaved(page);

  await page.getByLabel('タイトル').click();
  await page.keyboard.press('Enter');

  // Still a draft, and still on the editor. A published post would also have navigated nowhere,
  // so the state is the claim, not the URL.
  await expectDraft(page);
  await expect(page.getByRole('button', { name: '投稿' })).toBeVisible();
});

test('下書きに戻す unpublishes from inside 記事の設定', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill('E2E unpublish from panel');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Take me down.');
  await expectAutosaved(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);

  // It is not on the header bar: a pinned unpublish would sit one click away for the whole
  // writing session, and it is never wanted from the middle of a post.
  await expect(header(page).getByRole('button', { name: '下書きに戻す' })).toHaveCount(0);

  await page.getByRole('button', { name: '記事の設定' }).click();
  await page.getByRole('button', { name: '下書きに戻す' }).click();

  await expectDraft(page);
  await expect(page.getByRole('button', { name: '投稿' })).toBeVisible();
});
