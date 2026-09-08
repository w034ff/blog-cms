import { test, expect, type Page } from '@playwright/test';
import { loadMarkdown } from './editor-authoring';

// How the editor says which image is the post's thumbnail (docs/link-card-requirements.md §22).
//
// The mark is two pseudo-elements on `.image-box`, so nothing about it exists in the document,
// the transaction or the saved markdown — only a rendered read can see it at all. It is also
// the one piece of this chrome with a *conditional* shape (the badge hides while the block is
// selected; the line does not), and a condition nobody measures is a condition that quietly
// stops holding.

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
      lineColor: line.borderTopColor,
      badgeColor: badge.backgroundColor,
    };
  }, n);

test('the marked image wears a worded badge and a coloured ring; the other wears neither', async ({
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
  // 2px carries over arbitrary picture content; it does not read as a frame because the colour is
  // saturated, not neutral (app/globals.css says why). Both halves of the mark wear the one colour,
  // and it is fuchsia rather than red because red is this editor's destructive-control signal —
  // asserted, not assumed, since the whole point is that a future neutral would fail silently.
  expect(marked.lineWidth).toBe('2px');
  expect(marked.lineColor).toBe('rgb(134, 25, 143)');
  expect(marked.badgeColor).toBe('rgb(134, 25, 143)');

  const other = await readMark(page, 1);
  expect(other.badgeShown).toBe(false);
  expect(other.lineShown).toBe(false);
});

// The halves part company here, and the asymmetry is the whole test (§22.1): the badge is in the
// corner the menu is fitted into and would be covered there — for pictures narrower than 214px,
// which no selector can test for — while the line runs along the picture's edge, where the menu
// never is. So the badge hides and the line stays, and the line is what states the thumbnail while
// the author is acting on the picture (the toggle's wording is a tooltip now, and there are no
// tooltips under `hover: none`). Both classes land on the same element (`Decoration.node`'s and
// prosemirror-view's), which is why this is one selector and no JS.
test('selecting the marked image puts its badge away and keeps its line', async ({ page }) => {
  await markFirstImage(page);

  await page.locator('.ProseMirror img').first().click();
  await expect(page.locator('.image-bubble')).toBeVisible();

  const whileSelected = await readMark(page, 0);
  expect(whileSelected.badgeShown).toBe(false);
  expect(whileSelected.lineShown).toBe(true);
  // Still the mark's own colour, not a ring inherited from the selection: hiding the badge must not
  // take the line's identity with it.
  expect(whileSelected.lineColor).toBe('rgb(134, 25, 143)');
  expect(whileSelected.lineWidth).toBe('2px');

  // And the badge comes back once the selection leaves.
  await page.locator('.ProseMirror').click({ position: { x: 10, y: 400 } });
  await expect(page.locator('.image-bubble')).toBeHidden();
  const afterwards = await readMark(page, 0);
  expect(afterwards.badgeShown).toBe(true);
  expect(afterwards.lineShown).toBe(true);
});

// The toggle says both what is true now and what pressing it will do. Its visible word is the bare
// 「サムネイル」 (§22.2), so the sentence lives on `title` — the tooltip, and the accessible name
// `getByRole` matches below. It is the only place the state is legible in *words* while the block
// is selected, since the badge steps aside there (the line stays, but a colour has to be learnt);
// a name that did not change would leave the `active` fill carrying the state alone.
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

  // And back, so the flip is a toggle rather than a one-way relabel.
  await menu.getByRole('button', { name: 'サムネイルを解除', exact: true }).click();
  await expect(page.locator('input[name="thumbnail"]')).toHaveValue('');
  await expect(menu.getByRole('button', { name: 'サムネイルに設定', exact: true })).toBeVisible();
});

// Pressing the toggle must not move the page.
//
// @tiptap/core's focus command defaults to `scrollIntoView: true`, and a NodeSelection sends it
// down the `delayedFocus` branch, so the plain `editor.chain().focus()` this button needs for
// focus restoration also ran `editor.commands.scrollIntoView()` in a rAF. prosemirror-view then
// scrolls the whole block into view against the *window*, which knows nothing about the sticky
// toolbar. Reported 2026-09-08.
//
// The setup is the measurement: the picture is selected FIRST (Playwright scrolls a big target
// into view before clicking it, and that auto-scroll would otherwise be what the numbers show),
// and only then is the page moved so the picture's bottom sits below the fold — the one geometry
// in which prosemirror-view has anything to scroll. Without it this passes with the bug present.
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
  // The precondition itself, so the test cannot go quiet if the fixture's height ever changes.
  expect(below.hangs).toBeGreaterThan(50);

  await menu.getByRole('button', { name: 'サムネイルに設定', exact: true }).click();
  await expect(page.locator('input[name="thumbnail"]')).not.toHaveValue('');
  expect(await page.evaluate(() => window.scrollY)).toBe(below.scrollY);

  // The other half of the toggle takes the same path, and focus is still where the press left it —
  // dropping the scroll must not have dropped the refocus this button exists to do.
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

// The mark has to survive a reload, and until 2026-09-08 it did not: a post whose thumbnail was
// already chosen came back with the badge missing, and no later edit brought it back.
//
// The write into `editor.storage.thumbnailHighlight` is a layout effect (PostEditor.tsx), and it
// was reading the editor out of `editorRef` — a ref filled by a *passive* effect. Every layout
// effect in a commit runs before any passive one, so on the mount commit the ref is still null and
// nothing was written; the effect's deps (`[editor, thumbnail]`) then never change again on a post
// that is only opened. Setting one in the session hid it, because that does change `thumbnail`.
//
// So this test loads a saved post rather than a fresh one — the same round trip
// e2e/thumbnail.spec.ts makes for the column, asserted here on the mark. Reading the storage
// alongside the rendered mark is what separates "the decoration is not drawn" from "the path never
// arrived": it was the second.
test('the badge is still on the marked image after a reload', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  // A paragraph BEFORE the image, and that is load-bearing: a document that opens with one puts
  // `Selection.atStart` on the image itself (a selectable atom is what `findFrom` stops at), and a
  // node-selected picture is *supposed* to have its badge put away — the test above measures that.
  // With the image first this reads as "the badge is missing after a reload" for the wrong reason,
  // which is what it did on the first run.
  await loadMarkdown(page, `本文\n\n![](${MARKED})\n\n後の段落\n`);
  await expect(page.locator('.ProseMirror img')).toBeVisible({ timeout: 20_000 });

  await page.locator('.ProseMirror img').click();
  await page
    .locator('.image-bubble')
    .getByRole('button', { name: 'サムネイルに設定', exact: true })
    .click();
  await page.getByLabel('タイトル').fill('バッジの再読込');
  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });

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
  // Nothing is selected, so the conditional shape above is not what is being read here.
  await expect(page.locator('.ProseMirror .ProseMirror-selectednode')).toHaveCount(0);
  // And it is the drawn mark, not just the class — the same read the tests above make.
  expect(await readMark(page, 0)).toMatchObject({ badgeShown: true, lineShown: true });
});
