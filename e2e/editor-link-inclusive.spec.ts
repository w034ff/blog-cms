import { test, expect, type Page } from '@playwright/test';
import { docString, markdown, settle } from './editor-probe';
import { loadMarkdown, setRange } from './editor-authoring';

// The link mark is not inclusive (components/editor/link-extension.ts, docs/link-requirements.md
// §5.5.12): what is typed at a link's right edge stays out of the link, the same as at its left.
//
// `extension-link` writes `inclusive() { return this.options.autolink; }`, so keeping autolink on
// (§4) had also decided the right edge. In Japanese prose the character after a link is usually 。
// or 、, and it was being swallowed: `前[リンク](…)後` became `前[リンク。](…)後` on one keystroke.
//
// The rest of this file is the other half of that change: the things that ride on the same option
// and had to be measured *not* to move. Only one did — the card, which used to read the link off
// the caret and now resolves it from the text before the caret (LinkBubble.tsx `linkAtCaret`). The
// card's own cases live in editor-link-bubble.spec.ts; what is pinned here is the boundary itself.

const MD = '前[リンク](https://example.com "タイトル")後\n';
// 「前リンク後」— paragraph content starts at 1. 前 = 1..2, リンク = 2..5, 後 = 5..6.
const LINK_LEFT_EDGE = 2;
const LINK_RIGHT_EDGE = 5;

const pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (error) => pageErrors.push(error.message));
});
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

async function openEditor(page: Page, md?: string): Promise<void> {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  if (md) await loadMarkdown(page, md);
}

test('a character typed at a link right edge stays outside the link', async ({ page }) => {
  // The gesture this change exists for. Asserted on the markdown as well as the document, because
  // what is at stake is the stored form: `[リンク。](…)` publishes the 。 inside the anchor.
  await openEditor(page, MD);
  await setRange(page, LINK_RIGHT_EDGE);
  await page.keyboard.type('。');
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph("前", link("リンク"), "。後"))');
  expect(await markdown(page)).toBe('前[リンク](https://example.com "タイトル")。後');
});

test('a character typed at a link left edge stays outside the link', async ({ page }) => {
  // Unchanged by all of this — the left edge was never inclusive. Kept so the pair reads as one
  // rule rather than as one measured edge and one assumed one.
  await openEditor(page, MD);
  await setRange(page, LINK_LEFT_EDGE);
  await page.keyboard.type('新');
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph("前新", link("リンク"), "後"))');
});

test('autolink still links a typed URL followed by a space', async ({ page }) => {
  // `inclusive()` returned `this.options.autolink`, so the two looked like one decision. They are
  // not: the autolink plugin applies the mark to an explicit range from its own appendTransaction
  // (`tokenize` → `tr.addMark(link.from, link.to, …)`), and never asks what the caret carries.
  await openEditor(page);
  await page.keyboard.type('https://example.org ');
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph(link("https://example.org"), " "))');
});

test('typing on after an autolink stays outside it', async ({ page }) => {
  // True before the change too, and for a reason that has nothing to do with inclusiveness: the
  // space that triggers autolink is itself outside the marked range, so the caret is already out.
  await openEditor(page);
  await page.keyboard.type('https://example.org /foo');
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph(link("https://example.org"), " /foo"))');
});

test('the []() input rule still leaves the text after it unlinked', async ({ page }) => {
  // The rule used to need `tr.removeStoredMark(type)` for this; the mark not being inclusive is
  // what retired that line (link-input-rule.ts). The behaviour it bought has to stay.
  await openEditor(page);
  await page.keyboard.type('[断片](#見出し)つづき');
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph(link("断片"), "つづき"))');
  expect(await markdown(page)).toBe('[断片](#見出し)つづき');
});

test('the caret at a right edge no longer reads as being in a link', async ({ page }) => {
  // The fact the card had to be rewritten around, pinned directly: `isActive('link')` and
  // `getAttributes('link')` — the two questions LinkBubble used to ask — both answer "no link" at
  // the right edge now. A future bump that restored inclusiveness would turn this red, which is the
  // point: the card's own resolution (`linkAtCaret`) would then be answering a question nobody asks.
  await openEditor(page, MD);
  await setRange(page, LINK_RIGHT_EDGE);
  const atCaret = await page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as
      | (Element & {
          editor?: {
            isActive(name: string): boolean;
            getAttributes(name: string): Record<string, unknown>;
          };
        })
      | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    return {
      isActive: el.editor.isActive('link'),
      attrs: Object.keys(el.editor.getAttributes('link')).length,
    };
  });
  expect(atCaret).toEqual({ isActive: false, attrs: 0 });
});
