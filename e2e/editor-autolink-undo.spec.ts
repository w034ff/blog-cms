import { test, expect, type Page } from '@playwright/test';
import { docString, historyState, settle } from './editor-probe';
import { closeHistory } from './editor-authoring';

// What one Ctrl+Z takes back after an autolink (docs/link-requirements.md §12). `autolink()`
// (@tiptap/extension-link, `key: new PluginKey("autolink")`) adds the mark from `appendTransaction`
// with no history meta, so it lands with the keystroke; whether that is one undo event is
// prosemirror-history's grouping, measured here.
//
// **`/api/drafts` is blocked throughout.** The report blamed autosave for the undo boundary, but
// `AUTOSAVE_DELAY_MS` (800, useAutosave.ts) exceeds `newGroupDelay` (500), so the pause closes the
// group first and autosave never touches the editor. Blocked, the pause needs no upper bound.

const URL_TEXT = 'https://example.com';

const pageErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/api/drafts', (route) => route.abort());
});
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

async function openEditor(page: Page): Promise<void> {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
}

// A paste the editor sees as one (§9: a real Ctrl+V is measured nowhere).
function pasteText(page: Page, text: string): Promise<void> {
  return page.evaluate((value) => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', value);
    document
      .querySelector('.ProseMirror')
      ?.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
  }, text);
}

test('a typed run and the link autolink put on it undo together (14a)', async ({ page }) => {
  // One event: the key removing the link removes the typed text.
  await openEditor(page);
  await closeHistory(page);
  const before = (await historyState(page)).undoDepth;

  await page.keyboard.type(`見て ${URL_TEXT} `);
  await settle(page);
  expect(await docString(page)).toBe(`doc(paragraph("見て ", link("${URL_TEXT}"), " "))`);
  expect((await historyState(page)).undoDepth).toBe(before + 1);

  await page.keyboard.press('Control+z');
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph)');
  expect((await historyState(page)).undoDepth).toBe(before);
});

test('a pause of its own closes the group, with no autosave in reach (14b)', async ({ page }) => {
  // With nothing saved, the pause still splits the run: past `newGroupDelay`, with no upper bound.
  await openEditor(page);
  await closeHistory(page);
  const before = (await historyState(page)).undoDepth;

  // Counted per test: the route handler outlives it, and a module counter would read other tests'
  // saves under several workers.
  let saveAttempts = 0;
  await page.route('**/api/drafts', (route) => {
    saveAttempts += 1;
    return route.abort();
  });

  await page.keyboard.type('見て');
  await settle(page);

  // **The two halves of `before + 2`, asked separately**: a bare "expected 2, received 1" cannot say
  // whether the first run failed to group or the pause failed to split. This half: `closeHistory`
  // held and the first run landed before the pause.
  const afterFirst = await historyState(page);
  expect(afterFirst.undoDepth, 'the first run is its own group before the pause').toBe(before + 1);

  // 1500: clears `newGroupDelay` (500) and the autosave debounce (800) with margin; blocking the route
  // removes any upper bound.
  await page.waitForTimeout(1500);
  // Autosave tried and was refused: a real pause, touching nothing.
  expect(saveAttempts).toBeGreaterThan(0);

  // The pause on prosemirror-history's own clock: `prevTime` is its last transaction, and a later one
  // groups separately only past `newGroupDelay`. A lower bound, so if it holds the real gap does.
  const gap = (await page.evaluate(() => Date.now())) - afterFirst.prevTime;
  expect(gap, 'the pause exceeds newGroupDelay by history\u2019s own clock').toBeGreaterThan(500);

  await page.keyboard.type(` ${URL_TEXT} `);
  await settle(page);
  expect(await docString(page)).toBe(`doc(paragraph("見て ", link("${URL_TEXT}"), " "))`);
  expect((await historyState(page)).undoDepth).toBe(before + 2);

  await page.keyboard.press('Control+z');
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph("見て"))');
  expect((await historyState(page)).undoDepth).toBe(before + 1);
});

test('a pasted URL and the link made of it undo together (14c)', async ({ page }) => {
  // A paste links through `markPasteRule` (route (c), §2.1), not `autolink`, but reaches history the
  // same way: one Ctrl+Z removes the text with the link.
  await openEditor(page);
  await closeHistory(page);
  const before = (await historyState(page)).undoDepth;

  await pasteText(page, URL_TEXT);
  await settle(page);
  expect(await docString(page)).toBe(`doc(paragraph(link("${URL_TEXT}")))`);
  expect((await historyState(page)).undoDepth).toBe(before + 1);

  await page.keyboard.press('Control+z');
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph)');
  expect((await historyState(page)).undoDepth).toBe(before);
});
