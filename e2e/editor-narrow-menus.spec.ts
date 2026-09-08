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

// The toolbar's height in buttons: 1 while it is on one line, ~2 once `flex-wrap` has taken over.
// A ratio rather than a pixel height, so a change in the button's own padding does not read as a
// wrap (docs/table-requirements.md §12, §12.1).
async function toolbarRows(page: Page): Promise<number> {
  return page
    .locator('.table-toolbar')
    .evaluate(
      (el) =>
        el.getBoundingClientRect().height /
        (el.querySelector('button') as HTMLElement).getBoundingClientRect().height,
    );
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
    // Below `sm` the four row/column buttons carry the short labels (§12.1), which is what decides
    // whether the toolbar needs a second line at all. Asserted from `innerText`, because the long
    // label is in the DOM at every width — it is `display: none` that picks between them. The signs
    // are full-width (`＋`, not `+`), which is the author's choice and costs 16px (§12.1).
    await expect(
      page.locator('.table-toolbar').getByRole('button', { name: '行を追加' }),
    ).toHaveText('＋行', { useInnerText: true });
    // How it fits is now a function of the width, and both halves matter. 390px is one line since
    // the labels shortened (measured 327px against a cap of 358px); 320px still wraps, and that is
    // what keeps `flex-wrap` load-bearing rather than vestigial — the cap there is 288px.
    const rows = await toolbarRows(page);
    if (width === 320) expect(rows).toBeGreaterThan(1.5);
    else expect(rows).toBeLessThan(1.5);
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
  expect(await toolbarRows(page)).toBeLessThan(1.5);
  // No ring here: it is `hover: none` that asks for one, and this context has a mouse (§12.2).
  expect(
    await toolbar
      .locator('button')
      .first()
      .evaluate((el) => getComputedStyle(el).boxShadow),
  ).toBe('none');
  // And the words come back above `sm` — the short labels are for the screen that cannot hold
  // these, not a simplification of the toolbar (§12.1).
  await expect(toolbar.getByRole('button', { name: '行を追加' })).toHaveText('行を追加', {
    useInnerText: true,
  });
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

  test('the table toolbar is one line, and its names are still words (12i)', async ({ page }) => {
    // The width the short labels were asked for. Measured: 315px of toolbar against a 328px cap —
    // one line, where the long labels needed 441px and two (§12.1). The margin is thin on purpose:
    // full-width signs at the buttons' desktop padding come to 343px and wrap here, which is why
    // the padding below `sm` is 6px and why this case is at 360px rather than at 390px.
    await openEditor(page);
    await loadMarkdown(page, TABLE_MD);
    await page.locator('.ProseMirror td').first().click();
    await expect(page.locator('.table-toolbar')).toBeVisible();

    const toolbar = page.locator('.table-toolbar');
    for (const [name, short] of [
      ['行を追加', '＋行'],
      ['行を削除', '－行'],
      ['列を追加', '＋列'],
      ['列を削除', '－列'],
    ]) {
      // Found by its accessible name and asserted on its visible text: the two differ here on
      // purpose, because `－列` read aloud is not an instruction. That the query resolves at all is
      // the half that protects screen readers — and the half the other table specs depend on.
      await expect(toolbar.getByRole('button', { name })).toHaveText(short, { useInnerText: true });
    }
    expect(await toolbarRows(page)).toBeLessThan(1.5);
    expect((await margins(page, '.table-toolbar')).smallest).toBeGreaterThanOrEqual(EDGE);
  });

  test('every toolbar button is outlined, and the outline costs no width (12j)', async ({
    page,
  }) => {
    // Without hover there is no `hover:bg-zinc-100`, so the buttons are bare text in a row and
    // nothing shows where one ends (§12.2). Both halves are asserted here because they are one
    // decision: a `border` would draw the same line and take the row back to two lines, which is
    // the width §12.1 had just bought — so what is pinned is an inset shadow, and the row staying
    // on one line is how a border would be caught.
    await openEditor(page);
    await loadMarkdown(page, TABLE_MD);
    await page.locator('.ProseMirror td').first().click();
    await expect(page.locator('.table-toolbar')).toBeVisible();

    const shadows = await page
      .locator('.table-toolbar button')
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).boxShadow));
    expect(shadows.length).toBeGreaterThan(4);
    expect(shadows.every((s) => s.includes('inset'))).toBe(true);
    // The main toolbar takes the same rule from the same class, which is the point of putting it
    // on `ToolbarButton` rather than on this menu — and every control there, not just the ones
    // that are `<button>`s. 画像 is a `<label>` around a hidden file input, styled by hand to look
    // like the buttons beside it, and it was the one control in the row left without an outline
    // (§12.2). Asserted by tag, so a future control that copies the same shape has to opt in too.
    const main = await page.locator('.sticky .toolbar-button').evaluateAll((els) =>
      els.map((el) => ({
        tag: el.tagName,
        ring: getComputedStyle(el).boxShadow.includes('inset'),
      })),
    );
    expect(main.length).toBeGreaterThan(8);
    expect(main.every((c) => c.ring)).toBe(true);
    expect(main.some((c) => c.tag === 'LABEL')).toBe(true);

    expect(await toolbarRows(page)).toBeLessThan(1.5);
    expect((await margins(page, '.table-toolbar')).smallest).toBeGreaterThanOrEqual(EDGE);
  });

  test('every pressable box in the editor chrome is 40px tall (12k)', async ({ page }) => {
    // §12.3. A number that rots silently: nothing about the markup states it, and the buttons that
    // fell short were the ones whose padding is written per-component — so this measures the boxes
    // rather than looking for the rule. Four hooks carry it (`.toolbar-button`, `.dropdown-item`,
    // `.link-bubble-open`, and the card head's own rule) and each is represented below, because a
    // class dropped from one component is exactly the regression this catches.
    const FLOOR = 40;
    const shortest = (page: Page, selector: string) =>
      page.locator(selector).evaluateAll((els) =>
        els.map((el) => {
          const box = el.getBoundingClientRect();
          return { h: box.height, w: box.width };
        }),
      );

    await openEditor(page);
    const main = await shortest(page, '.sticky .toolbar-button');
    expect(main.length).toBeGreaterThan(8);
    expect(Math.min(...main.map((b) => b.h))).toBeGreaterThanOrEqual(FLOOR);

    // Undo and redo take the floor in both directions (§12.4): they are the one pair whose width
    // costs no row, and squares are what they are drawn as. Asserted here rather than in
    // editor-history-buttons.spec.ts because it is this file that runs under `hover: none`.
    const history = await shortest(page, '.sticky .toolbar-button-history');
    expect(history).toHaveLength(2);
    expect(Math.min(...history.map((b) => Math.min(b.h, b.w)))).toBeGreaterThanOrEqual(FLOOR);

    // A dropdown's rows are not `.toolbar-button` — they take the height from their own class, and
    // §12.2 deliberately leaves them out of the ring, so the two rules have to be checked apart.
    await page.getByRole('button', { name: 'リスト' }).click();
    const items = await shortest(page, '.dropdown-item');
    expect(items.length).toBeGreaterThan(1);
    expect(Math.min(...items.map((b) => b.h))).toBeGreaterThanOrEqual(FLOOR);
    await page.keyboard.press('Escape');

    await loadMarkdown(page, TABLE_MD);
    await page.locator('.ProseMirror td').first().click();
    await expect(page.locator('.table-toolbar')).toBeVisible();
    const table = await shortest(page, '.table-toolbar button');
    expect(Math.min(...table.map((b) => b.h))).toBeGreaterThanOrEqual(FLOOR);

    // The link bubble's first line opens a tab and is a bare `<button>`, which is why it was the
    // shortest box in the editor at 20px (§12.3). Its round neighbours are squares and take the
    // floor in both dimensions or they come out pills.
    await openEditor(page);
    await loadMarkdown(page, MD);
    await setRange(page, 3, 3);
    await expect(page.locator('.link-bubble')).toBeVisible();
    const href = await shortest(page, '.link-bubble-open');
    expect(href).toHaveLength(1);
    expect(href[0].h).toBeGreaterThanOrEqual(FLOOR);
    const round = await shortest(page, '.link-bubble .toolbar-button-round');
    expect(round.length).toBeGreaterThan(1);
    expect(Math.min(...round.map((b) => Math.min(b.h, b.w)))).toBeGreaterThanOrEqual(FLOOR);

    // And the icon sits at the circle's centre. Growing a box is not the same as centring what is
    // in it: the icon is a block-level `<svg>`, so widening the button pushed all 12px to its
    // right (6px left, 18px right) until the rule added flex — reported the day it shipped, and
    // invisible to a size assertion. Measured per side rather than against the centre, so a
    // one-sided padding change is what fails.
    const offsets = await page.locator('.link-bubble .toolbar-button-round').evaluateAll((els) =>
      els.map((el) => {
        const box = el.getBoundingClientRect();
        const icon = el.querySelector('svg')!.getBoundingClientRect();
        return {
          x: icon.left - box.left - (box.right - icon.right),
          y: icon.top - box.top - (box.bottom - icon.bottom),
        };
      }),
    );
    for (const o of offsets) {
      expect(Math.abs(o.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(o.y)).toBeLessThanOrEqual(1);
    }

    // The card's band, which loses its labels at this width and is icons alone — 23x23 before
    // §12.3, the one box in the editor under WCAG 2.2 SC 2.5.8's 24px floor.
    await openEditor(page);
    await loadMarkdown(
      page,
      '<div class="link-card" data-href="/posts/second-post"></div>\n\n本文\n',
    );
    await expect(page.locator('.link-card-head button').first()).toBeVisible();
    const head = await shortest(page, '.link-card-head button');
    expect(head).toHaveLength(3);
    expect(Math.min(...head.map((b) => Math.min(b.h, b.w)))).toBeGreaterThanOrEqual(FLOOR);

    // And the embed's band, which is exempt — the opposite assertion, because the exemption is a
    // decision and not an oversight (§12.3). Its one button carries a label and is wide enough
    // without the floor; taking the floor filled the 2.2em band exactly and left the ring sitting
    // on the player. Measured as the gap, since that is the thing that was reported.
    await openEditor(page);
    await loadMarkdown(
      page,
      '<div class="embed" data-href="https://www.youtube.com/watch?v=hDPybQwAuVo"></div>\n\n本文\n',
    );
    await expect(page.locator('.embed-view iframe')).toBeVisible();
    const gap = await page.locator('.embed-view').evaluate((view) => {
      const button = view.querySelector('.embed-head button')!.getBoundingClientRect();
      const frame = view.querySelector('.embed-frame')!.getBoundingClientRect();
      return frame.top - button.bottom;
    });
    expect(gap).toBeGreaterThan(2);
  });
});

// The width band where the card's *change* of width is what overflows (2026-08-22, reported from a
// phone: `441/440 ⚠ link-bubble R=441 w=408`). The plugin places the card before React has
// re-rendered it for the new link, so a move from a link that cannot become a card to one that can
// — a heading's link to a line-alone one — adds a button and ~30px after `shift` has already run.
//
// Only a band shows it: below it both cards are at the cap and the width never changes, above it
// neither is capped and there is room to grow into. 450px sits inside it; 360, 375, 390 and 412 are
// all outside, which is why every width measured before came back clean.
test.describe('in the width band where the card grows into the edge', () => {
  test.use({ ...PHONE, viewport: { width: 450, height: 800 } });

  test('the card is re-placed when it gains a button (12h)', async ({ page }) => {
    await openEditor(page);
    await loadMarkdown(
      page,
      `## この見出しの右のほうに[リンク](${LONG_HREF})\n\n[単独行のリンクはカードにできる](${LONG_HREF})\n`,
    );
    const caretInto = (selector: string) =>
      page.evaluate((sel) => {
        const a = document.querySelector(sel) as HTMLElement;
        const walker = document.createTreeWalker(a, NodeFilter.SHOW_TEXT);
        const text = walker.nextNode() as Text;
        const range = document.createRange();
        range.setStart(text, Math.min(2, text.length));
        range.collapse(true);
        const selection = window.getSelection() as Selection;
        selection.removeAllRanges();
        selection.addRange(range);
        (document.querySelector('.ProseMirror') as HTMLElement).focus();
      }, selector);

    await caretInto('.ProseMirror h2 a');
    await expect(page.getByRole('group', { name: 'リンク' })).toBeVisible();
    expect((await pageWidth(page)).scroll).toBeLessThanOrEqual(450);

    await caretInto('.ProseMirror p a');
    await expect(
      page.locator('.link-bubble').getByRole('button', { name: 'カードにする' }),
    ).toBeVisible();
    // The page, and the margin: before the fix this was 451px of document against 450px of screen,
    // with the card left at the text's left edge because `shift` had run against the narrow one.
    expect((await pageWidth(page)).scroll).toBeLessThanOrEqual(450);
    expect((await margins(page, '.link-bubble')).smallest).toBeGreaterThanOrEqual(EDGE);
  });
});

// The main toolbar's own dropdowns (list, callout, table — ToolbarDropdown.tsx), not the floating
// menus above. Its panel used to center on its trigger unconditionally (`left-1/2`, translated),
// which assumes room on both sides — true while the toolbar fits one line, but it wraps
// (`flex-wrap`), and which row a trigger lands in is a function of viewport width. The table picker
// is the widest panel here (an 8×8 grid), so it is the one that first reaches an edge: measured, the
// trigger sits mid-row from 300–416px, but past 420px it wraps to a row where it is near the left
// edge, and the centered panel then ran 14px+ past it (reported 2026-09-05). `pageWidth`'s
// `scrollWidth` check above does not catch this direction — a negative `left` clips off-screen
// without widening the document, so this needs its own margin measurement.
for (const width of [420, 440, 460]) {
  test(`the table picker's panel stays on a ${width}px screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openEditor(page);
    await page.getByRole('button', { name: '表', exact: true }).click();

    const panel = page.getByTestId('toolbar-dropdown-panel');
    await expect(panel).toBeVisible();
    expect(
      (await margins(page, '[data-testid="toolbar-dropdown-panel"]')).smallest,
    ).toBeGreaterThanOrEqual(EDGE);
  });
}
