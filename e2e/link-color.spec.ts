import { test, expect, type Locator, type Page } from '@playwright/test';
import { expectAutosaved, expectPublished, loadMarkdown, ensureCategory } from './editor-authoring';
import { gotoPublished, publishedPath } from './published-post';

// `.prose a`'s own colour (docs/link-requirements.md §7.1). CSS only, and a generic selector, the
// shape that regresses what nobody watches: measured are the links that change and the anchors
// that must not. One post: a link; a footnote (reference, backref, popover jump), each with a rule
// this one loses to or outranks harmlessly; three headings for a ToC.
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

// A literal hex comes back as plain `rgb()`.
const BLUE_LIGHT = 'rgb(9, 105, 218)'; // #0969da
const BLUE_DARK = 'rgb(68, 147, 248)'; // #4493f8
const ACCENT_LIGHT = 'rgb(207, 34, 46)'; // #cf222e — `--accent`, the 強調 mark's colour, also a literal hex

// Palette colours come back as `lab(...)`; pinning those pins a serialization, so untouched elements
// are asserted as "not the new blue", the sharper claim for a rule that regresses by reaching.
function colorOf(locator: Locator): Promise<string> {
  return locator.evaluate((el) => getComputedStyle(el).color);
}

// Published, since one `.prose` rule covering both surfaces is shown only by looking at both.
async function publish(page: Page, title: string): Promise<string> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill(title);
  await loadMarkdown(page, SOURCE);
  await expect(page.locator('.ProseMirror a')).toHaveCount(1);

  await expectAutosaved(page);
  await ensureCategory(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);

  return publishedPath(page);
}

test('an ordinary link is blue on both surfaces, and keeps the underline it had', async ({
  page,
}) => {
  const href = await publish(page, 'Link colour spec');

  // The editor first: links never navigate there, and the card needs a caret already inside.
  const inEditor = page.locator('.ProseMirror a');
  await expect(inEditor).toHaveCSS('color', BLUE_LIGHT);

  // The underline stays at rest, the non-colour cue; the rule declares `color` only.
  await expect(inEditor).toHaveCSS('text-decoration-line', 'underline');
  await expect(inEditor).toHaveCSS('font-weight', '500');

  // The body is not blue, or the check above would pass with everything drifted blue.
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

  // (0,2,1) beats (0,1,1), and the blue is the same, so the claim is the underline: these hold it
  // back for hover, and a generic rule reaching them shows here first.
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

// Which existing `color` declarations the unlayered (0,1,1) rule now outranks: `.accent-emphasis`
// (0,1,0, `--accent`), and a link can carry 強調 (its `excludes` omits link). It loses on purpose: a
// text-decoration is painted in the declaring element's colour, so the underline turns red or the
// text turns blue (globals.css records why blue). A test, since the nesting decides it.
test('a link carrying the 強調 mark is one colour, text and underline', async ({ page }) => {
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
  await expect(inEditor).toHaveCSS('color', BLUE_LIGHT);
  // The line itself, from the element drawing it: the reported defect.
  await expect(page.locator('.ProseMirror a')).toHaveCSS('text-decoration-color', BLUE_LIGHT);
  await expect(page.locator('.ProseMirror a')).toHaveCSS('color', BLUE_LIGHT);
  // The weight survives; losing it too would leave 強調 doing nothing.
  await expect(inEditor).toHaveCSS('font-weight', '700');

  await expectAutosaved(page);
  await ensureCategory(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);
  await gotoPublished(page);

  // The published side rebuilds the nesting from markdown: a second measurement.
  await expect(page.locator('#post-body a .accent-emphasis')).toHaveCSS('color', BLUE_LIGHT);
  await expect(page.locator('#post-body a').first()).toHaveCSS('text-decoration-color', BLUE_LIGHT);
  await expect(page.locator('#post-body a').first()).toHaveCSS('color', BLUE_LIGHT);
});

// 強調 outside a link keeps its red, measured rather than read off the selector: the one rule that
// takes a colour away from a mark.
test('強調 outside a link keeps its red', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, '強調テキスト\n');
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: '強調' }).click();
  await expect(page.locator('.ProseMirror .accent-emphasis')).toHaveCSS('color', ACCENT_LIGHT);
});

test('the table of contents sits outside .prose and is untouched', async ({ page }) => {
  const href = await publish(page, 'Link colour spec — toc');
  await page.goto(href);

  // `:visible`: both ToC variants render with `aria-label='目次'`, the mobile one first and hidden; at
  // 1280px (past `toc:`) the rail is shown.
  const tocLink = page.locator('nav[aria-label="目次"]:visible .toc-link').first();
  await expect(tocLink).toBeVisible();

  // Still TocNav's own zinc-600: the ToC stays out of `.prose a` only by sitting outside the article
  // body (globals.css, above `#post-body h2`).
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

    // The dark rules sit in a different @media block, ordered only by specificity.
    await expect(page.locator('.prose a[data-footnote-ref]').first()).toHaveCSS(
      'text-decoration-line',
      'none',
    );
  });

  test('強調 on a link takes the dark blue, not the dark red', async ({ page }) => {
    // `color: inherit` serves both schemes, and in dark it must still beat `.accent-emphasis`, whose
    // `--accent` is the dark #f85149 there: (0,2,1) over (0,1,0). Editor only: the surfaces share the stack, the scheme is new.
    await page.goto('/admin/posts/new');
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();
    await editor.click();
    await loadMarkdown(page, '[強調リンク](https://example.com)\n');
    await page.keyboard.press('Control+a');
    await page.getByRole('button', { name: '強調' }).click();
    await expect(page.locator('.ProseMirror a .accent-emphasis')).toHaveCSS('color', BLUE_DARK);
    await expect(page.locator('.ProseMirror a')).toHaveCSS('text-decoration-color', BLUE_DARK);
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

    // The popover carries `prose`, so `.prose a` beats `.footnote-popover-jump`: the one place the rule
    // wins. Harmless twice: the same colour, and its `text-decoration: none` stands.
    const jump = page.locator('.footnote-popover--pinned .footnote-popover-jump');
    await expect(jump).toBeVisible();
    await expect(jump).toHaveCSS('color', BLUE_LIGHT);
    await expect(jump).toHaveCSS('text-decoration-line', 'none');
  });
});
