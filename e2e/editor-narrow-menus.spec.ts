import { test, expect, type Page } from '@playwright/test';
import { loadMarkdown, setRange } from './editor-authoring';

// The editor's two floating menus on a phone (docs/link-requirements.md §5.5.19,
// docs/table-requirements.md §12).
//
// Browser-only, and not merely because the editor is: what broke here is a box wider than the
// screen, which nothing about the markup or the class list states. Both menus are placed by
// floating-ui with `shift`, so the failure did not look like a positioning bug either — both were
// pinned to the left edge, having been shifted as far as they could go, and still ran off the right.
//
// Reported 2026-08-21. Measured before the fix: the link card's edit layout 403px and the table
// toolbar 441px, against 390px and 320px screens.
const MD = '前[リンク](https://example.com "タイトル")後\n';
const TABLE_MD = '| A | B | C |\n| --- | --- | --- |\n| x | y | z |\n';
// Long enough that the card's href line runs into its own truncation, which is where the display
// card is at its widest (measured 437px with 「カードにする」 present, 407px without).
const LONG_HREF =
  'https://example.com/very/long/path/that/does/not/fit/in/the/card/at/all/index.html';

// Every control's own box, not just its container's: the container fitting says nothing about the
// button inside it that overflowed, and 適用 — the only press that commits an edit — was exactly
// that button.
async function fits(page: Page, selector: string): Promise<{ overflow: number; boxes: number }> {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel) as HTMLElement;
    const vw = document.documentElement.clientWidth;
    const boxes = [root, ...root.querySelectorAll('button, input')];
    let overflow = 0;
    for (const el of boxes) {
      const r = el.getBoundingClientRect();
      overflow = Math.max(overflow, Math.round(r.right - vw), Math.round(-r.left));
    }
    return { overflow, boxes: boxes.length };
  }, selector);
}

async function openEditor(page: Page) {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
}

for (const width of [390, 320]) {
  test(`the link card and its 適用 stay on a ${width}px screen (12a)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openEditor(page);
    await loadMarkdown(page, MD);
    await setRange(page, 3, 3);
    const card = page.getByRole('group', { name: 'リンク' });
    await expect(card).toBeVisible();
    // The edit layout is the wide one; display mode fitted all along (measured 204px).
    await card.getByRole('button', { name: '編集' }).click();
    await expect(card.getByRole('textbox', { name: 'リンク先' })).toBeVisible();

    const measured = await fits(page, '.link-bubble');
    expect(measured.boxes).toBeGreaterThan(2); // the two fields and 適用 are in the sample
    expect(measured.overflow).toBe(0);
  });

  test(`the table toolbar's controls stay on a ${width}px screen (12b)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openEditor(page);
    await loadMarkdown(page, TABLE_MD);
    await page.locator('.ProseMirror td').first().click();
    await expect(page.locator('.table-toolbar')).toBeVisible();

    const measured = await fits(page, '.table-toolbar');
    expect(measured.overflow).toBe(0);
    // It fits by wrapping, which is the half a width assertion alone would not catch: the row is
    // taller than one button because `flex-wrap` finally has a width to wrap against.
    const rows = await page
      .locator('.table-toolbar')
      .evaluate(
        (el) =>
          el.getBoundingClientRect().height /
          (el.querySelector('button') as HTMLElement).getBoundingClientRect().height,
      );
    expect(rows).toBeGreaterThan(1.5);
  });
}

// Reported 2026-08-21, after the caps above: 「カード化のボタンがないバブルを開いてからカード化のある
// バブルを開くと右端が画面外に出る」. A link in a heading is not offered 「カードにする」 and a
// line-alone link is, so moving between the two changes the card's width by one button (~30px)
// *after* the plugin has placed it. That is the shape a stale placement would take, so the sequence
// — not either card alone — is what this measures, and it measures the card's children rather than
// its box: a capped container can still be overflowed by what is inside it.
for (const width of [390, 320]) {
  test(`the card fits after moving from a link that cannot become one (${width}px, 12d)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await openEditor(page);
    await loadMarkdown(
      page,
      `## 見出しの中の[リンク](${LONG_HREF})\n\n[単独行のリンクはカードにできる](${LONG_HREF})\n`,
    );

    // Caret by selection rather than by click: at these widths the first card can cover the line
    // below it, and a click that lands on the card measures the wrong thing (or times out).
    const caretInto = (selector: string) =>
      page.evaluate((sel) => {
        const a = document.querySelector(sel) as HTMLElement;
        const range = document.createRange();
        range.setStart(a.firstChild as ChildNode, 2);
        range.collapse(true);
        const selection = window.getSelection() as Selection;
        selection.removeAllRanges();
        selection.addRange(range);
        (document.querySelector('.ProseMirror') as HTMLElement).focus();
      }, selector);

    await caretInto('.ProseMirror h2 a');
    await expect(page.getByRole('group', { name: 'リンク' })).toBeVisible();
    expect(
      await page.locator('.link-bubble').getByRole('button', { name: 'カードにする' }).count(),
    ).toBe(0);
    expect((await fits(page, '.link-bubble')).overflow).toBe(0);

    await caretInto('.ProseMirror p a');
    await expect(page.getByRole('group', { name: 'リンク' })).toBeVisible();
    await expect(
      page.locator('.link-bubble').getByRole('button', { name: 'カードにする' }),
    ).toBeVisible();
    expect((await fits(page, '.link-bubble')).overflow).toBe(0);
  });
}

test('a wide screen is left as it was (12c)', async ({ page }) => {
  // The caps are `max-width`, so nothing about them should reach a desktop card: measured at 402px
  // and 441px, which is what these two were before §5.5.19 (403px — the 1px is the grid's width
  // now being declared rather than derived from the field's).
  await page.setViewportSize({ width: 1280, height: 800 });
  await openEditor(page);
  await loadMarkdown(page, MD);
  await setRange(page, 3, 3);
  const card = page.getByRole('group', { name: 'リンク' });
  await card.getByRole('button', { name: '編集' }).click();
  await expect(card.getByRole('textbox', { name: 'リンク先' })).toBeVisible();
  const cardWidth = await page
    .locator('.link-bubble')
    .evaluate((el) => Math.round(el.getBoundingClientRect().width));
  expect(cardWidth).toBeGreaterThan(390);

  await openEditor(page);
  await loadMarkdown(page, TABLE_MD);
  await page.locator('.ProseMirror td').first().click();
  const toolbar = page.locator('.table-toolbar');
  await expect(toolbar).toBeVisible();
  const oneRow = await toolbar.evaluate(
    (el) =>
      el.getBoundingClientRect().height /
      (el.querySelector('button') as HTMLElement).getBoundingClientRect().height,
  );
  expect(oneRow).toBeLessThan(1.5);
});
