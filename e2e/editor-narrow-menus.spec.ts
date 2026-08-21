import { test, expect, devices, type Page } from '@playwright/test';
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
//
// **What is measured is the margin, not the overflow.** A menu whose right edge lands exactly on
// the viewport's satisfies "does not overflow" and still shows as cut off on a phone, because a
// device has several ways to disagree with `100vw` by a pixel or two — a rounded corner, a
// safe-area inset, a rounded layout viewport. Measured on an emulated phone before this: left 16px,
// right 412px of a 412px screen. So the cap and `shift` both leave 8px and the specs hold them to
// it (§5.5.19).
const EDGE = 8;

async function margins(page: Page, selector: string): Promise<{ smallest: number; boxes: number }> {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel) as HTMLElement;
    const vw = document.documentElement.clientWidth;
    const boxes = [root, ...root.querySelectorAll('button, input')];
    let smallest = Number.POSITIVE_INFINITY;
    for (const el of boxes) {
      const r = el.getBoundingClientRect();
      smallest = Math.min(smallest, Math.round(r.left), Math.round(vw - r.right));
    }
    return { smallest, boxes: boxes.length };
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

    const measured = await margins(page, '.link-bubble');
    expect(measured.boxes).toBeGreaterThan(2); // the two fields and 適用 are in the sample
    expect(measured.smallest).toBeGreaterThanOrEqual(EDGE);
  });

  test(`the table toolbar's controls stay on a ${width}px screen (12b)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openEditor(page);
    await loadMarkdown(page, TABLE_MD);
    await page.locator('.ProseMirror td').first().click();
    await expect(page.locator('.table-toolbar')).toBeVisible();

    const measured = await margins(page, '.table-toolbar');
    expect(measured.smallest).toBeGreaterThanOrEqual(EDGE);
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
    expect((await margins(page, '.link-bubble')).smallest).toBeGreaterThanOrEqual(EDGE);

    await caretInto('.ProseMirror p a');
    await expect(page.getByRole('group', { name: 'リンク' })).toBeVisible();
    await expect(
      page.locator('.link-bubble').getByRole('button', { name: 'カードにする' }),
    ).toBeVisible();
    expect((await margins(page, '.link-bubble')).smallest).toBeGreaterThanOrEqual(EDGE);
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

// The report that produced the margin (2026-08-21): the overflow was visible **on a phone only**.
// A narrow desktop window is not the same environment — `isMobile` brings the device's viewport
// meta handling, a device pixel ratio that is not 1, and touch — and the failure lived in the last
// 8px, which is exactly the width a rounding or an inset can eat. So one case runs emulated.
// Listed rather than spread: `defaultBrowserType` and `channel` both force a new worker from inside
// a describe (Playwright refuses), and the project already runs system Chrome. What is wanted from
// the descriptor is these five.
const PIXEL_7 = devices['Pixel 7'];
const PHONE = {
  viewport: PIXEL_7.viewport,
  userAgent: PIXEL_7.userAgent,
  deviceScaleFactor: PIXEL_7.deviceScaleFactor,
  isMobile: PIXEL_7.isMobile,
  hasTouch: PIXEL_7.hasTouch,
};

// **The page-level half of the same claim**: no menu may make the document wider than the screen.
// Margins are measured per element above, and that leaves a gap — a tooltip, the heading list, or
// anything else a menu hangs off itself is not in that sample, and any of them widening the page
// turns the editor into a surface that pans sideways while the author types. `scrollWidth` answers
// for all of them at once, which is why this is stated as its own criterion rather than folded into
// the margins (§5.5.19).
async function pageWidth(page: Page): Promise<{ scroll: number; client: number }> {
  return page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
}

for (const width of [390, 320]) {
  test(`no menu widens the page at ${width}px (12f)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openEditor(page);
    await loadMarkdown(page, `${MD}\n${TABLE_MD}`);

    // `<=`, not `===`: with a classic scrollbar the document is narrower than the viewport box, and
    // what is being ruled out is only the other direction.
    const clean = await pageWidth(page);
    expect(clean.scroll).toBeLessThanOrEqual(clean.client);

    // The card, in both of its shapes, and then with the heading list hanging off it.
    await setRange(page, 3, 3);
    await expect(page.getByRole('group', { name: 'リンク' })).toBeVisible();
    expect((await pageWidth(page)).scroll).toBeLessThanOrEqual(clean.client);

    await page.locator('.link-bubble').getByRole('button', { name: '編集' }).click();
    await expect(page.getByRole('textbox', { name: 'リンク先' })).toBeVisible();
    expect((await pageWidth(page)).scroll).toBeLessThanOrEqual(clean.client);

    await page.getByRole('textbox', { name: 'リンク先' }).fill('#');
    await expect(page.locator('.link-bubble')).toBeVisible();
    expect((await pageWidth(page)).scroll).toBeLessThanOrEqual(clean.client);

    // And the table's toolbar, the other menu that outgrew the screen.
    await page.keyboard.press('Escape');
    await page.locator('.ProseMirror td').first().click();
    await expect(page.locator('.table-toolbar')).toBeVisible();
    expect((await pageWidth(page)).scroll).toBeLessThanOrEqual(clean.client);
  });
}

test.describe('on an emulated phone', () => {
  test.use(PHONE);

  test('the card keeps its margin across the same move (12e)', async ({ page }) => {
    await openEditor(page);
    await loadMarkdown(
      page,
      `## 見出しの中の[リンク](${LONG_HREF})\n\n[単独行のリンクはカードにできる](${LONG_HREF})\n`,
    );
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
    expect((await margins(page, '.link-bubble')).smallest).toBeGreaterThanOrEqual(EDGE);

    await caretInto('.ProseMirror p a');
    await expect(
      page.locator('.link-bubble').getByRole('button', { name: 'カードにする' }),
    ).toBeVisible();
    expect((await margins(page, '.link-bubble')).smallest).toBeGreaterThanOrEqual(EDGE);
  });
});

// 360px, and emulated, because that pair is what the failure needed (2026-08-21). The offender was
// an `EditorTooltip`: invisible (`opacity: 0`), laid out anyway, centred under its button and wide
// enough to hang past the right edge — 366px of document against a 360px screen, with nothing
// visible out of place. Whether any button lands in that position depends on where the toolbar
// wraps, which is why 412px, 390px, 375px and 320px are all clean; and the rule that fixes it keys
// on `hover: none`, so a desktop viewport of the same width does not exercise it.
test.describe('on an emulated phone at 360px', () => {
  test.use({ ...PHONE, viewport: { width: 360, height: 800 } });

  test('nothing invisible widens the page (12g)', async ({ page }) => {
    await openEditor(page);
    // Before anything is opened: the toolbar alone was enough.
    expect((await pageWidth(page)).scroll).toBeLessThanOrEqual(360);

    await loadMarkdown(page, `${MD}\n${TABLE_MD}`);
    expect((await pageWidth(page)).scroll).toBeLessThanOrEqual(360);

    await setRange(page, 3, 3);
    await expect(page.getByRole('group', { name: 'リンク' })).toBeVisible();
    expect((await pageWidth(page)).scroll).toBeLessThanOrEqual(360);

    await page.locator('.link-bubble').getByRole('button', { name: '編集' }).click();
    await expect(page.getByRole('textbox', { name: 'リンク先' })).toBeVisible();
    await page.getByRole('textbox', { name: 'リンク先' }).fill('#');
    await expect(page.locator('.link-bubble')).toBeVisible();
    expect((await pageWidth(page)).scroll).toBeLessThanOrEqual(360);

    await page.keyboard.press('Escape');
    await page.locator('.ProseMirror td').first().click();
    await expect(page.locator('.table-toolbar')).toBeVisible();
    expect((await pageWidth(page)).scroll).toBeLessThanOrEqual(360);
  });
});
