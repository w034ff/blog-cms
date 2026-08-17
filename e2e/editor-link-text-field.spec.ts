import { test, expect, type Page } from '@playwright/test';
import { docString, historyState, markdown, settle } from './editor-probe';
import { closeHistory, loadMarkdown, setRange } from './editor-authoring';

// The link card's テキスト field (components/editor/LinkBubble.tsx, docs/link-requirements.md
// §5.5.13): rewriting what a link *says*, from the card, without touching the body.
//
// The body was always able to do it — the link text is marked text, not an atom — but that is not
// the route an author takes to a link they are already editing from the card. What the field buys
// is that route; what it must not do is flatten a link whose text has structure inside it, which is
// why it is absent for those links rather than refusing on save.

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

// Into the card's edit mode over the link at `pos`, the way an author gets there.
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
  // Each field says which one it is, in text the author can see (§5.5.13). Every selector in this
  // file resolves a field by that name, so without this assertion the labels could be taken away
  // and the whole file would fail as "the card never opened" instead.
  await expect(textField(page)).toHaveAccessibleName('テキスト');
  await expect(hrefField(page)).toHaveAccessibleName('リンク先');
});

test('a new text is written into the document, and the href and title survive', async ({
  page,
}) => {
  // The title is the part that would go silently: it is on the mark, not in the text, and a
  // replacement that rebuilt the mark from the href alone would drop it — a silent edit of a
  // published post (§5.3-3).
  await openEditor(page, MD);
  await openEdit(page, IN_LINK);
  await textField(page).fill('新しいリンク');
  await page.keyboard.press('Enter');
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph("前", link("新しいリンク"), "後"))');
  expect(await markdown(page)).toBe('前[新しいリンク](https://example.com "タイトル")後');
});

test('the text and the href change together, in one undo', async ({ page }) => {
  // One chain, so one transaction. Asserted on the history depth rather than by pressing Ctrl+Z
  // and looking: a save that cost two events would still *look* right after one undo if the second
  // event were the one that mattered.
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
  // The replacement moves both the selection and the `<a>` the card is anchored to, which is the
  // shape §5.5.7 records as "the card slides / the tint detaches" — and no assertion about the
  // document can see it.
  //
  // An href nothing can answer for, so the card's first line is the URL rather than a fetched page
  // title (§5.5.10). With `example.com` this test read "Example Domain" on a machine with a network
  // and the URL on one without.
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
  // Leaving the field alone must not rewrite the text node: the comparison against the value the
  // field opened with is what keeps a plain href edit exactly what it was before this existed.
  await openEditor(page, MD);
  await openEdit(page, IN_LINK);
  await hrefField(page).fill('/posts/hello');
  await page.keyboard.press('Enter');
  await settle(page);
  expect(await markdown(page)).toBe('前[リンク](/posts/hello "タイトル")後');
});

test('an emptied text field is refused, and changes nothing', async ({ page }) => {
  // Emptying the *URL* already means "remove this link". Giving the adjacent field the same meaning
  // would make one gesture answer two questions, so this one refuses out loud instead.
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
  // The reason the whole save is gated *before* it runs: a chain dispatches the commands that did
  // succeed even when a later one refuses, so a rejected scheme would otherwise have left the text
  // rewritten and the link still pointing where it always did.
  await openEditor(page, MD);
  await openEdit(page, IN_LINK);
  await textField(page).fill('新しいリンク');
  await hrefField(page).fill('javascript:alert(1)');
  await page.keyboard.press('Enter');
  await settle(page);
  await expect(page.getByText('このリンク先は公開できないため設定していません')).toBeVisible();
  expect(await markdown(page)).toBe('前[リンク](https://example.com "タイトル")後');
});

test('the field is absent for a link whose text carries another mark', async ({ page }) => {
  // 強調 nests inside a link — `accentEmphasis.excludes` omits `link` (§14) — so this is reachable
  // rather than hypothetical. Replacing the range with one text node would flatten it, so the card
  // does not offer to.
  // The mark round-trips as raw inline HTML — it has no markdown syntax of its own
  // (accent-emphasis-extension.ts) — so the fixture is written the way the serializer writes it.
  await openEditor(
    page,
    '前[<span class="accent-emphasis">強調</span>リンク](https://example.com)後\n',
  );
  // Asserted, because a fixture that quietly failed to carry the mark would leave this test
  // passing for the opposite reason.
  expect(await docString(page)).toBe(
    'doc(paragraph("前", link(accentEmphasis("強調")), link("リンク"), "後"))',
  );
  await openEdit(page, IN_LINK);
  await expect(textField(page)).toHaveCount(0);
  await expect(hrefField(page)).toBeVisible();
});

test('the field is absent while a link is being made', async ({ page }) => {
  // `Mod-k` requires a non-empty selection, so the text already exists and the author has just
  // chosen it: a field there would only offer to replace what they picked.
  await openEditor(page, '前リンク後\n');
  await setRange(page, 2, 5);
  await page.locator('.ProseMirror').press('Control+k');
  await expect(hrefField(page)).toBeVisible();
  await expect(textField(page)).toHaveCount(0);
});

test('the href edit still works from a link right edge', async ({ page }) => {
  // The card reaches the right edge through `linkAtCaret` now (§5.5.12), and the save has to reach
  // it too — `extendMarkRange` is what carries the href there when the text is untouched.
  await openEditor(page, MD);
  await openEdit(page, 5);
  await expect(textField(page)).toHaveValue('リンク');
  await textField(page).fill('新しいリンク');
  await page.keyboard.press('Enter');
  await settle(page);
  expect(await markdown(page)).toBe('前[新しいリンク](https://example.com "タイトル")後');
});
