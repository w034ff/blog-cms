import { test, expect, devices, type BrowserContext, type Page } from '@playwright/test';
import { loadMarkdown } from './editor-authoring';

// Where the editor's chrome sits on a phone (docs/table-requirements.md §12.5): the format controls
// are a bar at the bottom of the screen, and 囲み枠・表・リンク・画像 are behind a ＋ in the page
// header.
//
// Browser-only, and not merely because the editor is. What is claimed here is arrangement —
// which box is at which end of the screen, which way a panel opens, which copy of a duplicated
// control is painted. None of it is stated in the markup: both copies of the insert group are in
// the DOM at every width and a single media query decides, so a unit test over the component tree
// would see the same thing in both arrangements.
//
// **What this file cannot measure: the software keyboard.** The bar is fixed to
// `bottom: var(--editor-kb-inset)`, and emulation has no keyboard to raise it — the same limit
// docs/link-requirements.md §5.5.21 hit, and answered there by an author's check on a real device.
// §12.5 records that check; this file holds the half a browser can answer.
const PIXEL_7 = devices['Pixel 7'];
// The five keys a describe may take: `defaultBrowserType` and `channel` are worker-scoped and
// Playwright refuses a whole descriptor here (§5.5.21). Same list as editor-narrow-menus.spec.ts.
const PHONE = {
  viewport: PIXEL_7.viewport,
  userAgent: PIXEL_7.userAgent,
  deviceScaleFactor: PIXEL_7.deviceScaleFactor,
  isMobile: PIXEL_7.isMobile,
  hasTouch: PIXEL_7.hasTouch,
};

async function openEditor(page: Page): Promise<void> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
}

const bar = (page: Page) => page.locator('.editor-toolbar-bar');
const plus = (page: Page) => page.getByRole('button', { name: 'ブロックを追加' });

test.describe('on an emulated phone', () => {
  test.use(PHONE);

  test('the format bar is at the bottom of the screen, not the top', async ({ page }) => {
    await openEditor(page);
    const box = await bar(page).boundingBox();
    const height = await page.evaluate(() => window.innerHeight);
    expect(box).not.toBeNull();
    // Its bottom edge is the screen's. Within a pixel, because a device scale factor of 2.625
    // lands fractional CSS pixels — what is being ruled out is the old arrangement, which had this
    // edge some 700px away, not a rounding difference.
    expect(Math.abs(box!.y + box!.height - height)).toBeLessThanOrEqual(1);
    // And it is not still pinned under the page header, which is where it used to be.
    expect(box!.y).toBeGreaterThan(height / 2);
  });

  test('the post is not written underneath the bar', async ({ page }) => {
    await openEditor(page);
    // The padding is the bar's measured height (`--editor-toolbar-h`), not a constant — the row
    // wraps at 320px, which is the reason it is measured at all.
    const [padding, height] = await Promise.all([
      page.locator('.ProseMirror').evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom)),
      bar(page).evaluate((el) => el.getBoundingClientRect().height),
    ]);
    expect(padding).toBeGreaterThanOrEqual(height - 1);
  });

  test('the insert controls are in the ＋, not in the bar', async ({ page }) => {
    await openEditor(page);
    // The pointer copy is in the DOM and unpainted. `getByRole` matches only what is exposed to
    // the accessibility tree, so the two copies never collide for the specs that name these
    // controls — which is what lets the arrangement be a media query over one markup.
    await expect(bar(page).locator('.toolbar-insert')).toBeHidden();
    await expect(bar(page).getByRole('button', { name: 'リンク' })).toHaveCount(0);
    await expect(bar(page).getByRole('button', { name: '引用', exact: true })).toHaveCount(0);

    await expect(plus(page)).toBeVisible();
    await plus(page).click();
    const panel = page.getByTestId('insert-menu-panel');
    await expect(panel).toBeVisible();
    for (const name of ['囲み枠', '表', 'リンク', '引用']) {
      await expect(panel.getByRole('button', { name, exact: true })).toBeVisible();
    }
    // 画像 is the <label> around a file input, the one control here that is not a <button>.
    await expect(panel.getByTestId('image-picker-touch')).toHaveCount(1);
    // The panel stays on screen: it is right-aligned under a trigger near the right edge of the
    // header, where a centred one would run off.
    const box = (await panel.boundingBox())!;
    const width = await page.evaluate(() => document.documentElement.clientWidth);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  });

  test('リンク in the ＋ opens the insert dialog', async ({ page }) => {
    await openEditor(page);
    await plus(page).click();
    await page
      .getByTestId('insert-menu-panel')
      .getByRole('button', { name: 'リンク', exact: true })
      .click();
    await expect(page.getByRole('dialog', { name: 'リンクを挿入' })).toBeVisible();
  });

  test('表 in the ＋ inserts a table', async ({ page }) => {
    await openEditor(page);
    await plus(page).click();
    await page
      .getByTestId('insert-menu-panel')
      .getByRole('button', { name: '表', exact: true })
      .click();
    // The grid picker is a panel inside the ＋'s panel; choosing a size has to reach the editor
    // through both.
    await page.getByRole('button', { name: '2行2列の表を挿入' }).click();
    await expect(page.locator('.ProseMirror table')).toBeVisible();
  });

  test('引用 in the ＋ wraps the current block', async ({ page }) => {
    await openEditor(page);
    await loadMarkdown(page, '本文\n');
    await plus(page).click();
    await page
      .getByTestId('insert-menu-panel')
      .getByRole('button', { name: '引用', exact: true })
      .click();
    await expect(page.locator('.ProseMirror blockquote')).toContainText('本文');
  });

  test('the way out is the arrow alone, and still named 記事一覧', async ({ page }) => {
    await openEditor(page);
    // The name is what a spec, a screen reader and a voice-control user all reach for, and it is
    // the thing an icon-only control loses by default — so it is asserted here rather than left to
    // the markup (§12.6).
    const back = page.getByRole('link', { name: '記事一覧' });
    await expect(back).toBeVisible();
    await expect(page.locator('.editor-back-label')).toBeHidden();
    await expect(page.locator('.editor-back-icon')).toBeVisible();

    // Square at the touch floor: one 16px icon in a box that a `min-height` alone would have left
    // a sliver (§12.3's pairing).
    const box = (await back.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(40);
    expect(box.width).toBeGreaterThanOrEqual(40);

    await back.click();
    await expect(page).toHaveURL(/\/admin$/);
  });

  test('記事の設定 is a gear, still named and still opening its panel', async ({ page }) => {
    await openEditor(page);
    // Same test as the back arrow (§12.6): the icon-only side still needs the word as its name.
    const settings = page.getByRole('button', { name: '記事の設定' });
    await expect(settings).toBeVisible();
    await expect(page.locator('.editor-settings-label')).toBeHidden();
    await expect(page.locator('.editor-settings-icon')).toBeVisible();

    const box = (await settings.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(40);
    expect(box.width).toBeGreaterThanOrEqual(40);

    await expect(settings).toHaveAttribute('aria-expanded', 'false');
    await settings.click();
    await expect(settings).toHaveAttribute('aria-expanded', 'true');
  });

  // The press state (§12.7). Driven with `CSS.forcePseudoState` rather than a real tap: a tap is
  // down-and-up in one call, so there is no moment to read the style in, and the claim is about
  // what is painted while the finger is down.
  test('a press is visible, and says something the on-state does not', async ({
    page,
    context,
  }) => {
    await openEditor(page);
    const bold = page.getByRole('button', { name: '太字' });
    const cdp = await (context as BrowserContext).newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    // The same element the background is read from — `forcePseudoState` acts on this node alone,
    // so a selector that resolves to a different button forces the state on one and measures
    // another, and the measured one never changes.
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: '.editor-toolbar-bar button[aria-label="太字"]',
    });
    const background = () => bold.evaluate((el) => getComputedStyle(el).backgroundColor);

    const rest = await background();
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['active'] });
    const pressed = await background();
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
    expect(pressed).not.toBe(rest);

    // And it is not the colour that means 「今オンである」 — otherwise pressing an already-bold
    // 太字 would show nothing at all while it is held.
    await bold.click();
    const on = await background();
    expect(on).not.toBe(rest);
    expect(pressed).not.toBe(on);
  });

  test('a refusal notice is readable above the bar', async ({ page }) => {
    await openEditor(page);
    // The toast hangs off the bar — that is what keeps it on screen however far the author has
    // scrolled — so the bar moving to the bottom is what would have dropped it off the screen
    // below the fold. The orphan-footnote notice is the cheapest one to provoke: it fires on load
    // (docs/footnote-requirements.md §5.4).
    await loadMarkdown(page, '本文[^a]\n\n[^a]: A の注\n\n[^x]: 参照のない注\n');
    const toast = page.getByText(/参照されていない脚注が 1 件/);
    await expect(toast).toBeVisible();

    const [toastBox, barBox] = [(await toast.boundingBox())!, (await bar(page).boundingBox())!];
    const height = await page.evaluate(() => window.innerHeight);
    // Above the bar, and on the screen — the two halves of "readable".
    expect(toastBox.y + toastBox.height).toBeLessThanOrEqual(barBox.y + 1);
    expect(toastBox.y).toBeGreaterThanOrEqual(0);
    expect(toastBox.y + toastBox.height).toBeLessThanOrEqual(height);
  });
});

// The pointer arrangement is unchanged by §12.5, and this is the guard that says so: every control
// is back in the toolbar at the top and the ＋ does not exist.
test('a pointer keeps the toolbar it had', async ({ page }) => {
  await openEditor(page);
  await expect(plus(page)).toBeHidden();
  const box = (await bar(page).boundingBox())!;
  const height = await page.evaluate(() => window.innerHeight);
  expect(box.y).toBeLessThan(height / 2);
  for (const name of ['囲み枠', '表', 'リンク', '引用']) {
    await expect(bar(page).getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(bar(page).getByTestId('image-picker')).toHaveCount(1);
  // And the way out is still words, not an arrow (§12.6), and 記事の設定 is still words too (§12.8).
  await expect(page.locator('.editor-back-label')).toBeVisible();
  await expect(page.locator('.editor-back-icon')).toBeHidden();
  await expect(page.locator('.editor-settings-label')).toBeVisible();
  await expect(page.locator('.editor-settings-icon')).toBeHidden();
});

// The marks scroll instead of wrapping (§12.11), at 40px each — wide enough that this only
// actually overflows on the narrowest screens, so this group runs at 320px rather than the file's
// default 412px (where the strip's content happens to fit exactly, measured 2026-09-17).
test.describe('on a narrow emulated phone', () => {
  test.use({ ...PHONE, viewport: { width: 320, height: 800 } });

  test('the toolbar is one row, and the marks are 40px wide', async ({ page }) => {
    await openEditor(page);
    const height = await bar(page).evaluate((el) => el.getBoundingClientRect().height);
    // One row's worth — the 40px marks would have wrapped a 24px row at this width otherwise.
    expect(height).toBeLessThan(50);

    for (const name of ['大見出し', '太字', '斜体', '取り消し線', '強調']) {
      const box = (await page.getByRole('button', { name }).boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(40);
      expect(box.height).toBeGreaterThanOrEqual(40);
    }
  });

  test('undo/redo stay put while the rest of the row scrolls', async ({ page }) => {
    await openEditor(page);
    await loadMarkdown(page, '本文\n');
    const scroll = page.locator('.toolbar-scroll');
    const { scrollWidth, clientWidth } = await scroll.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(scrollWidth).toBeGreaterThan(clientWidth);

    const undoBefore = (await page.getByRole('button', { name: '元に戻す' }).boundingBox())!;
    await scroll.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    const undoAfter = (await page.getByRole('button', { name: '元に戻す' }).boundingBox())!;
    expect(undoAfter.x).toBeCloseTo(undoBefore.x, 0);

    // A control scrolled into view is still reachable — Playwright's click scrolls its target
    // into view first, so this also stands in for a real drag-to-scroll-then-tap gesture. 番号付き
    // is the strip's last control, so it is the one most likely to start out-of-view.
    await page.getByRole('button', { name: '番号付き' }).click();
    await expect(page.locator('.ProseMirror ol')).toContainText('本文');
  });
});
