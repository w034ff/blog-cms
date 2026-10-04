import { test, expect, devices, type BrowserContext, type Page } from '@playwright/test';
import { closeHistory, expectAutosaved, loadMarkdown } from './editor-authoring';

// The editor's chrome on a phone (docs/editor-requirements.md §12.5): format controls in a bar at
// the bottom, 囲み枠・表・リンク・画像 behind the header's ＋. Arrangement is not in the markup (both
// copies are in the DOM and a media query picks), so only a browser can see it.
//
// **Not measurable here: the software keyboard.** Emulation has none to raise the
// `bottom: var(--editor-kb-inset)` bar (as docs/link-requirements.md §5.5.21); §12.5 records the
// real-device check.
const PIXEL_7 = devices['Pixel 7'];
// The keys a describe may take: `defaultBrowserType` and `channel` are worker-scoped (§5.5.21). As
// in editor-narrow-menus.spec.ts.
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
    // Its bottom edge is the screen's, within a pixel (a 2.625 scale factor lands fractional pixels).
    expect(Math.abs(box!.y + box!.height - height)).toBeLessThanOrEqual(1);
    // Not pinned under the header, where it used to be.
    expect(box!.y).toBeGreaterThan(height / 2);
  });

  test('the post is not written underneath the bar', async ({ page }) => {
    await openEditor(page);
    // The bar's measured height (`--editor-toolbar-h`): the row wraps at 320px.
    const [padding, height] = await Promise.all([
      page.locator('.ProseMirror').evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom)),
      bar(page).evaluate((el) => el.getBoundingClientRect().height),
    ]);
    expect(padding).toBeGreaterThanOrEqual(height - 1);
  });

  test('the insert controls are in the ＋, not in the bar', async ({ page }) => {
    await openEditor(page);
    // The pointer copy is in the DOM, unpainted; `getByRole` sees only exposed elements, so the copies
    // never collide for specs naming these controls.
    await expect(bar(page).locator('.toolbar-insert')).toBeHidden();
    await expect(bar(page).getByRole('button', { name: 'リンク' })).toHaveCount(0);
    await expect(bar(page).getByRole('button', { name: '引用', exact: true })).toHaveCount(0);

    await expect(plus(page)).toBeVisible();
    await plus(page).click();
    const panel = page.getByTestId('insert-menu-panel');
    await expect(panel).toBeVisible();
    for (const name of ['囲み枠', '表', 'リンク', '引用', '画像']) {
      await expect(panel.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await expect(panel.getByTestId('image-picker-touch')).toHaveCount(1);
    // A full-width bottom sheet (§12.18): no anchor edge cases left.
    const box = (await panel.boundingBox())!;
    const width = await page.evaluate(() => document.documentElement.clientWidth);
    expect(box.x).toBe(0);
    expect(box.width).toBe(width);

    // The sheet's heading, plain text: 「挿入」 cannot be a button's name (InsertMenu.tsx says why).
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

    // A modal backdrop over the post and the bar. `z-\[45\]` because 記事の設定's
    // `.post-settings-backdrop` is always in the DOM with the same shape classes.
    const backdrop = page.locator('.fixed.inset-0.z-\\[45\\].bg-black\\/40');
    await expect(backdrop).toBeVisible();

    // `min-h-[40vh]` is a floor, not the content height.
    const [panelHeight, viewportHeight] = await Promise.all([
      panel.evaluate((el) => el.getBoundingClientRect().height),
      page.evaluate(() => window.innerHeight),
    ]);
    expect(panelHeight / viewportHeight).toBeGreaterThanOrEqual(0.4 - 0.01);

    // The sheet paints over the bar, not just contains its rect (§12.18's portal): in the header's
    // `sticky z-40` context the sheet's `z-50` lost to the bar. `elementFromPoint` catches that; a rect
    // comparison would not.
    const barCenterHitsSheet = await bar(page).evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return Boolean(hit?.closest('[data-testid="insert-menu-panel"]'));
    });
    expect(barCenterHitsSheet).toBe(true);

    // A backdrop tap dismisses and does nothing else.
    await backdrop.click({ position: { x: 5, y: 5 } });
    await expect(panel).toBeHidden();
    await expect(backdrop).toBeHidden();
    await expect(page.locator('.ProseMirror')).toHaveText('本文');
  });

  // Neither the sheet nor InsertDialog is a native `<dialog>`, so the background scroll lock is ours
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

    const backdrop = page.locator('.fixed.inset-0.z-\\[45\\].bg-black\\/40');
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

  // The sheet stayed mounted under the dialog (`fill()` is no mousedown for `useDismiss`) and,
  // portalled later at equal z-index, blocked 挿入する. InsertDialog.tsx's `z-[55]` fixes the stacking;
  // insert-menu-nav.ts says why the dialog uses `onCancel`/`onCommit` props.
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

  // Another call site of the dialog: a cancel must not open the ＋ sheet (`insertDialogFromDrawer`).
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
    // Steppers replace the row list in the sheet (§12.20), not the pointer's grid (TableGridMenu.tsx
    // says why). Default 3×3.
    await panel.getByRole('button', { name: '行数を減らす' }).click();
    await panel.getByRole('button', { name: '列数を減らす' }).click();
    await panel.getByRole('button', { name: '表を追加' }).click();
    await expect(page.locator('.ProseMirror table')).toBeVisible();
    // A pick is final, so the whole sheet closes (TableGridMenu.tsx's `insert`).
    await expect(panel).not.toBeVisible();
  });

  // §12.20: on touch, a row's picker takes over the sheet's body and 戻る returns. insert-menu-nav.ts
  // portals it into InsertMenu.tsx's slot rather than remounting CalloutMenu/TableGridMenu, which
  // would orphan state held on the row's component.
  test('囲み枠 in the ＋ drills into the sheet, not a floating panel', async ({ page }) => {
    await openEditor(page);
    await plus(page).click();
    const panel = page.getByTestId('insert-menu-panel');
    await panel.getByRole('button', { name: '囲み枠', exact: true }).click();

    // Heading and ＞ become 戻る plus the row's title, in the one `<h2>` (InsertMenu.tsx).
    await expect(panel.getByRole('heading', { name: '囲み枠', exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: '戻る' })).toBeVisible();
    await expect(page.getByTestId('toolbar-dropdown-panel')).toHaveCount(0);

    // Full-width rows continuing the list (§12.19), not the pointer's `.dropdown-item`s.
    const noteRow = panel.getByRole('button', { name: '注意', exact: true });
    const rowBox = (await noteRow.boundingBox())!;
    const panelWidth = (await panel.boundingBox())!.width;
    expect(rowBox.width).toBeGreaterThan(panelWidth * 0.9);

    await noteRow.click();
    await expect(page.locator('.ProseMirror [data-callout]')).toBeVisible();
    // A pick is final, so the sheet closes (CalloutMenu.tsx's `choose`).
    await expect(panel).not.toBeVisible();
  });

  // Steppers, not the grid: a tap commits before any hover preview, and 16px cells are under the 40px
  // floor. A size the 8×8 grid cannot reach keeps the steppers' own `TABLE_MAX_ROWS`/`TABLE_MAX_COLS`
  // clamps live.
  test('表 in the ＋: the steppers insert a size the grid could not reach directly', async ({
    page,
  }) => {
    await openEditor(page);
    await plus(page).click();
    const panel = page.getByTestId('insert-menu-panel');
    await panel.getByRole('button', { name: '表', exact: true }).click();
    await expect(panel.getByRole('button', { name: '2行2列の表を挿入' })).toHaveCount(0);

    // From 3×3: +9 rows to 12, −1 col to 2.
    const growRows = panel.getByRole('button', { name: '行数を増やす' });
    for (let i = 0; i < 9; i++) await growRows.click();
    await panel.getByRole('button', { name: '列数を減らす' }).click();
    await panel.getByRole('button', { name: '表を追加' }).click();

    const rows = page.locator('.ProseMirror table tr');
    await expect(rows).toHaveCount(12);
    await expect(rows.first().locator('th')).toHaveCount(2);
    // Final, so the sheet closes.
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
    // 引用/脚注/画像 left the sheet open over their change (insert-menu-nav.ts's `closeMenu`). 囲み枠/表
    // drill in and リンク opens InsertDialog, tested separately.
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
    // The name is what an icon-only control loses by default, so it is asserted (§12.6).
    const back = page.getByRole('link', { name: '記事一覧' });
    await expect(back).toBeVisible();
    // Icon alone: `hover: none` paints no tooltip (app/globals.css). `toHaveText` would be satisfied
    // by the tooltip's textContent, so assert what is painted.
    await expect(back.locator('.editor-tooltip')).toBeHidden();
    await expect(back.locator(':scope > *:not(svg):not(.editor-tooltip)')).toHaveCount(0);

    // Square at the header's 34px floor, not 40px: `.editor-header-bar` drops its own controls
    // (app/globals.css). `min-height` alone would leave a sliver (§12.3).
    const box = (await back.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(34);
    expect(box.width).toBeGreaterThanOrEqual(34);

    await back.click();
    await expect(page).toHaveURL(/\/admin$/);
  });

  test('記事の設定 is a gear, still named and still opening its panel', async ({ page }) => {
    await openEditor(page);
    // As for the back arrow (§12.6): icon-only still needs the word as its name.
    const settings = page.getByRole('button', { name: '記事の設定' });
    await expect(settings).toBeVisible();
    await expect(settings.locator('.editor-tooltip')).toBeHidden();
    await expect(settings.locator(':scope > *:not(svg):not(.editor-tooltip)')).toHaveCount(0);

    // 34px, as the back arrow.
    const box = (await settings.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(34);
    expect(box.width).toBeGreaterThanOrEqual(34);

    await expect(settings).toHaveAttribute('aria-expanded', 'false');
    await settings.click();
    await expect(settings).toHaveAttribute('aria-expanded', 'true');
  });

  test('記事の設定 leaves a tappable strip of its own backdrop on a phone', async ({ page }) => {
    // Not `w-full`, which would cover the only other way to dismiss on touch (no Escape); as the
    // ＋ sheet (§12.18).
    await openEditor(page);
    await page.getByRole('button', { name: '記事の設定' }).click();
    await expect(page.getByLabel('カテゴリ')).toBeVisible();

    const drawerBox = (await page.locator('#post-settings-panel').boundingBox())!;
    expect(drawerBox.x).toBeGreaterThan(0);

    // The drawer's close at the 40px floor (§12.28, CloseButton.tsx).
    const closeBox = (await page.getByRole('button', { name: '閉じる' }).boundingBox())!;
    expect(closeBox.width).toBe(40);
    expect(closeBox.height).toBe(40);

    await page.mouse.click(5, 100);
    await expect(page.getByRole('button', { name: '記事の設定' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  test('the format bar has no left inset on touch, so H2 sits flush with its edge', async ({
    page,
  }) => {
    // §12.14: the bar's `px-2` stacked with the first wide mark's centring gap; zeroed on touch only.
    await openEditor(page);
    const padding = await bar(page).evaluate((el) => getComputedStyle(el).paddingLeft);
    expect(padding).toBe('0px');
    const [barBox, h2Box] = [
      (await bar(page).boundingBox())!,
      (await page.getByRole('button', { name: '大見出し' }).boundingBox())!,
    ];
    expect(h2Box.x).toBeCloseTo(barBox.x, 0);
  });

  test('autosave is silent while saving, a checkmark once saved, worded on failure', async ({
    page,
  }) => {
    await openEditor(page);
    await page.keyboard.type('本文');

    // 保存中…: the full text is pointer-only (§12.6), and the compact copy skips this state (§12.14).
    await expect(page.locator('.autosave-status-full')).toBeHidden();
    await expect(page.locator('.autosave-status-compact')).toHaveCount(0);

    // 保存済み ✓: a checkmark, named by `aria-label`.
    await expect(page.locator('.autosave-status-compact')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.autosave-status-compact')).toHaveText('✓');
    await expect(page.locator('.autosave-status-compact')).toHaveAttribute(
      'aria-label',
      '保存済み ✓',
    );

    // 保存に失敗 keeps its words at every size (§12.14).
    await page.route('**/api/drafts', (route) => route.abort());
    await page.keyboard.type('追記');
    await expect(page.getByText('保存に失敗')).toBeVisible({ timeout: 10_000 });
  });

  // The press state (§12.7), via `CSS.forcePseudoState`: a tap is down and up in one call, with no
  // moment to read the style.
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
    // The same node the style is read from: `forcePseudoState` acts on this node only.
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

    // Not the 「オン」 colour, or a held 太字 that is already on would show nothing.
    await bold.click();
    const on = await background();
    expect(on).not.toBe(rest);
    expect(pressed).not.toBe(on);
  });

  test('the row has dividers between H3/B, after 強調, and before 元に戻す, and no ring (§12.12/§12.17)', async ({
    page,
  }) => {
    // An empty flex item shrinks to 0 in the scroll strip; `shrink-0` keeps it 1px.
    const dividers = page.locator('.toolbar-mark-divider');
    await openEditor(page);
    await expect(dividers).toHaveCount(3);
    for (const box of await dividers.evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect()),
    )) {
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
    }

    // No toolbar button rings (§12.2/§12.12; editor-narrow-menus.spec.ts 12j checks them all): the
    // divider and each glyph mark boundaries in the mark row.
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
    // The toast hangs off the bar, so the bar moving to the bottom could drop it off screen. The
    // orphan-footnote notice fires on load (docs/footnote-requirements.md §5.4).
    await loadMarkdown(page, '本文[^a]\n\n[^a]: A の注\n\n[^x]: 参照のない注\n');
    const toast = page.getByText(/参照されていない脚注が 1 件/);
    await expect(toast).toBeVisible();

    const [toastBox, barBox] = [(await toast.boundingBox())!, (await bar(page).boundingBox())!];
    const height = await page.evaluate(() => window.innerHeight);
    // Above the bar and on screen.
    expect(toastBox.y + toastBox.height).toBeLessThanOrEqual(barBox.y + 1);
    expect(toastBox.y).toBeGreaterThanOrEqual(0);
    expect(toastBox.y + toastBox.height).toBeLessThanOrEqual(height);
  });
});

// §12.5 leaves the pointer arrangement: controls in the top toolbar, no ＋.
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
  // The header's controls are icons on a pointer too (§12.6, §12.8): the words are in `aria-label`
  // and a tooltip, so assert the name.
  const back = page.getByRole('link', { name: '記事一覧' });
  const settings = page.getByRole('button', { name: '記事の設定' });
  await expect(back).toBeVisible();
  await expect(settings).toBeVisible();
  await expect(back.locator(':scope > *:not(svg):not(.editor-tooltip)')).toHaveCount(0);
  await expect(settings.locator(':scope > *:not(svg):not(.editor-tooltip)')).toHaveCount(0);
  // The tooltip gives the word back on hover only; opacity, since that is how it reveals
  // (`group-hover/tt:opacity-100`, 300ms delay).
  const tip = back.locator('.editor-tooltip');
  await expect(tip).toHaveText('記事一覧');
  await expect(tip).toHaveCSS('opacity', '0');
  await back.hover();
  await expect(tip).toHaveCSS('opacity', '1');
  // The divider (§12.12) stands in for the ring; a pointer has `hover:bg-zinc-100` instead.
  await expect(page.locator('.toolbar-mark-divider').first()).toBeHidden();
});

// The marks scroll instead of wrapping (§12.11); at 40px they overflow only on the narrowest
// screens, so 320px rather than 412px, where the strip fits exactly.
test.describe('on a narrow emulated phone', () => {
  test.use({ ...PHONE, viewport: { width: 320, height: 800 } });

  test('the toolbar is one row, and the marks are 40px wide', async ({ page }) => {
    await openEditor(page);
    const height = await bar(page).evaluate((el) => el.getBoundingClientRect().height);
    // One row.
    expect(height).toBeLessThan(50);

    for (const name of ['大見出し', '太字', '斜体', '取り消し線', '強調']) {
      const box = (await page.getByRole('button', { name }).boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(40);
      expect(box.height).toBeGreaterThanOrEqual(40);
    }
  });

  test('undo/redo scroll with the row and are reachable at its end', async ({ page }) => {
    // Undo/redo sit at the strip's end and scroll with it, as in note's toolbar: the marks ahead are
    // used far more often.
    await openEditor(page);
    await loadMarkdown(page, '本文\n');
    // Otherwise the undo below undoes the load (editor-history-buttons.spec.ts explains it).
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

    // Scrolled into view it still works; Playwright's click scrolls first, standing in for a swipe.
    await page.keyboard.type('追記');
    await page.getByRole('button', { name: '元に戻す' }).click();
    await expect(page.locator('.ProseMirror')).not.toContainText('本文追記');
    await expect(page.locator('.ProseMirror')).toContainText('本文');
  });
});

// §12.21: on Android/iOS (`isAndroid()`/`isiOS()`, so desktop Chrome never hits it)
// `.chain().focus()` calls `view.dom.focus()` synchronously; FocusEvents dispatches from the state
// of that instant, trailing-node's `appendTransaction` rides it, and the handler's own transaction
// is stale: `RangeError: Applying a mismatched transaction`. `commands.focus()` first fails the
// same way. The fix is a raw `editor.view.dom.focus()` before the chain (Toolbar.tsx,
// CalloutMenu.tsx, TableGridMenu.tsx).
test.describe('pressing a ＋ row before the editor has ever had focus', () => {
  test.use(PHONE);

  // Ends in a table, so trailing-node has something to append on the first transaction.
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

// §12.21 from the format bar, visible as soon as a post opens. `focusThenRun` (focus-then-run.ts)
// serves every toggle; a mark, a heading and a list toggle stand in for the rest.
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

// The other half of the gate: every test above runs as `PHONE`, so a failing `pointer-only`, and
// the copies `touch-only` hides, are only visible here, at the project's `hover: hover` viewport.
test.describe('on a pointer, the other copy of each pair is the one painted', () => {
  test('the ＋ and the list toggles are unpainted, and the toolbar keeps both groups', async ({
    page,
  }) => {
    await openEditor(page);

    // `touch-only`: in the DOM, not drawn.
    await expect(page.locator('.insert-menu')).toHaveCount(1);
    await expect(page.locator('.insert-menu')).toBeHidden();
    await expect(page.locator('.list-buttons')).toHaveCount(1);
    await expect(page.locator('.list-buttons')).toBeHidden();

    // `pointer-only`: drawn here. `display: contents` gives the span no box, so assert a control
    // inside.
    await expect(bar(page).getByRole('button', { name: 'リンク' })).toBeVisible();
    await expect(bar(page).getByRole('button', { name: 'リスト' })).toBeVisible();
    // The touch copy's toggles are not in the accessibility tree.
    await expect(bar(page).getByRole('button', { name: '箇条書き' })).toHaveCount(0);
  });
});
