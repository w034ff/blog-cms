import { test, expect, type Page } from '@playwright/test';
import { docString, markdown, settle } from './editor-probe';
import { loadMarkdown, selectInside, setRange } from './editor-authoring';

// The link card (components/editor/LinkBubble.tsx, docs/link-requirements.md §5.5): the editor's
// only link UI. It answers two measured holes — there was no way to make an internal link at all
// (§2.1.1), and `openOnClick: false` (§3) had removed "open this link" — so the cases below are
// mostly about what an author can now *do*, not about a regression.
//
// Positions are set programmatically rather than by clicking: a caret-placing click reaches
// `state.selection` a debounce later (§5.5.4-6), and these tests care about the exact caret, not
// about where a click lands. The one click-driven case polls instead of reading once.

const MD = '前[リンク](https://example.com "タイトル")後\n';
// 「前リンク後」— doc positions: 2 is the link's left edge, 3..4 inside it, 5 its right edge.
const IN_LINK = 3;
const LINK_RIGHT_EDGE = 5;
const OUTSIDE_LINK = 1;

function card(page: Page) {
  return page.getByRole('group', { name: 'リンク' });
}

// Every case in this file watches for a thrown error, because one of them hid here: the event this
// menu hands a prop callback is `Object.create(realEvent)`, so reading `.key` off it threw
// "Illegal invocation" on every keystroke inside the card — and a throw inside a DOM handler looks
// exactly like nothing happening. The card kept working, so no assertion about the document would
// ever have caught it. Follows publish-flow.spec.ts, which watches console errors too (render-phase
// violations arrive that way in dev).
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

async function openEditor(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as Window & { __opened?: string[] };
    w.__opened = [];
    window.open = (url?: string | URL) => {
      w.__opened?.push(String(url ?? ''));
      return null;
    };
  });
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, MD);
}

test('the card appears with the href when the caret is in a link', async ({ page }) => {
  await openEditor(page);
  await setRange(page, IN_LINK);
  await expect(card(page)).toBeVisible();
  // Seeing where a link points is the half of this the `openOnClick: false` trade took away.
  await expect(card(page)).toContainText('https://example.com');
});

test('the card stays away when the caret is outside a link', async ({ page }) => {
  await openEditor(page);
  await setRange(page, OUTSIDE_LINK);
  await settle(page);
  await expect(card(page)).toBeHidden();
});

test('the card appears with the caret at a link right edge', async ({ page }) => {
  // Where a click most often lands. It works because the mark is inclusive, which it is only
  // because §4 kept `autolink: true` — the coupling is worth pinning.
  await openEditor(page);
  await setRange(page, LINK_RIGHT_EDGE);
  await expect(card(page)).toBeVisible();
});

test('解除 removes the link from the right edge too', async ({ page }) => {
  await openEditor(page);
  await setRange(page, LINK_RIGHT_EDGE);
  await card(page).getByRole('button', { name: '解除' }).click();
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph("前リンク後"))');
  await expect(card(page)).toBeHidden();
});

test('編集 changes the href and keeps the title', async ({ page }) => {
  // The one real link in the corpus carries a `title`, and the public sanitizer keeps it — losing
  // it while fixing a URL would be a silent edit of a published post (§5.3-3).
  await openEditor(page);
  await setRange(page, IN_LINK);
  await card(page).getByRole('button', { name: '編集' }).click();
  const field = card(page).getByRole('textbox', { name: 'リンク先' });
  await expect(field).toBeFocused();
  await field.fill('https://changed.example');
  await field.press('Enter');
  await settle(page);
  expect(await markdown(page)).toBe('前[リンク](https://changed.example "タイトル")後');
});

test('開く opens the href in a new tab', async ({ page }) => {
  await openEditor(page);
  await setRange(page, IN_LINK);
  await card(page).getByRole('button', { name: '開く' }).click();
  expect(
    await page.evaluate(() => (window as Window & { __opened?: string[] }).__opened ?? []),
  ).toEqual(['https://example.com']);
});

test('Mod-k over a selection makes an internal link', async ({ page }) => {
  // §2.1.1: no path in this editor could produce one. linkifyjs finds neither a fragment nor a
  // relative path, and typed `[]()` is escaped on save before the parser ever sees it (§2.2.1).
  await openEditor(page);
  await loadMarkdown(page, 'ここを見出しにつなぐ\n');
  await setRange(page, 1, 3); // 「ここ」
  await page.keyboard.press('Control+k');
  const field = card(page).getByRole('textbox', { name: 'リンク先' });
  await expect(field).toBeFocused();
  await field.fill('#見出し');
  await field.press('Enter');
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph(link("ここ"), "を見出しにつなぐ"))');
  expect(await markdown(page)).toBe('[ここ](#見出し)を見出しにつなぐ');
});

test('Mod-k with an empty selection says what to do instead of making an empty link', async ({
  page,
}) => {
  await openEditor(page);
  await setRange(page, OUTSIDE_LINK);
  await page.keyboard.press('Control+k');
  await expect(page.getByText('リンクにするテキストを選択してください')).toBeVisible();
  await expect(card(page)).toBeHidden();
});

test('the URL field refuses a scheme publishing would drop', async ({ page }) => {
  // The same subtraction the paste paths answer (editor/link-protocols.ts). A refused setLink
  // changes nothing, so without the notice the button would look broken.
  await openEditor(page);
  await loadMarkdown(page, '電話をかける\n');
  await setRange(page, 1, 3);
  await page.keyboard.press('Control+k');
  const field = card(page).getByRole('textbox', { name: 'リンク先' });
  await field.fill('tel:+81312345678');
  await field.press('Enter');
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph("電話をかける"))');
  await expect(page.getByText('このリンク先は公開できないため設定していません')).toBeVisible();
  // The field stays open and keeps the caret: a refusal is something to correct, not to start over
  // from. (A `.focus()` in the same chain as the refused command would have moved it — a chain
  // still dispatches whatever ran before the refusal.)
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('tel:+81312345678');
});

test('the card says so where the schema will not hold a link', async ({ page }) => {
  // `detailsSummary` and `codeBlock` both declare `marks: ''`. setMark reports success and the
  // schema drops the mark, so without this check the field would close on a link that was never
  // made — the shape §2.4/§2.5 exist to prevent. (The accordion and the footnote already collided
  // once for want of asking this kind of question — see docs/accordion-requirements.md.)
  await openEditor(page);
  await loadMarkdown(page, '<details><summary>たたみ見出し</summary>\n\n中身\n\n</details>\n');
  await selectInside(page, 'detailsSummary');
  await page.keyboard.press('Control+k');
  const field = card(page).getByRole('textbox', { name: 'リンク先' });
  await field.fill('https://example.com');
  await field.press('Enter');
  await settle(page);
  expect(await docString(page)).toContain('detailsSummary("たたみ見出し")');
  expect(await docString(page)).not.toContain('link(');
  await expect(page.getByText('ここにはリンクを付けられません')).toBeVisible();
  await expect(field).toBeFocused();
});

test('the same inside a code block', async ({ page }) => {
  await openEditor(page);
  await loadMarkdown(page, '```js\nconst a = 1;\n```\n');
  await selectInside(page, 'codeBlock');
  await page.keyboard.press('Control+k');
  const field = card(page).getByRole('textbox', { name: 'リンク先' });
  await field.fill('https://example.com');
  await field.press('Enter');
  await settle(page);
  expect(await docString(page)).not.toContain('link(');
  await expect(page.getByText('ここにはリンクを付けられません')).toBeVisible();
});

test('the same over an inline code span', async ({ page }) => {
  // A different mechanism reaching the same refusal: the node here allows marks, but the `code`
  // mark excludes every other one. canSetMark covers both, which is why one message serves.
  await openEditor(page);
  await loadMarkdown(page, '`const a` のこと\n');
  await setRange(page, 1, 8);
  await page.keyboard.press('Control+k');
  const field = card(page).getByRole('textbox', { name: 'リンク先' });
  await field.fill('https://example.com');
  await field.press('Enter');
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph(code("const a"), " のこと"))');
  await expect(page.getByText('ここにはリンクを付けられません')).toBeVisible();
});

test('an emptied URL field removes the link', async ({ page }) => {
  await openEditor(page);
  await setRange(page, IN_LINK);
  await card(page).getByRole('button', { name: '編集' }).click();
  const field = card(page).getByRole('textbox', { name: 'リンク先' });
  await field.fill('');
  await field.press('Enter');
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph("前リンク後"))');
});

test('Escape closes the card and the caret stays where it was', async ({ page }) => {
  await openEditor(page);
  await setRange(page, IN_LINK);
  await expect(card(page)).toBeVisible();
  await page.locator('.ProseMirror').press('Escape');
  await expect(card(page)).toBeHidden();
  // Dismissal is scoped to this visit: leaving the link and coming back brings the card back.
  await setRange(page, OUTSIDE_LINK);
  await settle(page);
  await setRange(page, IN_LINK);
  await expect(card(page)).toBeVisible();
});

test('Escape leaves the URL field without applying it', async ({ page }) => {
  await openEditor(page);
  await setRange(page, IN_LINK);
  await card(page).getByRole('button', { name: '編集' }).click();
  const field = card(page).getByRole('textbox', { name: 'リンク先' });
  await field.fill('https://not-applied.example');
  await field.press('Escape');
  await settle(page);
  expect(await markdown(page)).toBe('前[リンク](https://example.com "タイトル")後');
});

test('a link inside a table cell hides the table toolbar', async ({ page }) => {
  // §5.5.4-2: both menus' shouldShow are satisfied at once inside a cell, and the decision is that
  // the link card wins there.
  await openEditor(page);
  await loadMarkdown(page, '| a | b |\n| --- | --- |\n| [ここ](https://example.com) | y |\n');
  await page.locator('.ProseMirror td a').click();
  await expect(card(page)).toBeVisible();
  // Two assertions for one fact, on purpose. The class is the mechanism (LinkBubble sets it from
  // the bubble menu's onShow); `toBeHidden` is what an author would see. While this file was being
  // written, the second one failed reliably here for its whole timeout — and stopped once the file
  // grew, with no change to either component. What the page looked like during those runs was never
  // captured, so which of the two was untrue then is unknown. If this goes red again, the pair says
  // which half broke instead of leaving that to be re-derived.
  await expect(page.locator('body')).toHaveClass(/link-menu-open/);
  await expect(page.locator('.table-toolbar')).toBeHidden();

  // And the table controls come back once the caret leaves the link — the other half of the
  // decision, which a one-way suppression would fail.
  await page.locator('.ProseMirror td', { hasText: 'y' }).click();
  await expect(card(page)).toBeHidden();
  await expect(page.locator('.table-toolbar')).toBeVisible();
});

test('the URL field survives an autosave', async ({ page }) => {
  // §5.3-2: a server action's form reset blanked a NodeView's <input> once before. This one is
  // portalled to <body>, outside PostEditor's single <form>, so it should never be associated with
  // it — measured rather than assumed, since "open the field and think about the URL" is exactly
  // the pause an autosave lands in.
  await openEditor(page);
  await setRange(page, IN_LINK);
  await card(page).getByRole('button', { name: '編集' }).click();
  const field = card(page).getByRole('textbox', { name: 'リンク先' });
  await field.fill('https://slowly-typed.example');
  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });
  await expect(field).toHaveValue('https://slowly-typed.example');
});
