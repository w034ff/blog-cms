import { test, expect, type Page } from '@playwright/test';
import { docString, markdown, settle } from './editor-probe';
import { loadMarkdown, setRange } from './editor-authoring';

// The link mark is not inclusive (link-extension.ts, docs/link-requirements.md §5.5.12): text typed
// at the right edge stays out, as at the left. `extension-link`'s
// `inclusive() { return this.options.autolink; }` tied it to autolink (§4), and the 。 after a link
// was swallowed. The rest pins what rides on the option and must not move; the card now resolves
// from the text before the caret (`linkAtCaret`, cases in editor-link-bubble.spec.ts).

const MD = '前[リンク](https://example.com "タイトル")後\n';
// 「前リンク後」: 前 = 1..2, リンク = 2..5, 後 = 5..6.
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

function card(page: Page) {
  return page.getByRole('group', { name: 'リンク' });
}

async function openEditor(page: Page, md?: string): Promise<void> {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  if (md) await loadMarkdown(page, md);
}

test('a character typed at a link right edge stays outside the link', async ({ page }) => {
  // The gesture this is for, asserted on the markdown too: `[リンク。](…)` publishes the 。 linked.
  await openEditor(page, MD);
  await setRange(page, LINK_RIGHT_EDGE);
  await page.keyboard.type('。');
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph("前", link("リンク"), "。後"))');
  expect(await markdown(page)).toBe('前[リンク](https://example.com "タイトル")。後');
});

test('a character typed at a link left edge stays outside the link', async ({ page }) => {
  // The left edge never was inclusive; kept so the pair is one rule.
  await openEditor(page, MD);
  await setRange(page, LINK_LEFT_EDGE);
  await page.keyboard.type('新');
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph("前新", link("リンク"), "後"))');
});

test('autolink still links a typed URL followed by a space', async ({ page }) => {
  // Autolink marks an explicit range from `appendTransaction` (`tokenize` →
  // `tr.addMark(link.from, link.to, …)`), never asking what the caret carries.
  await openEditor(page);
  await page.keyboard.type('https://example.org ');
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph(link("https://example.org"), " "))');
});

test('typing on after an autolink stays outside it', async ({ page }) => {
  // The triggering space is outside the range, so the caret is already out.
  await openEditor(page);
  await page.keyboard.type('https://example.org /foo');
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph(link("https://example.org"), " /foo"))');
});

test('the []() input rule still leaves the text after it unlinked', async ({ page }) => {
  // No longer needs `tr.removeStoredMark(type)` (link-input-rule.ts); the behaviour must stay.
  await openEditor(page);
  await page.keyboard.type('[断片](#見出し)つづき');
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph(link("断片"), "つづき"))');
  expect(await markdown(page)).toBe('[断片](#見出し)つづき');
});

test('the card goes away when an IME keystroke moves the caret out of the link', async ({
  page,
}) => {
  // Typing at the right edge through an IME left the card over a caret no longer in a link:
  // `@tiptap/extension-bubble-menu`'s `updateHandler` returns on `const { composing } = view;`, and
  // no later transaction re-asks. Composition over CDP: `keyboard.type` never sets `view.composing`
  // and passes on the broken build.
  await openEditor(page, MD);
  await setRange(page, LINK_RIGHT_EDGE);
  await expect(card(page)).toBeVisible();
  const client = await page.context().newCDPSession(page);
  await client.send('Input.imeSetComposition', { text: 'あ', selectionStart: 1, selectionEnd: 1 });
  await client.send('Input.insertText', { text: 'あ' });
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph("前", link("リンク"), "あ後"))');
  await expect(card(page)).toBeHidden();
});

test('a composition inside the link keeps the card', async ({ page }) => {
  // The other half: not "hide whenever composing".
  await openEditor(page, MD);
  await setRange(page, LINK_RIGHT_EDGE - 1);
  await expect(card(page)).toBeVisible();
  const client = await page.context().newCDPSession(page);
  await client.send('Input.imeSetComposition', { text: 'あ', selectionStart: 1, selectionEnd: 1 });
  await client.send('Input.insertText', { text: 'あ' });
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph("前", link("リンあク"), "後"))');
  await expect(card(page)).toBeVisible();
});

test('the caret at a right edge no longer reads as being in a link', async ({ page }) => {
  // `isActive('link')` and `getAttributes('link')` both say no link at the right edge. Restored
  // inclusiveness would fail here, leaving `linkAtCaret` answering nothing.
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
