import { test, expect, type Locator, type Page } from '@playwright/test';
import { loadMarkdown } from './editor-authoring';

// `.prose a` got a colour of its own (docs/link-requirements.md §7.1). Until now prose-zinc left
// links at body hue — zinc-900 on a zinc-700 body, white on zinc-300 — and the permanent underline
// was the only thing separating a link from its sentence.
//
// It is a CSS-only change, so nothing about it reaches vitest, and it is a *generic* `.prose a`
// selector, which is the shape that regresses things nobody was looking at. Both halves are
// measured here: the links that should have changed, and the four anchors that should not have.
//
// One post carries all of it. The link is what changed; the footnote gives a reference, a backref
// and a popover jump, each of which has its own rule that this one had to lose to or outrank
// harmlessly; the three headings are what makes the page draw a table of contents.
const SOURCE = [
  '前[リンク](https://example.com "タイトル")後、そして脚注[^a]。',
  '',
  '## 見出し二',
  '',
  '本文。',
  '',
  '## 見出し三',
  '',
  '本文。',
  '',
  '## 見出し四',
  '',
  '本文。',
  '',
  '[^a]: 注釈テキスト',
  '',
].join('\n');

// The new rule names its blue as a literal hex, so it comes back as plain `rgb()`.
const BLUE_LIGHT = 'rgb(9, 105, 218)'; // #0969da
const BLUE_DARK = 'rgb(68, 147, 248)'; // #4493f8
const ACCENT_LIGHT = 'rgb(207, 34, 46)'; // #cf222e — the 強調 mark's red, also a literal hex

// Everything NOT changed here gets its colour from a Tailwind v4 palette entry, and those come back
// from getComputedStyle as `lab(...)` — measured, e.g. zinc-700 is `lab(26.8019 1.35387 -4.68303)`.
// Pinning those strings would be pinning a serialization, so the untouched elements are stated as
// "not the new blue" instead. That is also the sharper claim: a generic `.prose a` rule regresses by
// *reaching* something, and reaching it means painting it this exact colour.
function colorOf(locator: Locator): Promise<string> {
  return locator.evaluate((el) => getComputedStyle(el).color);
}

// Authors the post in the real editor and publishes it, returning the public URL. Published rather
// than previewed because the published side is half the claim: the two surfaces share the `.prose`
// stack, and "one rule covers both" is only shown by looking at both.
async function publish(page: Page, title: string): Promise<string> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill(title);
  await loadMarkdown(page, SOURCE);
  await expect(page.locator('.ProseMirror a')).toHaveCount(1);

  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '投稿' }).click();
  await expect(page.getByText('公開済み（最新）')).toBeVisible({ timeout: 20_000 });

  const href = await page.getByRole('link', { name: '表示' }).getAttribute('href');
  expect(href).toMatch(/^\/posts\/[0-9a-f]+$/);
  return href!;
}

test('an ordinary link is blue on both surfaces, and keeps the underline it had', async ({
  page,
}) => {
  const href = await publish(page, 'Link colour spec');

  // The editor first, because this is where it buys the most: `openOnClick: false` means an editor
  // link never navigates, and the link card only opens once the caret is already inside one.
  const inEditor = page.locator('.ProseMirror a');
  await expect(inEditor).toHaveCSS('color', BLUE_LIGHT);

  // The underline is the non-color cue, and it stays — the rule declares `color` and nothing else.
  // Asserted at rest, not on hover: a hover-only underline would be the footnote reference's
  // treatment, which a full-size link has no reason to borrow.
  await expect(inEditor).toHaveCSS('text-decoration-line', 'underline');
  await expect(inEditor).toHaveCSS('font-weight', '500');

  // What it is being separated *from*. Without this the colour assertion above would still pass if
  // the body had drifted blue too, which is the failure the whole change is about — the state
  // before this change was precisely "the link is the body's colour".
  expect(await colorOf(page.locator('.ProseMirror p').first())).not.toBe(BLUE_LIGHT);

  await page.goto(href);
  const published = page.locator('.prose a:not([data-footnote-ref]):not([data-footnote-backref])');
  await expect(published).toHaveCount(1);
  await expect(published).toHaveCSS('color', BLUE_LIGHT);
  await expect(published).toHaveCSS('text-decoration-line', 'underline');
  await expect(published).toHaveCSS('font-weight', '500');
  expect(await colorOf(page.locator('#post-body p').first())).not.toBe(BLUE_LIGHT);
});

test('the footnote reference and backref keep their own rule', async ({ page }) => {
  const href = await publish(page, 'Link colour spec — footnote');
  await page.goto(href);

  // These carry an attribute selector (0,2,1) and outrank the new `.prose a` (0,1,1). The colour is
  // the same blue either way — it is where the new rule took its value from — so the observable
  // claim is the underline: prose underlines every `a`, these two hold it back for hover, and a
  // generic rule reaching them would show up here first.
  for (const link of [
    page.locator('.prose a[data-footnote-ref]').first(),
    page.locator('.prose a[data-footnote-backref]').first(),
  ]) {
    await expect(link).toHaveCSS('color', BLUE_LIGHT);
    await expect(link).toHaveCSS('text-decoration-line', 'none');
    await link.hover();
    await expect(link).toHaveCSS('text-decoration-line', 'underline');
    await page.mouse.move(0, 0);
    await expect(link).toHaveCSS('text-decoration-line', 'none');
  }
});

// The other half of the audit, and the half that is easy to skip: not "which anchors does the new
// rule reach" but "which existing `color` declarations does it now outrank". `.prose a` is (0,1,1)
// and unlayered, where the typography rule it replaces was (0,1,0) and layered — so anything in this
// file setting a colour with a single class inside `.prose` is a candidate to lose.
//
// `.accent-emphasis` (0,1,0) is the one with a different colour to lose (#cf222e), and
// accent-emphasis-extension.ts's `excludes` lists bold/italic/strike/code but NOT link, so a link
// carrying the 強調 mark is reachable rather than hypothetical.
//
// Measured: it does not lose, and specificity is not why. The mark renders its span INSIDE the `<a>`
// (both surfaces), so the two rules land on two different elements and never arbitrate — the span's
// own declaration beats what it would inherit, exactly as it did before this change. That is what
// makes this worth a test rather than a comment: the reasoning depends on the nesting order, and
// nothing else in the repo pins it.
test('a link carrying the 強調 mark stays red, on both surfaces', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await page.getByLabel('タイトル').fill('Link colour spec — accent');
  await editor.click();
  await loadMarkdown(page, '[強調リンク](https://example.com)\n');
  await expect(page.locator('.ProseMirror a')).toHaveCount(1);
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: '強調' }).click();

  const inEditor = page.locator('.ProseMirror a .accent-emphasis');
  await expect(inEditor).toHaveCSS('color', ACCENT_LIGHT);
  // The `<a>` around it does take the new blue — it just has no text of its own to paint here. A
  // partly-accented link is the case where both colours show at once, and that is intended.
  await expect(page.locator('.ProseMirror a')).toHaveCSS('color', BLUE_LIGHT);

  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '投稿' }).click();
  await expect(page.getByText('公開済み（最新）')).toBeVisible({ timeout: 20_000 });
  const href = await page.getByRole('link', { name: '表示' }).getAttribute('href');
  await page.goto(href!);

  // The published side rebuilds the nesting from markdown (`[<span …>…</span>](…)`) rather than
  // copying the editor's DOM, so it is a second measurement, not the same one twice.
  await expect(page.locator('#post-body a .accent-emphasis')).toHaveCSS('color', ACCENT_LIGHT);
  await expect(page.locator('#post-body a').first()).toHaveCSS('color', BLUE_LIGHT);
});

test('the table of contents sits outside .prose and is untouched', async ({ page }) => {
  const href = await publish(page, 'Link colour spec — toc');
  await page.goto(href);

  // `:visible` rather than `.first()`: TocNavMobile and TocNavDesktop both render, both carry
  // `aria-label='目次'`, and the mobile one comes first in the DOM — collapsed inside a `<details>`
  // and `toc:hidden` besides. The rail is the one a reader sees at the default 1280px viewport,
  // which is past the `toc:` breakpoint (77rem).
  const tocLink = page.locator('nav[aria-label="目次"]:visible .toc-link').first();
  await expect(tocLink).toBeVisible();

  // Still zinc-600 from TocNav's own Tailwind classes. The ToC is the anchor a `.prose a` rule would
  // be most likely to swallow by accident, and the only thing keeping it out is that it sits outside
  // the article body — a fact that lived in a comment (`globals.css:900`) until now.
  expect(await colorOf(tocLink)).not.toBe(BLUE_LIGHT);
});

test.describe('dark', () => {
  test.use({ colorScheme: 'dark' });

  test('both surfaces take the brighter blue', async ({ page }) => {
    const href = await publish(page, 'Link colour spec — dark');

    const inEditor = page.locator('.ProseMirror a');
    await expect(inEditor).toHaveCSS('color', BLUE_DARK);
    await expect(inEditor).toHaveCSS('text-decoration-line', 'underline');
    expect(await colorOf(page.locator('.ProseMirror p').first())).not.toBe(BLUE_DARK);

    await page.goto(href);
    const published = page.locator(
      '.prose a:not([data-footnote-ref]):not([data-footnote-backref])',
    );
    await expect(published).toHaveCSS('color', BLUE_DARK);
    await expect(published).toHaveCSS('text-decoration-line', 'underline');
    expect(await colorOf(page.locator('#post-body p').first())).not.toBe(BLUE_DARK);

    // The dark counterpart lives in a different @media block from the footnote reference's, so the
    // two are only ordered by specificity here. Same reasoning as the light case above.
    await expect(page.locator('.prose a[data-footnote-ref]').first()).toHaveCSS(
      'text-decoration-line',
      'none',
    );
  });
});

test.describe('touch', () => {
  test.use({ hasTouch: true });

  test('the pinned popover’s 定義へ survives being outranked by the new rule', async ({ page }) => {
    const href = await publish(page, 'Link colour spec — popover');
    await page.goto(href);

    const ref = page.locator('.prose a[data-footnote-ref]').first();
    const box = await ref.boundingBox();
    await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);

    // The popover carries `prose` (FootnotePopover.tsx), so `.prose a` (0,1,1) beats
    // `.footnote-popover-jump` (0,1,0) — the one place the new rule wins against an existing one.
    // It is harmless on two counts, and both are measured: the colour it imposes is the colour that
    // was already there, and declaring `color` alone leaves the jump's own `text-decoration: none`
    // standing rather than putting prose's underline back under it.
    const jump = page.locator('.footnote-popover--pinned .footnote-popover-jump');
    await expect(jump).toBeVisible();
    await expect(jump).toHaveCSS('color', BLUE_LIGHT);
    await expect(jump).toHaveCSS('text-decoration-line', 'none');
  });
});
