import { test, expect, type Page } from '@playwright/test';
import { docString, historyState, markdown, settle } from './editor-probe';
import { closeHistory, loadMarkdown, setRange } from './editor-authoring';

// The link card's テキスト field (LinkBubble.tsx, docs/link-requirements.md §5.5.13): rewriting what
// a link says from the card. It must not flatten structured text: a mark held over the whole range
// is carried; text whose marks change partway, or non-text, gets no field.

const MD = '前[リンク](https://example.com "タイトル")後\n';
const IN_LINK = 3;

const pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /Cannot update|Maximum update depth/.test(message.text())) {
      pageErrors.push(message.text());
    }
  });
});
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

function card(page: Page) {
  return page.getByRole('group', { name: 'リンク' });
}
function textField(page: Page) {
  return card(page).getByLabel('テキスト');
}
function hrefField(page: Page) {
  return card(page).getByLabel('リンク先');
}

async function openEditor(page: Page, md: string): Promise<void> {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, md);
}

// Into edit mode over the link at `pos`.
async function openEdit(page: Page, pos: number): Promise<void> {
  await setRange(page, pos);
  await expect(card(page)).toBeVisible();
  await card(page).getByRole('button', { name: '編集' }).click();
  await expect(hrefField(page)).toBeVisible();
}

test('the field opens carrying the link text', async ({ page }) => {
  await openEditor(page, MD);
  await openEdit(page, IN_LINK);
  await expect(textField(page)).toHaveValue('リンク');
  await expect(hrefField(page)).toHaveValue('https://example.com');
  // Visible labels (§5.5.13); every selector here uses them, so without this a lost label reads as
  // "the card never opened".
  await expect(textField(page)).toHaveAccessibleName('テキスト');
  await expect(hrefField(page)).toHaveAccessibleName('リンク先');
});

test('a new text is written into the document, and the href and title survive', async ({
  page,
}) => {
  // The title is on the mark, and rebuilding the mark from the href would drop it (§5.3-3).
  await openEditor(page, MD);
  await openEdit(page, IN_LINK);
  await textField(page).fill('新しいリンク');
  await page.keyboard.press('Enter');
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph("前", link("新しいリンク"), "後"))');
  expect(await markdown(page)).toBe('前[新しいリンク](https://example.com "タイトル")後');
});

test('the text and the href change together, in one undo', async ({ page }) => {
  // One transaction, by history depth: an undo can look right while a second event hides.
  await openEditor(page, MD);
  await closeHistory(page);
  const before = await historyState(page);
  await openEdit(page, IN_LINK);
  await textField(page).fill('別の名前');
  await hrefField(page).fill('/posts/hello');
  await page.keyboard.press('Enter');
  await settle(page);
  expect(await markdown(page)).toBe('前[別の名前](/posts/hello "タイトル")後');
  expect((await historyState(page)).undoDepth).toBe(before.undoDepth + 1);
});

test('the card still describes the link after the text is replaced', async ({ page }) => {
  // The replacement moves the selection and the anchoring `<a>`, which §5.5.7 records and no document
  // assertion sees. An unanswerable href keeps a fetched title from replacing the URL line (§5.5.10);
  // with `example.com` this read differently with and without a network.
  await openEditor(page, '前[リンク](http://127.0.0.1:1/x "タイトル")後\n');
  await openEdit(page, IN_LINK);
  await textField(page).fill('新しいリンク');
  await page.keyboard.press('Enter');
  await settle(page);
  await expect(card(page)).toBeVisible();
  await expect(card(page).getByRole('button', { name: 'リンク先を開く' })).toContainText(
    '127.0.0.1',
  );
  await expect(page.locator('.link-bubble-target')).toHaveText('新しいリンク');
});

test('an unchanged text costs nothing', async ({ page }) => {
  // An untouched field leaves the text node alone.
  await openEditor(page, MD);
  await openEdit(page, IN_LINK);
  await hrefField(page).fill('/posts/hello');
  await page.keyboard.press('Enter');
  await settle(page);
  expect(await markdown(page)).toBe('前[リンク](/posts/hello "タイトル")後');
});

test('an emptied text field is refused, and changes nothing', async ({ page }) => {
  // An empty URL removes the link, so an empty テキスト refuses aloud instead.
  await openEditor(page, MD);
  await openEdit(page, IN_LINK);
  await textField(page).fill('');
  await page.keyboard.press('Enter');
  await settle(page);
  await expect(page.getByText('リンクのテキストは空にできません')).toBeVisible();
  expect(await markdown(page)).toBe('前[リンク](https://example.com "タイトル")後');
  await expect(textField(page)).toBeVisible();
});

test('a refused href leaves the text alone', async ({ page }) => {
  // Gated before running: a chain dispatches what succeeded before a refusal.
  await openEditor(page, MD);
  await openEdit(page, IN_LINK);
  await textField(page).fill('新しいリンク');
  await hrefField(page).fill('javascript:alert(1)');
  await page.keyboard.press('Enter');
  await settle(page);
  await expect(page.getByText('このリンク先は公開できないため設定していません')).toBeVisible();
  expect(await markdown(page)).toBe('前[リンク](https://example.com "タイトル")後');
});

test('a uniformly bold link keeps its bold through the rewrite', async ({ page }) => {
  // The reported case: a bold link (`[**打率.077**](…)`) got no field. The whole mark set travels.
  await openEditor(page, '前[**リンク**](https://example.com "タイトル")後\n');
  await openEdit(page, IN_LINK);
  await expect(textField(page)).toHaveValue('リンク');
  await textField(page).fill('新しいリンク');
  await page.keyboard.press('Enter');
  await settle(page);
  // The markdown shows the bold kept inside the link.
  expect(await markdown(page)).toBe('前[**新しいリンク**](https://example.com "タイトル")後');
});

test('a uniformly 強調 link keeps its mark through the rewrite', async ({ page }) => {
  // 強調 nests in a link (§7.1) and round-trips as raw inline HTML (accent-emphasis-extension.ts): a
  // different path than `**`.
  await openEditor(
    page,
    '前[<span class="accent-emphasis">強調リンク</span>](https://example.com)後\n',
  );
  await openEdit(page, IN_LINK);
  await expect(textField(page)).toHaveValue('強調リンク');
  await textField(page).fill('新しい強調');
  await page.keyboard.press('Enter');
  await settle(page);
  expect(await markdown(page)).toBe(
    '前[<span class="accent-emphasis">新しい強調</span>](https://example.com)後',
  );
});

test('a bold link inside a footnote definition is editable too', async ({ page }) => {
  // As reported, in a footnote definition: `editableLinkText` walks `nodesBetween` from the root,
  // and the section's parent is not an ordinary block. Reached by clicking, as reported.
  await openEditor(
    page,
    '本文[^fn-a]\n\n[^fn-a]: 注[**打率.077**](https://example.com "グロ")後\n',
  );
  await page.locator('.ProseMirror a', { hasText: '打率.077' }).click();
  await expect(card(page)).toBeVisible();
  await card(page).getByRole('button', { name: '編集' }).click();
  await expect(textField(page)).toHaveValue('打率.077');
  await textField(page).fill('打率.100');
  await page.keyboard.press('Enter');
  await settle(page);
  expect(await markdown(page)).toContain('注[**打率.100**](https://example.com "グロ")後');
});

test("the field is absent when the text's marks change partway", async ({ page }) => {
  // Half 強調: one text node has one mark set, so no field rather than flattening.
  await openEditor(
    page,
    '前[<span class="accent-emphasis">強調</span>リンク](https://example.com)後\n',
  );
  // Asserted, or a fixture that lost the mark would pass for the opposite reason.
  expect(await docString(page)).toBe(
    'doc(paragraph("前", link(accentEmphasis("強調")), link("リンク"), "後"))',
  );
  await openEdit(page, IN_LINK);
  await expect(textField(page)).toHaveCount(0);
  await expect(hrefField(page)).toBeVisible();
});

test('the field is absent while a link is being made', async ({ page }) => {
  // `Mod-k` needs a selection: the author just picked the text, so no field.
  await openEditor(page, '前リンク後\n');
  await setRange(page, 2, 5);
  await page.locator('.ProseMirror').press('Control+k');
  await expect(hrefField(page)).toBeVisible();
  await expect(textField(page)).toHaveCount(0);
});

test('the href edit still works from a link right edge', async ({ page }) => {
  // At the right edge via `linkAtCaret` (§5.5.12); `extendMarkRange` carries the href there.
  await openEditor(page, MD);
  await openEdit(page, 5);
  await expect(textField(page)).toHaveValue('リンク');
  await textField(page).fill('新しいリンク');
  await page.keyboard.press('Enter');
  await settle(page);
  expect(await markdown(page)).toBe('前[新しいリンク](https://example.com "タイトル")後');
});
