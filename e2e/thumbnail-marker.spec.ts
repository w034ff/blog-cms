import { test, expect, type Page } from '@playwright/test';
import { expectAutosaved, loadMarkdown } from './editor-authoring';

// The thumbnail mark (docs/link-card-requirements.md §22): two pseudo-elements on `.image-box`,
// visible only when rendered, with a conditional shape (the badge hides while selected, the line
// does not).

const MARKED = '/uploads/125b9697a8fd9e40c31b371d57e50da3c75a4b2dc91facd63adbbcef723c41ef.png';
const OTHER = '/uploads/6810c9ae66fa2ee74f08269d42e1a666703242a2ad98432ba09267dca3bca295.webp';

async function markFirstImage(page: Page): Promise<void> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, `![](${MARKED})\n\n本文\n\n![](${OTHER})\n\n後の段落\n`);
  await expect(page.locator('.ProseMirror img')).toHaveCount(2, { timeout: 20_000 });

  await page.locator('.ProseMirror img').first().click();
  await expect(page.locator('.image-bubble')).toBeVisible();
  await page
    .locator('.image-bubble')
    .getByRole('button', { name: 'サムネイルに設定', exact: true })
    .click();
  await expect(page.locator('input[name="thumbnail"]')).not.toHaveValue('');
}

// The two pseudo-elements of image `n`.
const readMark = (page: Page, n: number) =>
  page.evaluate((i) => {
    const box = document.querySelectorAll('.ProseMirror .image-box')[i] as HTMLElement;
    const badge = getComputedStyle(box, '::before');
    const line = getComputedStyle(box, '::after');
    // `content`: a missing ::before still reports a display.
    const drawn = (s: CSSStyleDeclaration) => s.content !== 'none' && s.display !== 'none';
    return {
      badgeShown: drawn(badge),
      badgeText: badge.content,
      lineShown: drawn(line),
      lineWidth: line.borderTopWidth,
      lineColor: line.borderTopColor,
      badgeColor: badge.backgroundColor,
    };
  }, n);

test('the marked image wears a worded badge and a coloured ring; the other wears neither', async ({
  page,
}) => {
  await markFirstImage(page);
  // Off the image: selected, the badge hides.
  await page.locator('.ProseMirror').click({ position: { x: 10, y: 400 } });
  await expect(page.locator('.image-bubble')).toBeHidden();

  const marked = await readMark(page, 0);
  expect(marked.badgeShown).toBe(true);
  expect(marked.badgeText).toContain('サムネイル');
  expect(marked.lineShown).toBe(true);
  // 2px carries over arbitrary picture content; it does not read as a frame because the colour is
  // saturated, not neutral (app/globals.css says why). Fuchsia, not red (destructive), asserted so a
  // future neutral fails.
  expect(marked.lineWidth).toBe('2px');
  expect(marked.lineColor).toBe('rgb(134, 25, 143)');
  expect(marked.badgeColor).toBe('rgb(134, 25, 143)');

  const other = await readMark(page, 1);
  expect(other.badgeShown).toBe(false);
  expect(other.lineShown).toBe(false);
});

// The asymmetry is the test (§22.1): the badge would sit under the menu on narrow pictures, which no
// selector can test, while the line runs where the menu never is, stating the thumbnail on touch
// with no tooltip. One selector, no JS.
test('selecting the marked image puts its badge away and keeps its line', async ({ page }) => {
  await markFirstImage(page);

  await page.locator('.ProseMirror img').first().click();
  await expect(page.locator('.image-bubble')).toBeVisible();

  const whileSelected = await readMark(page, 0);
  expect(whileSelected.badgeShown).toBe(false);
  expect(whileSelected.lineShown).toBe(true);
  // Still the mark's colour, not the selection's.
  expect(whileSelected.lineColor).toBe('rgb(134, 25, 143)');
  expect(whileSelected.lineWidth).toBe('2px');

  // The badge returns once deselected.
  await page.locator('.ProseMirror').click({ position: { x: 10, y: 400 } });
  await expect(page.locator('.image-bubble')).toBeHidden();
  const afterwards = await readMark(page, 0);
  expect(afterwards.badgeShown).toBe(true);
  expect(afterwards.lineShown).toBe(true);
});

// The toggle's `title` (tooltip and accessible name) states the state and the action; the visible
// word is 「サムネイル」 (§22.2), and with the badge away it is the only wording.
test('the toggle’s accessible name states the action, and flips with the state', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, `![](${MARKED})\n\n本文\n`);
  await expect(page.locator('.ProseMirror img')).toBeVisible({ timeout: 20_000 });

  const menu = page.locator('.image-bubble');
  await page.locator('.ProseMirror img').click();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: 'サムネイルに設定', exact: true })).toBeVisible();

  await menu.getByRole('button', { name: 'サムネイルに設定', exact: true }).click();
  await expect(page.locator('input[name="thumbnail"]')).not.toHaveValue('');
  await expect(menu.getByRole('button', { name: 'サムネイルを解除', exact: true })).toBeVisible();

  // And back: a toggle.
  await menu.getByRole('button', { name: 'サムネイルを解除', exact: true }).click();
  await expect(page.locator('input[name="thumbnail"]')).toHaveValue('');
  await expect(menu.getByRole('button', { name: 'サムネイルに設定', exact: true })).toBeVisible();
});

// The toggle must not scroll: `focus()` defaults to `scrollIntoView: true`, and a NodeSelection
// scrolled the block into view against the window, ignoring the sticky toolbar. The picture is
// selected first (Playwright's own scroll would be measured), then moved below the fold, the one
// geometry where anything can scroll.
test('pressing the thumbnail toggle does not scroll the page', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  const filler = Array.from({ length: 12 }, (_, i) => `段落${i}`).join('\n\n');
  await loadMarkdown(page, `${filler}\n\n![](${OTHER})\n\n${filler}\n`);
  await expect(page.locator('.ProseMirror img')).toBeVisible({ timeout: 20_000 });

  const picture = page.locator('.ProseMirror .image-box');
  const menu = page.locator('.image-bubble');
  await picture.click();
  await expect(menu).toBeVisible();

  const below = await picture.evaluate((el) => {
    window.scrollBy(0, el.getBoundingClientRect().top - 400);
    const rect = el.getBoundingClientRect();
    return { hangs: rect.bottom - window.innerHeight, scrollY: window.scrollY };
  });
  // The precondition, so a fixture change cannot quiet the test.
  expect(below.hangs).toBeGreaterThan(50);

  await menu.getByRole('button', { name: 'サムネイルに設定', exact: true }).click();
  await expect(page.locator('input[name="thumbnail"]')).not.toHaveValue('');
  expect(await page.evaluate(() => window.scrollY)).toBe(below.scrollY);

  // The other half, with focus still restored.
  await menu.getByRole('button', { name: 'サムネイルを解除', exact: true }).click();
  await expect(page.locator('input[name="thumbnail"]')).toHaveValue('');
  expect(await page.evaluate(() => window.scrollY)).toBe(below.scrollY);
  expect(
    await page.evaluate(() => {
      const el = document.querySelector('.ProseMirror') as Element & {
        editor: { isFocused: boolean };
      };
      return el.editor.isFocused;
    }),
  ).toBe(true);
});

// The mark survives a reload. The layout effect writing `editor.storage.thumbnailHighlight`
// (PostEditor.tsx) read a ref filled by a passive effect, still null on mount, and its deps never
// changed on a post only opened. Storage is read beside the mark to tell "not drawn" from
// "never arrived".
test('the badge is still on the marked image after a reload', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  // A paragraph first: otherwise `Selection.atStart` node-selects the image and the badge is hidden for
  // the wrong reason.
  await loadMarkdown(page, `本文\n\n![](${MARKED})\n\n後の段落\n`);
  await expect(page.locator('.ProseMirror img')).toBeVisible({ timeout: 20_000 });

  await page.locator('.ProseMirror img').click();
  await page
    .locator('.image-bubble')
    .getByRole('button', { name: 'サムネイルに設定', exact: true })
    .click();
  await page.getByLabel('タイトル').fill('バッジの再読込');
  await expectAutosaved(page);

  await page.reload();
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await expect(page.locator('.ProseMirror img')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('input[name="thumbnail"]')).toHaveValue(MARKED);

  await expect
    .poll(() =>
      page.evaluate(() => ({
        marked: document.querySelectorAll('.ProseMirror .image-block.thumbnail-image').length,
        path: (
          document.querySelector('.ProseMirror') as Element & {
            editor: { storage: { thumbnailHighlight: { path: string } } };
          }
        ).editor.storage.thumbnailHighlight.path,
      })),
    )
    .toEqual({ marked: 1, path: MARKED });
  // Nothing selected.
  await expect(page.locator('.ProseMirror .ProseMirror-selectednode')).toHaveCount(0);
  // The drawn mark, not just the class.
  expect(await readMark(page, 0)).toMatchObject({ badgeShown: true, lineShown: true });
});
