import { test, expect, devices, type BrowserContext, type Page } from '@playwright/test';
import { closeHistory, expectAutosaved, loadMarkdown } from './editor-authoring';

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
    // The panel is a full-width bottom sheet (§12.18), so it always spans the screen — there is no
    // anchor-vs-viewport edge case left to measure, unlike the small anchored box it replaced.
    const box = (await panel.boundingBox())!;
    const width = await page.evaluate(() => document.documentElement.clientWidth);
    expect(box.x).toBe(0);
    expect(box.width).toBe(width);

    // The sheet's heading (2026-09-19, note's and Google Docs' own precedent), plain text rather
    // than the trigger's own accessible name — see InsertMenu.tsx's own comment on why 「挿入」
    // can't be a button's name here (it would also match 挿入する and 2行2列の表を挿入).
    const heading = panel.getByRole('heading', { name: '挿入', exact: true });
    await expect(heading).toBeVisible();
    const labelledBy = await panel.getAttribute('aria-labelledby');
    expect(labelledBy).toBe(await heading.getAttribute('id'));
  });

  test("the ＋ sheet's rows are full-width, not cards (§12.19)", async ({ page }) => {
    await openEditor(page);
    await plus(page).click();
    const panel = page.getByTestId('insert-menu-panel');
    await expect(panel).toBeVisible();

    const panelWidth = (await panel.boundingBox())!.width;
    for (const name of ['引用', 'リンク']) {
      const rowBox = (await panel.getByRole('button', { name, exact: true }).boundingBox())!;
      expect(rowBox.x).toBe(0);
      expect(rowBox.width).toBe(panelWidth);
      const ring = await panel
        .getByRole('button', { name, exact: true })
        .evaluate((el) => getComputedStyle(el).boxShadow.includes('inset'));
      expect(ring).toBe(false);
      const radius = await panel
        .getByRole('button', { name, exact: true })
        .evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
      expect(radius).toBe('0px');
    }
  });

  test('the ＋ sheet has a backdrop that dismisses it without reaching the post underneath (§12.18)', async ({
    page,
  }) => {
    await openEditor(page);
    await page.keyboard.type('本文');
    await plus(page).click();
    const panel = page.getByTestId('insert-menu-panel');
    await expect(panel).toBeVisible();

    // The backdrop covers the post and the format bar underneath — a real modal, unlike the old
    // small anchored box, which let a press pass through to whatever it landed on (the fix in
    // "every pressable box… (12k)", editor-narrow-menus.spec.ts, hit this the same way).
    const backdrop = page.locator('.fixed.inset-0.bg-black\\/40');
    await expect(backdrop).toBeVisible();

    // The sheet has real presence at rest (2026-09-18): `min-h-[40vh]` is a floor, not the content
    // height — five rows alone already reached ~32% of a 740px screen, which is why an earlier
    // 33vh floor barely moved anything.
    const [panelHeight, viewportHeight] = await Promise.all([
      panel.evaluate((el) => el.getBoundingClientRect().height),
      page.evaluate(() => window.innerHeight),
    ]);
    expect(panelHeight / viewportHeight).toBeGreaterThanOrEqual(0.4 - 0.01);

    // The sheet actually paints over the bar, not just contains its rect (§12.18's portal fix,
    // 2026-09-18): before the portal, the sheet's own `getBoundingClientRect()` fully contained
    // the bar's, and the bar still painted on top — nested in the header's `sticky`+`z-40`
    // stacking context, the sheet's `z-50` was only compared within it, and the bar (also `z-40`,
    // later in the DOM) won the top-level tie. `elementFromPoint` at the bar's own centre is what
    // that bug would have failed and a rect comparison would not have caught.
    const barCenterHitsSheet = await bar(page).evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return Boolean(hit?.closest('[data-testid="insert-menu-panel"]'));
    });
    expect(barCenterHitsSheet).toBe(true);

    // A tap on the backdrop dismisses the sheet and does nothing else — the post is untouched.
    await backdrop.click({ position: { x: 5, y: 5 } });
    await expect(panel).toBeHidden();
    await expect(backdrop).toBeHidden();
    await expect(page.locator('.ProseMirror')).toHaveText('本文');
  });

  // Regression (2026-09-20): neither the sheet nor InsertDialog is a native `<dialog>`, so neither
  // got a background-scroll lock for free — a wheel/swipe over the backdrop (or the sheet's own
  // content, chaining past its scroll edge) moved the post visibly behind the dim
  // (useBodyScrollLock.ts).
  test('the ＋ sheet locks the background from scrolling, and releases it on close', async ({
    page,
  }) => {
    await openEditor(page);
    for (let i = 0; i < 40; i++) {
      await page.keyboard.type(`本文行 ${i}`);
      await page.keyboard.press('Enter');
    }
    const before = await page.evaluate(() => window.scrollY);

    await plus(page).click();
    const panel = page.getByTestId('insert-menu-panel');
    await expect(panel).toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');

    const backdrop = page.locator('.fixed.inset-0.bg-black\\/40');
    await backdrop.hover();
    await page.mouse.wheel(0, 300);
    expect(await page.evaluate(() => window.scrollY)).toBe(before);

    await backdrop.click();
    await expect(panel).toBeHidden();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');

    await page.mouse.wheel(0, 300);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
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

  // Regression (2026-09-20): the sheet was still mounted underneath the dialog (mousedown inside
  // the dialog closes it as a `useDismiss` side effect, but `fill()` isn't a mousedown), and equal
  // z-index left paint order to DOM/mount timing — the sheet, portalled after the dialog in the
  // tree, won and physically blocked clicks on 挿入する, which a full-height phone dialog puts
  // inside the bottom sheet's own screen region. InsertDialog.tsx's `z-[55]` fixes the stacking;
  // `insert-menu-nav.ts`'s comment on why InsertDialog can't reach the nav context covers the
  // rest (`onCancel`/`onCommit` props from PostEditor.tsx instead).
  test('リンク in the ＋: 閉じる returns to the row list, and committing closes the sheet', async ({
    page,
  }) => {
    await openEditor(page);
    await plus(page).click();
    const panel = page.getByTestId('insert-menu-panel');
    await panel.getByRole('button', { name: 'リンク', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'リンクを挿入' });
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: '閉じる' }).click();
    await expect(dialog).toBeHidden();
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { name: '挿入', exact: true })).toBeVisible();

    await panel.getByRole('button', { name: 'リンク', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'リンクを挿入' });
    const field = dialog.getByLabel('URL または埋め込みコード');
    await field.fill('https://www.youtube.com/watch?v=hDPybQwAuVo');
    const submit = dialog.getByRole('button', { name: '挿入する' });
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(dialog).toBeHidden();
    await expect(panel).not.toBeVisible();
  });

  // A separate call site of the same dialog, and it never touched the drawer — a cancel there
  // must not pop the ＋ sheet open (PostEditor.tsx's `insertDialogFromDrawer` ref).
  test('リンク from the slash menu does not involve the ＋ drawer at all', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.type('/リンク');
    await expect(page.locator('[data-slash-menu]')).toBeVisible();
    await page.locator('[data-slash-menu]').getByRole('button', { name: 'リンク' }).click();
    const dialog = page.getByRole('dialog', { name: 'リンクを挿入' });
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: '閉じる' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('insert-menu-panel')).toHaveCount(0);
  });

  test('表 in the ＋ inserts a table and closes the sheet', async ({ page }) => {
    await openEditor(page);
    await plus(page).click();
    const panel = page.getByTestId('insert-menu-panel');
    await panel.getByRole('button', { name: '表', exact: true }).click();
    // The 行数/列数 steppers replace the row list in the same sheet (§12.20, insert-menu-nav.ts) —
    // no grid on touch, unlike the pointer copy (table-picker.spec.ts), and no text field either
    // (TableGridMenu.tsx's own comment has the reasoning for both, 2026-09-20). Default is 3×3.
    await panel.getByRole('button', { name: '行数を減らす' }).click();
    await panel.getByRole('button', { name: '列数を減らす' }).click();
    await panel.getByRole('button', { name: '表を追加' }).click();
    await expect(page.locator('.ProseMirror table')).toBeVisible();
    // Regression, same as 引用/脚注/画像: a pick here is a final "inserted, done" action, so the
    // whole sheet closes rather than returning to the row list (TableGridMenu.tsx's `insert`,
    // 2026-09-20).
    await expect(panel).not.toBeVisible();
  });

  // 囲み枠 and 表 used to open a floating dropdown of their own, positioned under the row — the
  // same `ToolbarDropdown` the pointer toolbar still uses. §12.20 replaces that, on touch only,
  // with a drilldown: the row's picker takes over the sheet's own body, and 戻る returns to the
  // row list. `insert-menu-nav.ts` is what makes this a portal into a slot InsertMenu.tsx renders,
  // not a second mount of CalloutMenu/TableGridMenu — the difference matters because a naive
  // "swap the JSX" version unmounts the row's own component, silently orphaning state that lives
  // on it (TableGridMenu's grid highlight is what caught this the first time, below).
  test('囲み枠 in the ＋ drills into the sheet, not a floating panel', async ({ page }) => {
    await openEditor(page);
    await plus(page).click();
    const panel = page.getByTestId('insert-menu-panel');
    await panel.getByRole('button', { name: '囲み枠', exact: true }).click();

    // The heading and the ＞ trigger swap for a 戻る + the row's own title (one `<h2>` throughout,
    // InsertMenu.tsx — a second one sharing `aria-labelledby`'s id was tried and rejected).
    await expect(panel.getByRole('heading', { name: '囲み枠', exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: '戻る' })).toBeVisible();
    await expect(page.getByTestId('toolbar-dropdown-panel')).toHaveCount(0);

    // The 3 types read as full-width rows continuing the list, not the pointer copy's small
    // `.dropdown-item`s (§12.19's own row-list rule reaches them: `docs/table-requirements.md`).
    const noteRow = panel.getByRole('button', { name: '注意', exact: true });
    const rowBox = (await noteRow.boundingBox())!;
    const panelWidth = (await panel.boundingBox())!.width;
    expect(rowBox.width).toBeGreaterThan(panelWidth * 0.9);

    await noteRow.click();
    await expect(page.locator('.ProseMirror [data-callout]')).toBeVisible();
    // Picking one closes the whole sheet, same as 引用/脚注/画像's own row — a pick here is as
    // final as tapping one of those (CalloutMenu.tsx's `choose`, 2026-09-20; previously this
    // returned to the row list instead).
    await expect(panel).not.toBeVisible();
  });

  // Regression (2026-09-20): the touch drawer used to drill into the same grid the pointer keeps
  // (table-picker.spec.ts) — replaced with TableSizeRows' steppers directly, since a tap both
  // focuses and clicks in the same gesture, so a grid's hover preview never has a moment to show
  // before the tap already commits, and its cells (h-4 w-4, 16px) sit under the 40px touch target
  // every other drawer row uses. This exercises a size the pointer's own 8×8 grid cannot reach in
  // one click, to keep the steppers' own `TABLE_MAX_ROWS`/`TABLE_MAX_COLS` clamps (not the grid's
  // bounds) live — one stepper pinned at its own max (行数を増やす disables past 50) would not.
  test('表 in the ＋: the steppers insert a size the grid could not reach directly', async ({
    page,
  }) => {
    await openEditor(page);
    await plus(page).click();
    const panel = page.getByTestId('insert-menu-panel');
    await panel.getByRole('button', { name: '表', exact: true }).click();
    await expect(panel.getByRole('button', { name: '2行2列の表を挿入' })).toHaveCount(0);

    // Default is 3×3: +9 rows to reach 12, −1 col to reach 2.
    const growRows = panel.getByRole('button', { name: '行数を増やす' });
    for (let i = 0; i < 9; i++) await growRows.click();
    await panel.getByRole('button', { name: '列数を減らす' }).click();
    await panel.getByRole('button', { name: '表を追加' }).click();

    const rows = page.locator('.ProseMirror table tr');
    await expect(rows).toHaveCount(12);
    await expect(rows.first().locator('th')).toHaveCount(2);
    // Same final-action rule as the pointer's own escape hatch and 引用/脚注/画像's own rows.
    await expect(panel).not.toBeVisible();
  });

  test('戻る leaves the ＋ sheet row list exactly as it was', async ({ page }) => {
    await openEditor(page);
    await plus(page).click();
    const panel = page.getByTestId('insert-menu-panel');
    await panel.getByRole('button', { name: '表', exact: true }).click();
    await expect(panel.getByRole('heading', { name: '表', exact: true })).toBeVisible();

    await panel.getByRole('button', { name: '戻る' }).click();
    await expect(panel.getByRole('heading', { name: '挿入', exact: true })).toBeVisible();
    for (const name of ['囲み枠', '表', 'リンク', '引用']) {
      await expect(panel.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await expect(page.locator('.ProseMirror table')).toHaveCount(0);
  });

  test('引用 in the ＋ wraps the current block and closes the sheet', async ({ page }) => {
    await openEditor(page);
    await loadMarkdown(page, '本文\n');
    await plus(page).click();
    const panel = page.getByTestId('insert-menu-panel');
    await panel.getByRole('button', { name: '引用', exact: true }).click();
    await expect(page.locator('.ProseMirror blockquote')).toContainText('本文');
    // Regression: 引用/脚注/画像 ran their command and left the sheet exactly as it was — the
    // author saw only the backdrop, with no sign anything had happened underneath it
    // (insert-menu-nav.ts's `closeMenu`, 2026-09-20). 囲み枠/表 (drill into a picker) and リンク
    // (opens InsertDialog, which covers the sheet on its own) are unaffected — see the tests below
    // and 表/囲み枠's own drilldown tests above.
    await expect(panel).not.toBeVisible();
  });

  test('脚注 in the ＋ inserts a reference and closes the sheet', async ({ page }) => {
    await openEditor(page);
    await loadMarkdown(page, '本文\n');
    await page.locator('.ProseMirror p').first().click();
    await page.keyboard.press('End');
    await plus(page).click();
    const panel = page.getByTestId('insert-menu-panel');
    await panel.getByRole('button', { name: '脚注', exact: true }).click();
    await expect(page.locator('.ProseMirror sup[data-footnote-ref]')).toBeVisible();
    await expect(panel).not.toBeVisible();
  });

  test('コードブロック in the ＋ inserts a block and closes the sheet', async ({ page }) => {
    await openEditor(page);
    await loadMarkdown(page, '本文\n');
    await page.locator('.ProseMirror p').first().click();
    await page.keyboard.press('End');
    await plus(page).click();
    const panel = page.getByTestId('insert-menu-panel');
    await panel.getByRole('button', { name: 'コードブロック', exact: true }).click();
    await expect(page.locator('.ProseMirror pre code')).toBeVisible();
    await expect(panel).not.toBeVisible();
  });

  test('画像 in the ＋ closes the sheet once a file is picked', async ({ page }) => {
    await openEditor(page);
    await plus(page).click();
    const panel = page.getByTestId('insert-menu-panel');
    await panel
      .getByTestId('image-picker-touch')
      .setInputFiles({ name: 'x.png', mimeType: 'image/png', buffer: Buffer.from([0]) });
    await expect(panel).not.toBeVisible();
  });

  test('the way out is the arrow alone, and still named 記事一覧', async ({ page }) => {
    await openEditor(page);
    // The name is what a spec, a screen reader and a voice-control user all reach for, and it is
    // the thing an icon-only control loses by default — so it is asserted here rather than left to
    // the markup (§12.6).
    const back = page.getByRole('link', { name: '記事一覧' });
    await expect(back).toBeVisible();
    // Icon alone: the glyph, plus the tooltip span — which `hover: none` does not paint at all
    // (app/globals.css), so nothing but the arrow is on screen and the name above is the only one
    // there is. `toHaveText` reads textContent, which a tooltip's own words would satisfy, so the
    // claim is made against what is painted instead.
    await expect(back.locator('.editor-tooltip')).toBeHidden();
    await expect(back.locator(':scope > *:not(svg):not(.editor-tooltip)')).toHaveCount(0);

    // Square at the header's own touch floor: one 16px icon in a box that a `min-height` alone
    // would have left a sliver (§12.3's pairing) — 34px here, not the app-wide 40px, since
    // `.editor-header-bar` drops the header's own controls (app/globals.css, 2026-09-20).
    const box = (await back.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(34);
    expect(box.width).toBeGreaterThanOrEqual(34);

    await back.click();
    await expect(page).toHaveURL(/\/admin$/);
  });

  test('記事の設定 is a gear, still named and still opening its panel', async ({ page }) => {
    await openEditor(page);
    // Same test as the back arrow (§12.6): the icon-only side still needs the word as its name.
    const settings = page.getByRole('button', { name: '記事の設定' });
    await expect(settings).toBeVisible();
    await expect(settings.locator('.editor-tooltip')).toBeHidden();
    await expect(settings.locator(':scope > *:not(svg):not(.editor-tooltip)')).toHaveCount(0);

    // 34px here too — see the back-arrow test above for why this isn't the app-wide 40px floor.
    const box = (await settings.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(34);
    expect(box.width).toBeGreaterThanOrEqual(34);

    await expect(settings).toHaveAttribute('aria-expanded', 'false');
    await settings.click();
    await expect(settings).toHaveAttribute('aria-expanded', 'true');
  });

  test('the format bar has no left inset on touch, so H2 sits flush with its edge', async ({
    page,
  }) => {
    // §12.14's other half: the bar's own `px-2` (pointer's left inset) used to stack with the
    // first `wide` mark's own centring gap — together an 18.7px gap before H2 that read as more
    // than every other button gets (measured 2026-09-18). Zeroed on touch only; pointer keeps it.
    await openEditor(page);
    const padding = await bar(page).evaluate((el) => getComputedStyle(el).paddingLeft);
    expect(padding).toBe('0px');
    const [barBox, h2Box] = [
      (await bar(page).boundingBox())!,
      (await page.getByRole('button', { name: '大見出し' }).boundingBox())!,
    ];
    expect(h2Box.x).toBeCloseTo(barBox.x, 0);
  });

  test('限定公開 is a lock icon on touch, and the header is one line with it', async ({ page }) => {
    // §12.14: the header wraps to two lines at 360px once the 限定公開 chip and the autosave
    // status are both showing (measured 2026-09-18) — unrelated to undo/redo, and pre-existing.
    // The fix shrinks both to a glyph on touch rather than removing either (both carry a real
    // warning — see PostEditor.tsx).
    await openEditor(page);
    await page.getByRole('button', { name: '記事の設定' }).click();
    await page.getByRole('checkbox', { name: '限定公開にする' }).check();
    await page.getByRole('button', { name: '記事の設定' }).click();

    await expect(page.locator('.unlisted-badge-full')).toBeHidden();
    const dot = page.locator('.unlisted-badge-dot');
    await expect(dot).toBeVisible();
    await expect(dot).toHaveAttribute('aria-label', '限定公開');
    await expect(dot.locator('svg')).toBeVisible();

    // The row this chip sits in stays one line — the thing §12.14 was written to fix. One line's
    // height is the tallest single control in it (the 40px back arrow, §12.6), not less.
    const row = page.locator('.editor-back-link').locator('..');
    const rowHeight = await row.evaluate((el) => el.getBoundingClientRect().height);
    expect(rowHeight).toBeLessThanOrEqual(40);
  });

  test('autosave is silent while saving, a checkmark once saved, worded on failure', async ({
    page,
  }) => {
    await openEditor(page);
    await page.keyboard.type('本文');

    // 保存中…: the full-text copy is a pointer control regardless of state (hidden on touch by
    // §12.6's idiom), and the compact copy is deliberately not rendered for this state either
    // (§12.14) — the reassurance it gave was for a pointer, which still gets the words.
    await expect(page.locator('.autosave-status-full')).toBeHidden();
    await expect(page.locator('.autosave-status-compact')).toHaveCount(0);

    // 保存済み ✓: the compact copy is a checkmark, named for a screen reader by `aria-label`.
    await expect(page.locator('.autosave-status-compact')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.autosave-status-compact')).toHaveText('✓');
    await expect(page.locator('.autosave-status-compact')).toHaveAttribute(
      'aria-label',
      '保存済み ✓',
    );

    // 保存に失敗: kept full-width at every size (§12.14) — the one state worth the header's room.
    await page.route('**/api/drafts', (route) => route.abort());
    await page.keyboard.type('追記');
    await expect(page.getByText('保存に失敗')).toBeVisible({ timeout: 10_000 });
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

  test('the row has dividers between H3/B, after 強調, and before 元に戻す, and no ring (§12.12/§12.17)', async ({
    page,
  }) => {
    // Empty flex items shrink to 0 width first under the scroll strip's own flex-shrink (measured
    // 2026-09-18: a bare `w-px` span collapsed invisibly) — `shrink-0` is what keeps it 1px.
    const dividers = page.locator('.toolbar-mark-divider');
    await openEditor(page);
    await expect(dividers).toHaveCount(3);
    for (const box of await dividers.evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect()),
    )) {
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
    }

    // No `.toolbar-button` consumer rings any more (§12.2/§12.12, 2026-09-19 —
    // editor-narrow-menus.spec.ts's 12j is the exhaustive check across every one of them); the
    // divider plus each glyph's own shape is what marks a boundary in the mark row specifically.
    const ring = (name: string) =>
      page
        .getByRole('button', { name, exact: true })
        .evaluate((el) => getComputedStyle(el).boxShadow.includes('inset'));
    expect(await ring('大見出し')).toBe(false);
    await plus(page).click();
    expect(await ring('表')).toBe(false);
    await page.keyboard.press('Escape');
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
  // And the header's own controls are icons on this surface too (§12.6, §12.8, 2026-09-21): the
  // words moved into `aria-label` and a hover tooltip, so a pointer has no painted text here
  // either. Asserted through the name, which is what survives the change and what a screen reader
  // and a voice-control user actually use.
  const back = page.getByRole('link', { name: '記事一覧' });
  const settings = page.getByRole('button', { name: '記事の設定' });
  await expect(back).toBeVisible();
  await expect(settings).toBeVisible();
  await expect(back.locator(':scope > *:not(svg):not(.editor-tooltip)')).toHaveCount(0);
  await expect(settings.locator(':scope > *:not(svg):not(.editor-tooltip)')).toHaveCount(0);
  // The tooltip is what gives the word back, and only on hover: at rest it is transparent, so the
  // header reads as three glyphs. Measured as opacity rather than visibility because that is how
  // the bubble is revealed (`group-hover/tt:opacity-100`, on a 300ms delay).
  const tip = back.locator('.editor-tooltip');
  await expect(tip).toHaveText('記事一覧');
  await expect(tip).toHaveCSS('opacity', '0');
  await back.hover();
  await expect(tip).toHaveCSS('opacity', '1');
  // The mark row's group divider (§12.12) stands in for the ring a pointer never lost — a pointer
  // still has `hover:bg-zinc-100`, so it never needed either.
  await expect(page.locator('.toolbar-mark-divider').first()).toBeHidden();
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

  test('undo/redo scroll with the row and are reachable at its end', async ({ page }) => {
    // Superseded 2026-09-18: undo/redo used to sit outside `.toolbar-scroll`, pinned so a thumb
    // scrolling the row could return to them without hunting. Moved to the row's own end instead —
    // the marks ahead of them are reached far more often (unmeasured, but note's own mobile
    // toolbar makes the same call: undo/redo at its scroll strip's far end, not fixed) — so they
    // now scroll with everything else and cost no space at rest.
    await openEditor(page);
    await loadMarkdown(page, '本文\n');
    // Without this the undo below undoes the *load*: `setContent` is one history event and
    // subsequent typing groups with it otherwise (editor-history-buttons.spec.ts explains it).
    await closeHistory(page);
    await page.locator('.ProseMirror').click();
    await page.keyboard.press('End');
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
    expect(undoAfter.x).toBeLessThan(undoBefore.x);

    // A control scrolled into view is still reachable and still works — Playwright's click scrolls
    // its target into view first, so this also stands in for a real drag-to-scroll-then-tap
    // gesture.
    await page.keyboard.type('追記');
    await page.getByRole('button', { name: '元に戻す' }).click();
    await expect(page.locator('.ProseMirror')).not.toContainText('本文追記');
    await expect(page.locator('.ProseMirror')).toContainText('本文');
  });
});

// A pressed-without-ever-focusing regression (reported 2026-09-19): 引用・囲み枠・表 are all
// reachable from the ＋ sheet before the editor has ever had focus, and on Android/iOS
// (`isAndroid()`/`isiOS()`, checked below — this is why `editor-narrow-menus.spec.ts`'s own
// Chrome-desktop coverage never hit it) `.chain().focus()` calls `view.dom.focus()`
// *synchronously*. That raises a native `focus` event synchronously too, which
// `@tiptap/core`'s FocusEvents extension answers with its own `view.dispatch` — a transaction
// built from `editor.state` as of that instant. If the post's last block isn't a paragraph,
// trailing-node-extension.ts's `appendTransaction` rides that dispatch and advances the document
// — and the toolbar handler's *own* transaction, already under construction from the state a
// moment earlier, is stale by the time it dispatches: `RangeError: Applying a mismatched
// transaction`. Splitting `.chain().focus().X()` into `editor.commands.focus()` then
// `editor.chain().X()` does not fix this — `commands.focus()` hits the identical mismatch on its
// own dispatch, for the same reason. The fix in Toolbar.tsx/CalloutMenu.tsx/TableGridMenu.tsx is
// a raw `editor.view.dom.focus()` ahead of the chain, outside any tiptap command, so the nested
// dispatch settles before a transaction the handler cares about is ever built.
test.describe('pressing a ＋ row before the editor has ever had focus', () => {
  test.use(PHONE);

  // Ends in a table, not a paragraph — trailing-node-extension.ts has nothing to append until the
  // first transaction after mount, which on this path is the toolbar handler's own.
  const TABLE_TAIL_MD = '本文\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n';

  async function makeTableTailPost(page: Page, title: string): Promise<string> {
    await page.goto('/admin/posts/new');
    await page.getByLabel('タイトル').fill(title);
    await page.locator('.ProseMirror').click();
    await loadMarkdown(page, TABLE_TAIL_MD);
    await expectAutosaved(page);
    return page.url();
  }

  test('引用 does not throw and still wraps the last block', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    const url = await makeTableTailPost(page, 'E2E no-focus repro — 引用');

    await page.goto(url); // A fresh load, same as a hard reload — the editor has never had focus.
    await expect(page.locator('.ProseMirror table')).toBeVisible();
    await plus(page).click();
    await page
      .getByTestId('insert-menu-panel')
      .getByRole('button', { name: '引用', exact: true })
      .click();

    expect(errors).toEqual([]);
    await expect(page.locator('.ProseMirror blockquote')).toBeVisible();
  });

  test('囲み枠 does not throw and still inserts a callout', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    const url = await makeTableTailPost(page, 'E2E no-focus repro — 囲み枠');

    await page.goto(url);
    await expect(page.locator('.ProseMirror table')).toBeVisible();
    await plus(page).click();
    const panel = page.getByTestId('insert-menu-panel');
    await panel.getByRole('button', { name: '囲み枠', exact: true }).click();
    await panel.getByRole('button', { name: '注意', exact: true }).click();

    expect(errors).toEqual([]);
    await expect(page.locator('.ProseMirror [data-callout]')).toBeVisible();
  });

  test('表 does not throw and still inserts a table, from the drilldown fields', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    const url = await makeTableTailPost(page, 'E2E no-focus repro — 表');

    await page.goto(url);
    await expect(page.locator('.ProseMirror table')).toBeVisible();
    await plus(page).click();
    const panel = page.getByTestId('insert-menu-panel');
    await panel.getByRole('button', { name: '表', exact: true }).click();
    await panel.getByRole('button', { name: '表を追加' }).click();

    expect(errors).toEqual([]);
    await expect(page.locator('.ProseMirror table')).toHaveCount(2);
  });

  test('リンク does not throw opening the insert dialog', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    const url = await makeTableTailPost(page, 'E2E no-focus repro — リンク');

    await page.goto(url);
    await expect(page.locator('.ProseMirror table')).toBeVisible();
    await plus(page).click();
    await page
      .getByTestId('insert-menu-panel')
      .getByRole('button', { name: 'リンク', exact: true })
      .click();

    expect(errors).toEqual([]);
    await expect(page.getByRole('dialog', { name: 'リンクを挿入' })).toBeVisible();
  });
});

// Same bug (§12.21), reached from the bottom format bar instead of the ＋ sheet — its controls
// (太字, 大見出し, 箇条書き, …) are visible immediately when a post opens, so this is just as easy
// to hit as the ＋ rows were. `focus-then-run.ts`'s `focusThenRun` is the one fix shared by every
// mark/block/list toggle in Toolbar.tsx; these three stand in for the rest (a mark, a heading, a
// list toggle) rather than repeating the same call-shape check per button.
test.describe('pressing a format-bar control before the editor has ever had focus', () => {
  test.use(PHONE);

  const TABLE_TAIL_MD = '本文\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n';

  async function makeTableTailPost(page: Page, title: string): Promise<string> {
    await page.goto('/admin/posts/new');
    await page.getByLabel('タイトル').fill(title);
    await page.locator('.ProseMirror').click();
    await loadMarkdown(page, TABLE_TAIL_MD);
    await expectAutosaved(page);
    return page.url();
  }

  test('太字 does not throw and still marks the last block', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    const url = await makeTableTailPost(page, 'E2E no-focus repro — 太字');

    await page.goto(url);
    await expect(page.locator('.ProseMirror table')).toBeVisible();
    await page.getByRole('button', { name: '太字' }).click();

    expect(errors).toEqual([]);
    await expect(page.locator('.ProseMirror')).toHaveClass(/./); // still mounted, no crash
  });

  test('大見出し does not throw and still converts the last block', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    const url = await makeTableTailPost(page, 'E2E no-focus repro — H2');

    await page.goto(url);
    await expect(page.locator('.ProseMirror table')).toBeVisible();
    await page.getByRole('button', { name: '大見出し' }).click();

    expect(errors).toEqual([]);
  });

  test('箇条書き does not throw and still converts the last block', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    const url = await makeTableTailPost(page, 'E2E no-focus repro — 箇条書き');

    await page.goto(url);
    await expect(page.locator('.ProseMirror table')).toBeVisible();
    await page.getByRole('button', { name: '箇条書き' }).click();

    expect(errors).toEqual([]);
  });
});

// The other half of the same gate. Every assertion above runs under `PHONE`, so the touch copy is
// the only one a failing `pointer-only` would be seen through — and the copies `touch-only` hides
// (the ＋, the two list toggles) would go unmeasured entirely on a desktop viewport, where they
// have no business being drawn. This describe takes the project's own viewport, which is where
// `hover: hover` matches.
test.describe('on a pointer, the other copy of each pair is the one painted', () => {
  test('the ＋ and the list toggles are unpainted, and the toolbar keeps both groups', async ({
    page,
  }) => {
    await openEditor(page);

    // `touch-only`: both are in the DOM at this width, neither is drawn.
    await expect(page.locator('.insert-menu')).toHaveCount(1);
    await expect(page.locator('.insert-menu')).toBeHidden();
    await expect(page.locator('.list-buttons')).toHaveCount(1);
    await expect(page.locator('.list-buttons')).toBeHidden();

    // `pointer-only`: the copies the phone hides are the ones drawn here. `display: contents` means
    // the span itself has no box, so the claim is made through a control inside it — which is also
    // what rules out the marker having eaten the whole group.
    await expect(bar(page).getByRole('button', { name: 'リンク' })).toBeVisible();
    await expect(bar(page).getByRole('button', { name: 'リスト' })).toBeVisible();
    // And the touch copy's toggles are not in the accessibility tree beside it.
    await expect(bar(page).getByRole('button', { name: '箇条書き' })).toHaveCount(0);
  });
});
