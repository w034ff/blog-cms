import { test, expect, type Page } from '@playwright/test';
import { expectAutosaved, expectDraft, expectPublished, loadMarkdown } from './editor-authoring';

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

test('the header stands as tall as SiteHeader, on a pointer', async ({ page }) => {
  // A pointer never hits the 34px touch floor (app/globals.css, `@media (hover: none)`), so
  // without its own padding bump the editor's header settles on 投稿's 36px content height (53px
  // border-box) against SiteHeader's 61px (`py-4` plus `text-lg`'s line-height,
  // components/SiteHeader.tsx) — a jump felt moving between 記事一覧 and the editor (requested
  // 2026-09-21). The two headers are never on screen together, so this is two navigations, not
  // one box compared against a sibling.
  await page.goto('/');
  const siteHeaderHeight = (await box(page, page.locator('header'))).height;

  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  const editorHeaderHeight = (await box(page, header(page))).height;

  expect(editorHeaderHeight).toBe(siteHeaderHeight);
});

test('記事の設定 dims the full screen, not a margin-shortened strip of it', async ({ page }) => {
  // The backdrop and the drawer (PostSettingsPanel.tsx) are `position: fixed` with `bottom-0`,
  // which resolves against their own margin box — a `space-y-*` ancestor giving them an inherited
  // `margin-bottom` (as a non-last flow child) silently shortens that box short of the true
  // viewport bottom. Measured 788px against an 800px screen the first time this shipped, with the
  // last ~12px of the page left undimmed. `!mb-0` in the component is the fix; this is the guard.
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
  // This toggle predates ToolbarButton and never picked up its `active` prop (ToolbarButton.tsx's
  // own `bg-zinc-200`/`dark:bg-zinc-700`), so it was the one control in the header with no visible
  // sign of being open beyond `aria-expanded` (requested 2026-09-21).
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
  // `min-width: 100rem` (app/globals.css) is chosen with margin past the measured crossover
  // (1545px of clientWidth on an empty post), not the crossover itself — see that rule's own
  // comment for why a literal pixel isn't the right target. 1280 stays well under it and must stay
  // modal; 1700 clears it with room to spare and must stop being one.
  await page.setViewportSize({ width: 1700, height: 900 });
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByRole('button', { name: '記事の設定' }).click();
  await expect(page.getByLabel('カテゴリ')).toBeVisible();

  const pointerEvents = await page
    .locator('.post-settings-backdrop')
    .evaluate((el) => getComputedStyle(el).pointerEvents);
  expect(pointerEvents).toBe('none');

  // The claim that matters: the editor is still reachable and the drawer does not close on its
  // own — useDismiss's outside-click listener has to read the same computed style, not just the
  // backdrop's own onClick, since the press reaches the editor rather than the backdrop at all.
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Still editing at 1700px.');
  await expect(page.locator('.ProseMirror')).toContainText('Still editing at 1700px.');
  await expect(page.getByRole('button', { name: '記事の設定' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );

  // The page itself is also free to scroll here — this is the one piece that tracks the
  // breakpoint through live React state rather than a computed-style read at event time, since it
  // has to hold or release continuously rather than answer a single press (PostSettingsPanel.tsx's
  // own comment on why). A resize back under the line has to re-lock it just as live.
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');
});

test('closing 記事の設定 at that width never flashes black (§12.25)', async ({ browser }) => {
  // Needs real motion: this reproduced only mid-transition, with a `reducedMotion: 'reduce'`
  // context (the project default, playwright.config.ts) never entering the animated branch at all
  // and so never seeing it. `background-color: transparent` was first written scoped to `.is-open`
  // (app/globals.css §12.25) — the class React removes the instant a close starts, while `opacity`
  // (the only property that actually animates) had not yet begun its own fade. The result was one
  // frame where the backdrop was solid `bg-black/40` again, briefly, before fading back out —
  // reported 2026-09-21. Moving the transparency onto the bare `.post-settings-backdrop` class
  // means it no longer depends on `.is-open` at all at this width, so nothing reverts on close.
  const context = await browser.newContext({ reducedMotion: 'no-preference' });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1700, height: 900 });
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByRole('button', { name: '記事の設定' }).click();
  await expect(page.getByLabel('カテゴリ')).toBeVisible();

  await page.getByRole('button', { name: '閉じる' }).click();
  // Sampled as soon as possible after the click, before the 200ms fade has any chance to hide a
  // one-frame revert — a `background-color` transition would be forgiving of this; the bug this
  // guards is that there wasn't one, so any non-transparent read here is the failure.
  const backgroundColor = await page.evaluate(() => {
    const el = document.querySelector('.post-settings-backdrop') as HTMLElement;
    return getComputedStyle(el).backgroundColor;
  });
  expect(backgroundColor).toBe('rgba(0, 0, 0, 0)');

  await context.close();
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

  // The contents did not go with it: 記事一覧 still starts where the title does. Measured on the
  // glyph, not on its box — since 2026-09-21 the control is a 36px circle pulled left by 9px so
  // that the 18px icon inside it lands on the column's edge (docs/editor-requirements.md §12.6).
  // Those two numbers move together with the glyph's size, and the claim here is about neither:
  // it is that the arrow and the title share a left edge.
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
