import { test, expect, devices, type Page } from '@playwright/test';
import { loadMarkdown, setRange } from './editor-authoring';

// The editor's floating menus on a phone (docs/link-requirements.md §5.5.19,
// docs/editor-requirements.md §12). What broke was a box wider than the screen, which no markup
// states; floating-ui's `shift` had pinned both menus to the left edge and they still overflowed.
const MD = '前[リンク](https://example.com "タイトル")後\n';
const TABLE_MD = '| A | B | C |\n| --- | --- | --- |\n| x | y | z |\n';
// Long enough to truncate the href line, where the display card is widest.
const LONG_HREF =
  'https://example.com/very/long/path/that/does/not/fit/in/the/card/at/all/index.html';

// Every control's box, not only the container's: 適用, the one committing press, was the button
// that overflowed. **The margin is measured, not the overflow**: an edge exactly on the viewport
// still looks cut off on a device (rounded corners, insets, rounding), so the cap and `shift` leave
// 8px (§5.5.19).
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

// Height in buttons (1, or ~2 once wrapped): a ratio, so padding changes do not read as a wrap
// (docs/editor-requirements.md §12, §12.1).
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
    // The edit layout is the wide one; display mode always fitted.
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
    // Below `sm` the row/column buttons carry short labels (§12.1), read from `innerText` since both
    // labels are in the DOM and `display` picks. Full-width signs are the author's choice (§12.1).
    await expect(
      page.locator('.table-toolbar').getByRole('button', { name: '行を追加' }),
    ).toHaveText('＋行', { useInnerText: true });
    // 390px fits one line; 320px still wraps, which keeps `flex-wrap` load-bearing.
    const rows = await toolbarRows(page);
    if (width === 320) expect(rows).toBeGreaterThan(1.5);
    else expect(rows).toBeLessThan(1.5);
  });
}

// A heading's link gets no 「カードにする」 and a line-alone link does, so moving between them widens
// the card by a button after the plugin placed it. The sequence is what is measured, on the card's
// children: a capped container can still be overflowed from inside.
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

    // By selection: at these widths the first card can cover the next line.
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
  // The caps are `max-width`, so a desktop card is unaffected.
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
  // No ring: this context has a mouse (§12.2).
  expect(
    await toolbar
      .locator('button')
      .first()
      .evaluate((el) => getComputedStyle(el).boxShadow),
  ).toBe('none');
  // The long labels return above `sm` (§12.1).
  await expect(toolbar.getByRole('button', { name: '行を追加' })).toHaveText('行を追加', {
    useInnerText: true,
  });
});

// The overflow showed on a phone only: `isMobile` brings viewport meta handling, a non-1 pixel
// ratio and touch, and the failure lived in the last 8px, so one case runs emulated. The five
// fields are listed: `defaultBrowserType` and `channel` force a new worker in a describe.
const PIXEL_7 = devices['Pixel 7'];
const PHONE = {
  viewport: PIXEL_7.viewport,
  userAgent: PIXEL_7.userAgent,
  deviceScaleFactor: PIXEL_7.deviceScaleFactor,
  isMobile: PIXEL_7.isMobile,
  hasTouch: PIXEL_7.hasTouch,
};

// **The page-level half**: no menu may widen the document. The per-element margins miss tooltips,
// the heading list and anything else hung off a menu; `scrollWidth` covers them all (§5.5.19).
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

    // `<=`: a classic scrollbar makes the document narrower than the viewport box.
    const clean = await pageWidth(page);
    expect(clean.scroll).toBeLessThanOrEqual(clean.client);

    // The card in both shapes, then with the heading list.
    await setRange(page, 3, 3);
    await expect(page.getByRole('group', { name: 'リンク' })).toBeVisible();
    expect((await pageWidth(page)).scroll).toBeLessThanOrEqual(clean.client);

    await page.locator('.link-bubble').getByRole('button', { name: '編集' }).click();
    await expect(page.getByRole('textbox', { name: 'リンク先' })).toBeVisible();
    expect((await pageWidth(page)).scroll).toBeLessThanOrEqual(clean.client);

    await page.getByRole('textbox', { name: 'リンク先' }).fill('#');
    await expect(page.locator('.link-bubble')).toBeVisible();
    expect((await pageWidth(page)).scroll).toBeLessThanOrEqual(clean.client);

    // And the table toolbar.
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

// 360px, emulated: an invisible `EditorTooltip` (`opacity: 0`, still laid out) hung past the right
// edge. Only some widths put a button there, and the fix keys on `hover: none`.
test.describe('on an emulated phone at 360px', () => {
  test.use({ ...PHONE, viewport: { width: 360, height: 800 } });

  test('nothing invisible widens the page (12g)', async ({ page }) => {
    await openEditor(page);
    // Before anything opens: the toolbar alone did it.
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
    // One line with the short labels (§12.1), thinly: at desktop padding they wrap here, hence the 6px
    // padding below `sm`.
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
      // Found by name, asserted on text: the two differ on purpose (`－列` read aloud is no instruction).
      // That the query resolves protects screen readers and the other table specs.
      await expect(toolbar.getByRole('button', { name })).toHaveText(short, { useInnerText: true });
    }
    expect(await toolbarRows(page)).toBeLessThan(1.5);
    expect((await margins(page, '.table-toolbar')).smallest).toBeGreaterThanOrEqual(EDGE);
  });

  test('no toolbar button rings anywhere, on touch or on a pointer (12j)', async ({ page }) => {
    // No ring on any toolbar button (§12.12, then everywhere): edges are marked by the glyph or label,
    // `:active`'s tint (§12.7) and `.toolbar-mark-divider`.
    await openEditor(page);
    await loadMarkdown(page, TABLE_MD);
    await page.locator('.ProseMirror td').first().click();
    await expect(page.locator('.table-toolbar')).toBeVisible();

    const shadows = await page
      .locator('.table-toolbar button')
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).boxShadow));
    expect(shadows.length).toBeGreaterThan(4);
    expect(shadows.every((s) => !s.includes('inset'))).toBe(true);

    const outlines = (selector: string) =>
      page.locator(selector).evaluateAll((els) =>
        els.map((el) => ({
          tag: el.tagName,
          ring: getComputedStyle(el).boxShadow.includes('inset'),
        })),
      );
    const main = await outlines('.editor-toolbar-bar .toolbar-scroll .toolbar-button:visible');
    expect(main.length).toBeGreaterThan(8);
    expect(main.every((c) => !c.ring)).toBe(true);

    // Every control in the ＋ menu too, by tag, including 画像 (a `<label>` styled as a button).
    await page.getByRole('button', { name: 'ブロックを追加' }).click();
    const inserts = await outlines('[data-testid="insert-menu-panel"] .toolbar-button');
    expect(inserts.length).toBeGreaterThan(2);
    expect(inserts.every((c) => !c.ring)).toBe(true);
    expect(inserts.some((c) => c.tag === 'LABEL')).toBe(true);
    await page.keyboard.press('Escape');

    expect(await toolbarRows(page)).toBeLessThan(1.5);
    expect((await margins(page, '.table-toolbar')).smallest).toBeGreaterThanOrEqual(EDGE);
  });

  test('every pressable box in the editor chrome is 40px tall (12k)', async ({ page }) => {
    // §12.3, measured on the boxes: nothing in the markup states it, and the short ones had
    // per-component padding. Each of the four hooks (`.toolbar-button`, `.dropdown-item`,
    // `.link-bubble-open`, the card head's rule) is represented, since dropping one is the regression.
    const FLOOR = 40;
    const shortest = (page: Page, selector: string) =>
      page.locator(selector).evaluateAll((els) =>
        els.map((el) => {
          const box = el.getBoundingClientRect();
          return { h: box.height, w: box.width };
        }),
      );

    await openEditor(page);
    // `.editor-toolbar-bar`: under `hover: none` the bar is fixed, not sticky (§12.5). `:visible`: the
    // pointer copy of the insert group is here too, unpainted and 0×0.
    const main = await shortest(page, '.editor-toolbar-bar .toolbar-button:visible');
    expect(main.length).toBeGreaterThan(8);
    expect(Math.min(...main.map((b) => b.h))).toBeGreaterThanOrEqual(FLOOR);

    // The header's ＋ exists only under `hover: none` (§12.5). The header is the one exemption from
    // `FLOOR`: `.editor-header-bar` (app/globals.css) drops its controls to 34px to fit in 50px.
    const HEADER_FLOOR = 34;
    const plus = await shortest(page, '.insert-menu .toolbar-button');
    expect(plus).toHaveLength(1);
    expect(plus[0].h).toBeGreaterThanOrEqual(HEADER_FLOOR);
    // The drawer's rows are back at FLOOR.
    await page.getByRole('button', { name: 'ブロックを追加' }).click();
    const inserts = await shortest(page, '[data-testid="insert-menu-panel"] .toolbar-button');
    expect(inserts.length).toBeGreaterThan(2);
    expect(Math.min(...inserts.map((b) => b.h))).toBeGreaterThanOrEqual(FLOOR);
    await page.keyboard.press('Escape');

    // Undo/redo are squares at the floor both ways (§12.4); measured here because this file runs under
    // `hover: none`.
    const history = await shortest(page, '.editor-toolbar-bar .toolbar-button-history:visible');
    expect(history).toHaveLength(2);
    expect(Math.min(...history.map((b) => Math.min(b.h, b.w)))).toBeGreaterThanOrEqual(FLOOR);

    // Dropdown rows take their height from their own class, so they are checked apart. On touch
    // リスト is two toggles (§12.11); 囲み枠 is still a dropdown.
    await page.getByRole('button', { name: 'ブロックを追加' }).click();
    await page
      .getByTestId('insert-menu-panel')
      .getByRole('button', { name: '囲み枠', exact: true })
      .click();
    const items = await shortest(page, '.dropdown-item');
    expect(items.length).toBeGreaterThan(1);
    expect(Math.min(...items.map((b) => b.h))).toBeGreaterThanOrEqual(FLOOR);
    // The sheet's backdrop (§12.18) blocks presses, so close it first.
    await page.keyboard.press('Escape');
    await page.locator('.ProseMirror').click();

    await loadMarkdown(page, TABLE_MD);
    await page.locator('.ProseMirror td').first().click();
    await expect(page.locator('.table-toolbar')).toBeVisible();
    const table = await shortest(page, '.table-toolbar button');
    expect(Math.min(...table.map((b) => b.h))).toBeGreaterThanOrEqual(FLOOR);

    // The bubble's first line is a bare `<button>`, once the shortest box (§12.3); its round neighbours
    // take the floor both ways or become pills.
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

    // The icon is centred: a block-level `<svg>` put all the added width to its right until flex.
    // Per side, so a one-sided padding change fails.
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

    // The card's band, icon-only here, was the one box under WCAG 2.2 SC 2.5.8's 24px (§12.3).
    await openEditor(page);
    await loadMarkdown(
      page,
      '<div class="link-card" data-href="/posts/second-post"></div>\n\n本文\n',
    );
    await expect(page.locator('.link-card-head button').first()).toBeVisible();
    const head = await shortest(page, '.link-card-head button');
    expect(head).toHaveLength(3);
    expect(Math.min(...head.map((b) => Math.min(b.h, b.w)))).toBeGreaterThanOrEqual(FLOOR);

    // The embed's band is exempt by decision (§12.3): its labelled button is wide enough, and at the
    // floor it filled the band and ringed the player. Measured as the gap, as reported.
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

// A band where the card's change of width overflows: the plugin places it before React re-renders
// for the new link, so going from a heading's link to a line-alone one adds a button after `shift`.
// Below the band both cards are capped, above it there is room; 450px is inside.
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
    // The page and the margin: before, 451px of document on a 450px screen.
    expect((await pageWidth(page)).scroll).toBeLessThanOrEqual(450);
    expect((await margins(page, '.link-bubble')).smallest).toBeGreaterThanOrEqual(EDGE);
  });
});

// The toolbar's own dropdowns (ToolbarDropdown.tsx). The panel centred on its trigger, but the
// toolbar wraps, and past 420px the table picker's trigger is near the left edge, so the panel ran
// past it. A negative `left` clips without widening the document, so `pageWidth` cannot see it.
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
