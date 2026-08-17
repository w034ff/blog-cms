import { test, expect, type Page } from '@playwright/test';
import { docString, markdown, settle } from './editor-probe';
import { closeHistory, loadMarkdown, setRange } from './editor-authoring';

// Rewriting a link's text *in the body* — the route that existed before the card grew a テキスト
// field (§5.5.13), and still the one an author takes while typing rather than while editing a link.
//
// **One rule decides the typed cases, and it is the edges' rule (§5.5.12): a replacement that
// reaches the link's right edge lands outside the link, one that stops short of it lands inside.**
// A caret typing at the right edge is the empty case of the same rule. So the whole link text
// retyped comes back unlinked, while a replacement that leaves the last character alone keeps the
// mark, href and title. That changed on 2026-08-17 — the mark used to be inclusive and every one of
// these kept the link — and it is the cost the card's テキスト field answers: the body can still
// rewrite a link's text, but only the field does it without the author knowing where the boundary
// is.
//
// A paste answers differently again: it drops the mark whenever it replaces the mark's *whole*
// range and keeps it otherwise, and that is **accepted, not desired** — §10 records the four
// reasons (the loss is visible, the gesture is rare, one Ctrl+Z restores it, and any fix would be a
// rule about every mark's paste semantics rather than about links). Pinned so a @tiptap bump that
// changes it is noticed, not because it is what we want.

const MD = '前[リンク](https://example.com "タイトル")後\n';
// 「前リンク後」— paragraph content starts at 1. 前 = 1..2, リンク = 2..5, 後 = 5..6.
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

// A plain-text paste at the current selection, synthesized rather than driven through the OS
// clipboard (the shape editor-link-markdown-syntax.spec.ts uses) so it needs no permissions and
// stays deterministic. A real Ctrl+V is not measured by any of this.
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
  // The cost of §5.5.12, at the place an author meets it. The replacement reaches the right edge,
  // so the typed text lands outside the link — and the whole text having gone with it, no link is
  // left at all. Not silent: the blue and the underline go at the same moment.
  await openEditor(page, MD);
  await setRange(page, LINK_FROM, LINK_TO);
  await page.keyboard.type('新しい');
  await settle(page);
  expect(await docString(page)).toBe(PLAIN);
  expect(await markdown(page)).toBe('前新しい後');
});

test('a replacement that stops short of the right edge keeps the link', async ({ page }) => {
  // The other side of the same rule, and why it is a boundary rule rather than "typing over a link
  // loses it": leave the last character alone and the link keeps its href and its title.
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
  // Keeping the *first* character is not enough. The boundary is one end, not "some of the link
  // survived", and this is the case that separates the two readings.
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
  // Not a regression to fix — there is no link under the caret any more, so a card describing one
  // would be describing nothing. Pinned because a card still standing there would mean the mark had
  // survived somewhere this file says it does not.
  await openEditor(page, MD);
  await setRange(page, LINK_FROM, LINK_TO);
  await page.keyboard.type('新しい');
  await settle(page);
  await expect(page.getByRole('group', { name: 'リンク' })).toBeHidden();
});

test('deleting the whole link text and then typing leaves plain text', async ({ page }) => {
  // Ordinary ProseMirror semantics — the mark left with the text, and the author watched it go.
  // Here as the baseline that makes the paste case below legible, not as a finding.
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
  // The same visible gesture as the retype above — select the text, put new text in — with the
  // opposite result and no notice. Replacing the mark's entire range with a slice leaves nothing
  // for the new text to inherit from. **Pinned because §10 accepted it, not because it is wanted.**
  await openEditor(page, MD);
  await setRange(page, LINK_FROM, LINK_TO);
  await pasteText(page, '新しい');
  await settle(page);
  expect(await docString(page)).toBe(PLAIN);
});

test('a paste that keeps one character of the link text keeps the link', async ({ page }) => {
  // Which is what says the case above is about replacing the *whole range*, not about pasting into
  // a link at all.
  await openEditor(page, MD);
  await setRange(page, LINK_FROM + 1, LINK_TO);
  await pasteText(page, 'んく');
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph("前", link("リんく"), "後"))');
});

test('one undo restores the link after such a paste', async ({ page }) => {
  // How expensive the accepted behaviour is. `closeHistory` first: setContent is a single history
  // event, so without the break the paste groups with the fixture and the undo empties the whole
  // paragraph — which says nothing about the paste.
  await openEditor(page, MD);
  await closeHistory(page);
  await setRange(page, LINK_FROM, LINK_TO);
  await pasteText(page, '新しい');
  await settle(page);
  await page.keyboard.press('Control+z');
  await settle(page);
  expect(await markdown(page)).toBe('前[リンク](https://example.com "タイトル")後');
});
