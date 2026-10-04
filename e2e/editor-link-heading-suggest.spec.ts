import { test, expect, type Page } from '@playwright/test';
import { markdown, settle } from './editor-probe';
import { loadMarkdown, setRange } from './editor-authoring';

// The link card's heading picker (LinkBubble.tsx, document-headings.ts): `#` in リンク先 offers the
// document's headings. A fragment cannot be read off a heading (`API と CLI（詳細）` is
// `#api-と-cli詳細`, a second `導入` `#導入-1`), and one that misses renders as a dead link.
// document-headings.test.ts pins the slugs; this is the interaction.

// The link first, so its position is stable. Two `導入`: the second is `#導入-1`, and an h3.
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
  // Watch for throws: the card's keydown broke once on a synthetic event (§5.5), and a throw in a DOM
  // handler looks like nothing happening.
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
  // Exact: リンク先を開く would match once the field is gone.
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
  // Before loadMarkdown, so the click does not move the loaded caret.
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
  // The slug beside each heading is what an author would get wrong.
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
  // Only a leading `#` triggers it, not an external URL's fragment.
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
  // The second `導入`, unnameable by hand.
  await expect(hrefField(page)).toHaveValue('#導入-1');
  // Picking closes the list; the second Enter applies.
  await expect(suggestions(page)).toBeHidden();

  await page.keyboard.press('Enter');
  await settle(page);
  expect(await markdown(page)).toContain('前[リンク](#導入-1)後');
});

test('Enter applies at once when the fragment is already written out in full', async ({ page }) => {
  // The list takes Enter only if it would change something, so a fully typed fragment, or `Mod-k`,
  // needs no second press.
  await openEditor(page, MD);
  await openEdit(page, IN_LINK);
  // Two rows match; the highlighted one is what is typed.
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
  // Rows prevent mousedown so the field keeps focus; a blur would remove the card mid-press.
  await rows(page).nth(1).click();
  await expect(hrefField(page)).toHaveValue('#api-と-cli詳細');
  await expect(card(page)).toBeVisible();
});

test('Escape closes the list and keeps the card and what was typed', async ({ page }) => {
  // While the list is up Escape stops at the list; the card's Escape would discard the edit.
  await openEditor(page, MD);
  await openEdit(page, IN_LINK);
  await hrefField(page).fill('#導');
  await expect(rows(page)).toHaveCount(2);

  await page.keyboard.press('Escape');
  await expect(suggestions(page)).toBeHidden();
  await expect(card(page)).toBeVisible();
  await expect(hrefField(page)).toHaveValue('#導');

  // The second Escape leaves the field unapplied; the card stays in display mode (the caret is in
  // the link).
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
  // Written by hand: the full-width brackets are not in the id.
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
  // The heading's text reaches the document; the slug is only the target.
  await page.keyboard.press('Enter');
  await settle(page);
  expect(await markdown(page)).toContain('[API と CLI（詳細）](#api-と-cli詳細)');
});

// Its last line near the window's bottom, with headings enough for a full-height list (three made
// a list that fitted below and would pass on the broken build).
const TALL_MD = [
  ...Array.from({ length: 9 }, (_, i) => `## 見出し ${i + 1}\n`),
  ...Array.from({ length: 14 }, (_, i) => `段落 ${i + 1} — 本文の行がここに続きます。\n`),
  '前[リンク](https://example.com)後',
  '',
].join('\n');

// The picker over the last link, its line `gap` px above the bottom.
async function openNearBottom(page: Page, gap: number) {
  await openEditor(page, TALL_MD);
  const link = page.locator('.ProseMirror a', { hasText: 'リンク' });
  await link.click();
  await expect(card(page)).toBeVisible();
  const linkBox = (await link.boundingBox())!;
  const viewport = page.viewportSize()!;
  await page.evaluate(
    (dy) => window.scrollBy(0, dy),
    linkBox.y + linkBox.height - (viewport.height - gap),
  );
  await card(page).getByRole('button', { name: '編集' }).click();
  await hrefField(page).fill('#');
  await expect(suggestions(page)).toBeVisible();
}

test('a list that will not fit below the card goes above it', async ({ page }) => {
  await openNearBottom(page, 90);
  const list = (await suggestions(page).boundingBox())!;
  const field = (await hrefField(page).boundingBox())!;
  const viewport = page.viewportSize()!;

  // On screen at all: the report. The card scrolls with the view, so an offscreen row is unreachable.
  expect(list.y).toBeGreaterThanOrEqual(0);
  expect(list.y + list.height).toBeLessThanOrEqual(viewport.height);
  // Above the card, clear of its field.
  expect(list.y + list.height).toBeLessThanOrEqual(field.y);
  // Full height: flip's case, not the cap's (§5.5.17).
  expect(list.height).toBeGreaterThan(150);
});

test('a list that fits on neither side is cut down to the roomier one', async ({ page }) => {
  // Neither side holds the list: flip alone fails here; 420px was not short enough.
  await page.setViewportSize({ width: 1280, height: 320 });
  await openNearBottom(page, 90);
  const list = (await suggestions(page).boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(list.y).toBeGreaterThanOrEqual(0);
  expect(list.y + list.height).toBeLessThanOrEqual(viewport.height);
  expect(list.height).toBeLessThan(192);
  // A list cut to nothing would pass the bounds.
  expect(await rows(page).count()).toBeGreaterThan(0);
  expect(list.height).toBeGreaterThan(40);
});

test('a text the author wrote is left alone', async ({ page }) => {
  await openEditor(page, MD);
  await openEdit(page, IN_LINK);
  await hrefField(page).fill('#');
  await rows(page).nth(0).click();
  await expect(textField(page)).toHaveValue('リンク');
});
