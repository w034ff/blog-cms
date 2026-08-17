import { test, expect, type Page } from '@playwright/test';
import { markdown, settle } from './editor-probe';
import { loadMarkdown, setRange } from './editor-authoring';

// The link card's heading picker (components/editor/LinkBubble.tsx, components/editor/
// document-headings.ts): typing `#` into リンク先 offers this document's headings and writes the
// fragment that reaches them.
//
// It exists because the fragment is not something an author can read off a heading — measured
// against the render pipeline, `API と CLI（詳細）` is reached as `#api-と-cli詳細` and a second
// `導入` as `#導入-1` — and a fragment that misses by one character is refused nowhere: it renders
// as an ordinary link that lands on nothing. document-headings.test.ts pins the slugs themselves
// against that pipeline; this file is about the interaction, which only a browser can answer.

// The link comes first so the caret position into it does not move when the headings below change.
// Two `導入` deliberately: the second one is `#導入-1`, which is the rule no author can see, and it
// is also an h3, so the row's indent has something to show.
const MD = [
  '前[リンク](https://example.com)後',
  '',
  '## 導入',
  '',
  '## API と CLI（詳細）',
  '',
  '### 導入',
  '',
].join('\n');
const IN_LINK = 3;

const pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors.length = 0;
  // The card's own keydown handling has been broken by an event wrapper before (§5.5: `.key` on the
  // menu's synthetic event throws "Illegal invocation"), and a throw inside a DOM handler shows up
  // as nothing happening. Watch for it rather than infer it from a failed assertion.
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
function hrefField(page: Page) {
  // Exact: the display card's open button is labelled リンク先を開く, and a substring match resolves
  // to it once the field is gone — which would make "the field is still open" quietly true.
  return card(page).getByLabel('リンク先', { exact: true });
}
function textField(page: Page) {
  return card(page).getByLabel('テキスト');
}
function suggestions(page: Page) {
  return card(page).getByRole('listbox', { name: '見出しの候補' });
}
function rows(page: Page) {
  return suggestions(page).getByRole('option');
}

async function openEditor(page: Page, md: string): Promise<void> {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  // Before loadMarkdown: a click afterwards would land on the loaded document and move the caret.
  await editor.click();
  await loadMarkdown(page, md);
}

async function openEdit(page: Page, pos: number): Promise<void> {
  await setRange(page, pos);
  await expect(card(page)).toBeVisible();
  await card(page).getByRole('button', { name: '編集' }).click();
  await expect(hrefField(page)).toBeVisible();
}

test('a `#` lists every heading with the fragment it writes', async ({ page }) => {
  await openEditor(page, MD);
  await openEdit(page, IN_LINK);
  await expect(suggestions(page)).toBeHidden();

  await hrefField(page).fill('#');
  await expect(rows(page)).toHaveCount(3);
  // The slug beside each heading is the part that teaches: these three strings are exactly what an
  // author guessing from the heading would get wrong.
  await expect(rows(page).nth(0)).toContainText('#導入');
  await expect(rows(page).nth(1)).toContainText('#api-と-cli詳細');
  await expect(rows(page).nth(2)).toContainText('#導入-1');

  // 3 行目は h3 だが、行の始まりは h2 と同じ x にある（§5.5.17）。絞り込みで親が消える一覧では、
  // 段差は無い関係を指すことになる。
  const paddingLeft = (index: number) =>
    rows(page)
      .nth(index)
      .evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
  expect(await paddingLeft(2)).toBe(await paddingLeft(0));
});

test('a `#` inside a URL is not a heading query', async ({ page }) => {
  // Only the first character triggers it. An external URL carrying a fragment would otherwise raise
  // this document's headings over a field that has nothing to do with them.
  await openEditor(page, MD);
  await openEdit(page, IN_LINK);
  await hrefField(page).fill('https://example.com/#section');
  await expect(suggestions(page)).toBeHidden();
});

test('typing filters, and the arrow keys and Enter pick a row', async ({ page }) => {
  await openEditor(page, MD);
  await openEdit(page, IN_LINK);
  await hrefField(page).fill('#導');
  await expect(rows(page)).toHaveCount(2);

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  // The second `導入`, which is the one an author cannot name by hand.
  await expect(hrefField(page)).toHaveValue('#導入-1');
  // Picking closes the list; it does not apply the link. That takes the second Enter.
  await expect(suggestions(page)).toBeHidden();

  await page.keyboard.press('Enter');
  await settle(page);
  expect(await markdown(page)).toContain('前[リンク](#導入-1)後');
});

test('Enter applies at once when the fragment is already written out in full', async ({ page }) => {
  // The list holds Enter only while pressing it would change something. An author who typed the
  // whole fragment — or every existing sequence that ends `#…` + Enter, `Mod-k` included — must not
  // grow a second press for the same result.
  await openEditor(page, MD);
  await openEdit(page, IN_LINK);
  // Matches two rows, and the highlighted one is exactly what is typed.
  await hrefField(page).fill('#導入');
  await expect(rows(page)).toHaveCount(2);
  await page.keyboard.press('Enter');
  await settle(page);
  expect(await markdown(page)).toContain('前[リンク](#導入)後');
});

test('a click on a row picks it', async ({ page }) => {
  await openEditor(page, MD);
  await openEdit(page, IN_LINK);
  await hrefField(page).fill('#');
  // mousedown is prevented on these rows so the field keeps the focus — a plain click that blurred
  // it would take the card away a frame later and the press would land on nothing.
  await rows(page).nth(1).click();
  await expect(hrefField(page)).toHaveValue('#api-と-cli詳細');
  await expect(card(page)).toBeVisible();
});

test('Escape closes the list and keeps the card and what was typed', async ({ page }) => {
  // The card's own Escape closes the whole card, taking an unapplied edit with it. While the list
  // is up the key has to stop at the list — this is the one interaction here that can cost an
  // author work.
  await openEditor(page, MD);
  await openEdit(page, IN_LINK);
  await hrefField(page).fill('#導');
  await expect(rows(page)).toHaveCount(2);

  await page.keyboard.press('Escape');
  await expect(suggestions(page)).toBeHidden();
  await expect(card(page)).toBeVisible();
  await expect(hrefField(page)).toHaveValue('#導');

  // And the second Escape still does what it always did: leave the field without applying it. The
  // card itself stays, in display mode, because the caret is still inside the link — hiding it is
  // the *display* card's Escape, one press further on.
  await page.keyboard.press('Escape');
  await expect(hrefField(page)).toBeHidden();
  await expect(card(page).getByRole('button', { name: '編集' })).toBeVisible();
  expect(await markdown(page)).toContain('前[リンク](https://example.com)後');
});

test('a query that matches nothing says so, which is where a bad fragment shows up', async ({
  page,
}) => {
  await openEditor(page, MD);
  await openEdit(page, IN_LINK);
  // What an author writing the heading out by hand gets: the full-width brackets are not in the id.
  await hrefField(page).fill('#api-と-cli（詳細）');
  await expect(rows(page)).toHaveCount(0);
  await expect(suggestions(page)).toContainText('一致する見出しがありません');
});

test('a document with no headings says that instead', async ({ page }) => {
  await openEditor(page, '前[リンク](https://example.com)後\n');
  await openEdit(page, IN_LINK);
  await hrefField(page).fill('#');
  await expect(suggestions(page)).toContainText('この文書には見出しがありません');
});

test('picking a heading fills an empty テキスト field with its text', async ({ page }) => {
  await openEditor(page, MD);
  await openEdit(page, IN_LINK);
  await textField(page).fill('');
  await hrefField(page).fill('#');
  await rows(page).nth(1).click();
  await expect(textField(page)).toHaveValue('API と CLI（詳細）');
  // And the heading's own text is what reaches the document — the slug is only the destination.
  await page.keyboard.press('Enter');
  await settle(page);
  expect(await markdown(page)).toContain('[API と CLI（詳細）](#api-と-cli詳細)');
});

test('a text the author wrote is left alone', async ({ page }) => {
  await openEditor(page, MD);
  await openEdit(page, IN_LINK);
  await hrefField(page).fill('#');
  await rows(page).nth(0).click();
  await expect(textField(page)).toHaveValue('リンク');
});
