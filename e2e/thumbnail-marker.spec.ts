import { test, expect, type Page } from '@playwright/test';
import { loadMarkdown } from './editor-authoring';

// How the editor says which image is the post's thumbnail (docs/link-card-requirements.md §22).
//
// The mark is two pseudo-elements on `.image-box`, so nothing about it exists in the document,
// the transaction or the saved markdown — only a rendered read can see it at all. It is also
// the one piece of this chrome with a *conditional* shape (it hides while the block is
// selected), and a condition nobody measures is a condition that quietly stops holding.

const MARKED = '/uploads/3cf43f6c9f92a311cb0de38736934c4efc6aa3d1d0968206d837e593fbe99107.png';
const OTHER = '/uploads/531f1bd7bc8be82b6f3aa910ff3c6ec45d3572033db26d10bec768eae58a6652.webp';

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

// Reads the two pseudo-elements off the picture box of image `n`.
const readMark = (page: Page, n: number) =>
  page.evaluate((i) => {
    const box = document.querySelectorAll('.ProseMirror .image-box')[i] as HTMLElement;
    const badge = getComputedStyle(box, '::before');
    const line = getComputedStyle(box, '::after');
    // `content` rather than `display`: an element with no ::before at all still reports a
    // display, so a display-only check reads "shown" for a picture that has no mark.
    const drawn = (s: CSSStyleDeclaration) => s.content !== 'none' && s.display !== 'none';
    return {
      badgeShown: drawn(badge),
      badgeText: badge.content,
      lineShown: drawn(line),
      lineWidth: line.borderTopWidth,
    };
  }, n);

test('the marked image wears a worded badge and a hairline; the other wears neither', async ({
  page,
}) => {
  await markFirstImage(page);
  // Move the selection off the marked image — the mark hides while it is selected, which the
  // next test is about, so this one has to look at it unselected.
  await page.locator('.ProseMirror').click({ position: { x: 10, y: 400 } });
  await expect(page.locator('.image-bubble')).toBeHidden();

  const marked = await readMark(page, 0);
  expect(marked.badgeShown).toBe(true);
  expect(marked.badgeText).toContain('サムネイル');
  expect(marked.lineShown).toBe(true);
  // Subordinate to the badge by weight — at 2px a neutral line reads as a frame instead.
  expect(marked.lineWidth).toBe('1px');

  const other = await readMark(page, 1);
  expect(other.badgeShown).toBe(false);
  expect(other.lineShown).toBe(false);
});

// The condition, and the reason it is safe to hide: the menu is on the picture at that moment
// and says the state itself, and the blue selection ring frames the picture. Both classes land
// on the same element (`Decoration.node`'s and prosemirror-view's), which is why this is one
// selector and no JS.
test('selecting the marked image puts its badge and line away', async ({ page }) => {
  await markFirstImage(page);

  await page.locator('.ProseMirror img').first().click();
  await expect(page.locator('.image-bubble')).toBeVisible();

  const whileSelected = await readMark(page, 0);
  expect(whileSelected.badgeShown).toBe(false);
  expect(whileSelected.lineShown).toBe(false);

  // And comes back once the selection leaves.
  await page.locator('.ProseMirror').click({ position: { x: 10, y: 400 } });
  await expect(page.locator('.image-bubble')).toBeHidden();
  const afterwards = await readMark(page, 0);
  expect(afterwards.badgeShown).toBe(true);
  expect(afterwards.lineShown).toBe(true);
});

// The toggle says both what is true now and what pressing it will do, the way 削除 beside it
// does. It is the only place the state is legible while the block is selected, since the badge
// and the line step aside there — so a label that did not change would leave the `active` fill
// carrying that alone.
test('the toggle’s label states the action, and flips with the state', async ({ page }) => {
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

  // And back, so the flip is a toggle rather than a one-way relabel.
  await menu.getByRole('button', { name: 'サムネイルを解除', exact: true }).click();
  await expect(page.locator('input[name="thumbnail"]')).toHaveValue('');
  await expect(menu.getByRole('button', { name: 'サムネイルに設定', exact: true })).toBeVisible();
});
