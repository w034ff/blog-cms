import { test, expect, devices, type Page } from '@playwright/test';
import { closeHistory, loadMarkdown } from './editor-authoring';

// The toolbar's undo and redo (docs/table-requirements.md §12.4).
//
// Browser-only, and not only because the editor is: what these two add is a *route* — the command
// already existed under `Mod-z`, and the thing worth measuring is that a press reaches it, that the
// buttons say when the route is closed, and that the redo half survives the undo it follows. The
// disabled states are the half a unit test could not see at all: they are read off `editor.can()`
// at render time, so they only exist once a real editor has a history to answer from.
//
// **Emulated, because the buttons only exist under `hover: none`.** They are a touch control; a
// pointer has `Mod-z` and keeps the toolbar it had. A plain narrow viewport is not enough — it
// still reports `hover: hover`, so the whole file would be testing hidden buttons. The five keys
// below are `editor-narrow-menus.spec.ts`'s PHONE, listed for the reason stated there.
const PIXEL_7 = devices['Pixel 7'];
const PHONE = {
  viewport: PIXEL_7.viewport,
  userAgent: PIXEL_7.userAgent,
  deviceScaleFactor: PIXEL_7.deviceScaleFactor,
  isMobile: PIXEL_7.isMobile,
  hasTouch: PIXEL_7.hasTouch,
};

async function open(page: Page): Promise<void> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
}

const undo = (page: Page) => page.getByRole('button', { name: '元に戻す' });
const redo = (page: Page) => page.getByRole('button', { name: 'やり直す' });

test.describe('on an emulated phone', () => {
  test.use(PHONE);

  test('the buttons undo and redo a typed run', async ({ page }) => {
    await open(page);
    await page.keyboard.type('あいうえお');
    await expect(page.locator('.ProseMirror')).toContainText('あいうえお');

    await undo(page).click();
    await expect(page.locator('.ProseMirror')).not.toContainText('あいうえお');
    await redo(page).click();
    await expect(page.locator('.ProseMirror')).toContainText('あいうえお');
  });

  test('each button says when its half of the history is empty', async ({ page }) => {
    await open(page);
    // A fresh document has neither, and the greying is the only thing on screen that says so.
    await expect(undo(page)).toBeDisabled();
    await expect(redo(page)).toBeDisabled();

    await page.keyboard.type('あいうえお');
    await expect(undo(page)).toBeEnabled();
    await expect(redo(page)).toBeDisabled();

    await undo(page).click();
    await expect(redo(page)).toBeEnabled();
  });

  // The reason the pair exists. An author who opens a post and edits it has to be able to take back
  // that edit and no more, on a device where `Mod-z` needs a keyboard nobody has (§12.4).
  test('undo reaches an edit made on top of a loaded document, not the load itself', async ({
    page,
  }) => {
    await open(page);
    await loadMarkdown(page, '元の本文\n');
    await expect(page.locator('.ProseMirror')).toContainText('元の本文');
    // Without this the press below undoes the *document*: `setContent` is one history event and the
    // typing groups with it, so the first assertion came back with an empty editor. A real load
    // arrives as the editor's initial content and is not an event at all — the break is what makes
    // the test measure the gesture rather than the fixture (editor-authoring.ts says the rest).
    await closeHistory(page);
    await page.locator('.ProseMirror').click();
    await page.keyboard.press('End');
    await page.keyboard.type('と追記');
    await expect(page.locator('.ProseMirror')).toContainText('元の本文と追記');

    await undo(page).click();
    await expect(page.locator('.ProseMirror')).toContainText('元の本文');
    await expect(page.locator('.ProseMirror')).not.toContainText('と追記');
  });
});

// The other half of the decision, and the half a touch-only file would never notice: on a pointer
// the two are not drawn at all. Asserted as hidden rather than absent, because the rule is CSS and
// the markup is the same at every width — which is what keeps the first paint from being wrong
// (§12.4).
test('a pointer does not get the pair, nor the gap that follows it', async ({ page }) => {
  await open(page);
  await expect(undo(page)).toBeHidden();
  await expect(redo(page)).toBeHidden();
  await expect(page.locator('.sticky .toolbar-button-history')).toHaveCount(2);

  // The separator after the pair is a sibling margin, and `display: none` does not stop a sibling
  // selector from matching — written outside the `hover: none` block it would open a hole at the
  // left edge of a toolbar whose first visible button is 「大見出し」 (§12.4). Measured as the
  // heading's own margin rather than by comparing edges, which the row's padding would muddy.
  const margin = await page
    .getByRole('button', { name: '大見出し' })
    .evaluate((el) => getComputedStyle(el).marginLeft);
  expect(margin).toBe('0px');
});
