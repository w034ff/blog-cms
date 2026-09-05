import { test, expect, type Page } from '@playwright/test';
import { docString, historyState, settle } from './editor-probe';
import { closeHistory } from './editor-authoring';

// What one Ctrl+Z takes back after a link appeared on its own (docs/link-requirements.md §12).
//
// §4 keeps `autolink` on, so a typed URL becomes a link without being asked. The reflex when that
// was not wanted is Ctrl+Z, and the question §9 carried unmeasured until 2026-08-27 was what that
// key actually removes: the mark alone, or the text it was typed on.
//
// The mark is not its own command. `autolink()` (@tiptap/extension-link, `key: new
// PluginKey("autolink")`) adds it from `appendTransaction`, returning a plain `tr` with neither
// `addToHistory: false` nor a history-closing meta — so it lands in the same dispatch round as the
// keystroke that triggered it. Whether that is one undo event or two is prosemirror-history's
// grouping, and this file measures it instead of reasoning about it.
//
// **`/api/drafts` is blocked for every case here.** The reported symptom was "undo goes back to
// where autosave ran", and the point of blocking is that the boundary still appears when autosave
// provably cannot: `AUTOSAVE_DELAY_MS` is 800 (components/editor/useAutosave.ts) while
// prosemirror-history's `newGroupDelay` is 500, so every autosave is preceded by a pause that has
// already closed the group. Autosave is the visible mark of the pause, not its cause — and
// useAutosave never touches the editor at all. With the route blocked the pause needs no upper
// bound, which keeps this file off the 200ms-margin timing shape §5.5.10 paid for.

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

// A paste the editor sees as a paste, the same instrument the other link specs use (§9 records
// that a real Ctrl+V is not measured anywhere).
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
  // The whole run is one event, so the key that removes the link removes the text it was typed on.
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
  // The half that answers the report. `/api/drafts` is aborted, so nothing was saved during the
  // pause — and the run still splits in two. 1000ms is past `newGroupDelay` (500) with no upper
  // bound to race, because the thing the old explanation named cannot fire at all here.
  await openEditor(page);
  await closeHistory(page);
  const before = (await historyState(page)).undoDepth;

  // Counted here rather than in a shared binding: the route handler outlives the test, and a
  // module-scoped counter would start reporting another test's saves the day this file runs with
  // more than one worker. What 14b rests on is that autosave *tried*, so the count has to be this
  // test's own.
  let saveAttempts = 0;
  await page.route('**/api/drafts', (route) => {
    saveAttempts += 1;
    return route.abort();
  });

  await page.keyboard.type('見て');
  // 1500, not 1000. The pause has to clear two clocks — `newGroupDelay` (500) for the split this
  // case is about, and the autosave debounce (800) for the assertion below that autosave tried.
  // At 1000 the second of those had 200ms of margin, which is the shape docs/link-requirements.md
  // §5.5.10 paid for once. Blocking the route means there is no upper bound to trade against, so
  // the margin is free: take it. (This file failed here once, on 2026-08-27, and did not reproduce
  // in six repeats; the trace was gone by then. Widening is not a diagnosis — it removes the only
  // time dependency the case has, which is a different claim and the honest one.)
  await page.waitForTimeout(1500);
  // Autosave reached for the network during the pause and was refused: the pause is a real one by
  // its own clock, and nothing it did could have reached the editor.
  expect(saveAttempts).toBeGreaterThan(0);
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
  // The paste route is a different plugin — `markPasteRule` links the URL inside the pasted text
  // (route (c), §2.1), not `autolink`'s appendTransaction — but it reaches history the same way,
  // and the author meets the same result: one Ctrl+Z and the pasted text is gone with the link.
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
