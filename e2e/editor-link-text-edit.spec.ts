import { test, expect, type Page } from '@playwright/test';
import { docString, markdown, settle } from './editor-probe';
import { closeHistory, loadMarkdown, setRange } from './editor-authoring';

// Rewriting a link's text in the body. **The edges' rule decides (§5.5.12)**: a replacement reaching
// the link's right edge lands outside it, one stopping short keeps mark, href and title. Hence the
// card's テキスト field (§5.5.13), which needs no knowledge of the boundary.
//
// A paste drops the mark when it replaces the mark's whole range: **accepted, not desired** (§10's
// reasons). Pinned so a @tiptap bump that changes it is noticed.

const MD = '前[リンク](https://example.com "タイトル")後\n';
// 「前リンク後」: 前 = 1..2, リンク = 2..5, 後 = 5..6.
const LINK_FROM = 2;
const LINK_TO = 5;

const PLAIN = 'doc(paragraph("前新しい後"))';

const pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (error) => pageErrors.push(error.message));
});
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

async function openEditor(page: Page, md: string): Promise<void> {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, md);
}

// A synthesized plain-text paste, as in editor-link-markdown-syntax.spec.ts.
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

test('retyping the whole link text unlinks it', async ({ page }) => {
  // §5.5.12's cost: the replacement reaches the edge, so no link remains, visibly.
  await openEditor(page, MD);
  await setRange(page, LINK_FROM, LINK_TO);
  await page.keyboard.type('新しい');
  await settle(page);
  expect(await docString(page)).toBe(PLAIN);
  expect(await markdown(page)).toBe('前新しい後');
});

test('a replacement that stops short of the right edge keeps the link', async ({ page }) => {
  // Leave the last character and the link keeps href and title: a boundary rule.
  await openEditor(page, MD);
  await setRange(page, LINK_FROM, LINK_TO - 1);
  await page.keyboard.type('りん');
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph("前", link("りんク"), "後"))');
  expect(await markdown(page)).toBe('前[りんク](https://example.com "タイトル")後');
});

test('a replacement that reaches the right edge leaves the typed text outside', async ({
  page,
}) => {
  // Keeping the first character is not enough: one end decides.
  await openEditor(page, MD);
  await setRange(page, LINK_FROM + 1, LINK_TO);
  await page.keyboard.type('んく');
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph("前", link("リ"), "んく後"))');
});

test('a replacement strictly inside the link keeps it', async ({ page }) => {
  await openEditor(page, MD);
  await setRange(page, LINK_FROM + 1, LINK_TO - 1);
  await page.keyboard.type('ん');
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph("前", link("リんク"), "後"))');
});

test('the card goes away with the link a full retype removed', async ({ page }) => {
  // No link under the caret, so no card.
  await openEditor(page, MD);
  await setRange(page, LINK_FROM, LINK_TO);
  await page.keyboard.type('新しい');
  await settle(page);
  await expect(page.getByRole('group', { name: 'リンク' })).toBeHidden();
});

test('deleting the whole link text and then typing leaves plain text', async ({ page }) => {
  // Ordinary semantics: the mark left with the text, visibly. The baseline for the paste case.
  await openEditor(page, MD);
  await setRange(page, LINK_FROM, LINK_TO);
  await page.keyboard.press('Backspace');
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph("前後"))');
  await page.keyboard.type('新しい');
  await settle(page);
  expect(await docString(page)).toBe(PLAIN);
});

test('a paste over the whole link text drops the link (accepted, §10)', async ({ page }) => {
  // The same gesture with the opposite result and no notice: a slice over the whole range leaves
  // nothing to inherit. **Pinned because §10 accepted it, not because it is wanted.**
  await openEditor(page, MD);
  await setRange(page, LINK_FROM, LINK_TO);
  await pasteText(page, '新しい');
  await settle(page);
  expect(await docString(page)).toBe(PLAIN);
});

test('a paste that keeps one character of the link text keeps the link', async ({ page }) => {
  // So the case above is about the whole range, not pasting into a link.
  await openEditor(page, MD);
  await setRange(page, LINK_FROM + 1, LINK_TO);
  await pasteText(page, 'んく');
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph("前", link("リんく"), "後"))');
});

test('one undo restores the link after such a paste', async ({ page }) => {
  // Its cost: one undo. `closeHistory` first, or the undo empties the fixture.
  await openEditor(page, MD);
  await closeHistory(page);
  await setRange(page, LINK_FROM, LINK_TO);
  await pasteText(page, '新しい');
  await settle(page);
  await page.keyboard.press('Control+z');
  await settle(page);
  expect(await markdown(page)).toBe('前[リンク](https://example.com "タイトル")後');
});
