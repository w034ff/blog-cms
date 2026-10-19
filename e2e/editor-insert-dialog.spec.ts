import { test, expect, type Locator, type Page } from '@playwright/test';
import { BASE_URL } from './constants';
import { postSlug } from './published-post';
import { expectAutosaved, loadMarkdown, setRange } from './editor-authoring';
import type { Editor } from '@tiptap/react';
import { markdown, settle } from './editor-probe';

// The shared insert dialog (docs/embed-requirements.md §24.2, docs/link-card-requirements.md §21):
// one modal for link cards and embeds. The claimed URLs are lib/embed-provider.test.ts's fixtures,
// so a shape that stops resolving fails there first, with the reason visible.
const YOUTUBE = 'https://www.youtube.com/watch?v=hDPybQwAuVo';
const CODEPEN = 'https://codepen.io/flatsato/pen/VwqprLp';
// Unclaimed, so it becomes a link card (§24.2).
const UNCLAIMED = 'https://example.com/an-article';
const CARD_MESSAGE = 'この URL はリンクカードになります。';
// The standing hint (§24.7): from the first paint until `attempted`, not a per-URL judgment.
const HINT = '一覧にない URL はリンクカードになります。';
// Claimed but not embeddable: a prototype's `/design/` URL exists and is fixable, so the provider
// gets its own sentence instead of a card (`Provider.cardFallback`, §24.1/§24.2).
const FIGMA_PROTO = 'https://www.figma.com/proto/7or4V8Tl8YbEFRmMSF3pXe/a-file';
const FIGMA_REFUSAL = '埋め込めるのは /design/ か /file/ の URL です。';
// No URL can embed a Docswell video (§17.2), so the card stays and the sentence gives the reason.
const DOCSWELL_VIDEO = 'https://www.docswell.com/s/someone/vLK7J5V-a-video';
const DOCSWELL_REFUSAL = '動画は埋め込めません。リンクカードとして挿入します。';
// Same host, no sentence: the provider answers per URL, not per host.
const DOCSWELL_USER = 'https://www.docswell.com/user/somebody';
// Speaker Deck (§16.10): the deck page never resolves; the id is only in the embed code. **The
// snippet is Speaker Deck's own output**, as lib/speakerdeck-snippet.test.ts reads it.
const SPEAKERDECK_ID = '9de2f18094b14cbb91b07331eb085e4f';
const SPEAKERDECK_PLAYER = `https://speakerdeck.com/player/${SPEAKERDECK_ID}`;
const SPEAKERDECK_PAGE = 'https://speakerdeck.com/soudai/pgcon21j-tutorial';
// The kind plus a footnote mark (§24.6), its legend, and its refusal. lib/embed-provider.test.ts
// holds the registry to these; this measures the dialog draws them.
const SPEAKERDECK_CELL = 'スライド＊';
const SPEAKERDECK_LEGEND = '＊ Speaker Deck は URL ではなく埋め込みコードを貼ってください';
const SPEAKERDECK_REFUSAL = 'Share →「Copy iframe code」の内容を貼ってください。';
const SPEAKERDECK_IFRAME = `<iframe class="speakerdeck-iframe" frameborder="0" src="${SPEAKERDECK_PLAYER}" title="実際に使うSQLの書き方 徹底解説 / pgcon21j-tutorial" allowfullscreen="true" allow="web-share" style="border: 0px; width: 100%; height: auto; aspect-ratio: 560 / 315;" data-ratio="1.7777777777777777"></iframe>`;

// For `paste`: Chromium does not give a page the clipboard by itself.
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

async function openMenu(page: Page, query: string): Promise<void> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await page.keyboard.type(`/${query}`);
  await expect(page.locator('[data-slash-menu]')).toBeVisible();
}

function dialog(page: Page) {
  return page.getByRole('dialog');
}

// **A real paste, not `fill`**: a pasted URL is finished, a typed one still in progress (§24.1),
// and `fill` is neither.
async function paste(page: Page, field: Locator, text: string): Promise<void> {
  await field.click();
  await page.evaluate((value: string) => navigator.clipboard.writeText(value), text);
  await page.keyboard.press('ControlOrMeta+V');
}

// **The argument against a permanent button**: the row is found by searching for what the author
// holds, and untested that is a hope.
test('the row is found by the provider an author is thinking of, or by リンク/カード/記事 (24a)', async ({
  page,
}) => {
  for (const query of [
    'youtube',
    'figma',
    'スライド',
    'gist',
    'twitter',
    '埋め込み',
    'リンクカード',
    '記事',
  ]) {
    await openMenu(page, query);
    const menu = page.locator('[data-slash-menu]');
    await expect(menu.getByRole('button', { name: 'リンク' }), query).toBeVisible();
  }
});

// The row asks both commands' predicates, so it never opens a dialog that would refuse both. A cell
// is paragraph-only (link-card-requirements.md §5.4).
test('the row is not offered where neither a card nor an embed can land (24b)', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, '| a | b |\n| --- | --- |\n| c | d |\n');
  await page.locator('.ProseMirror td').first().click();
  await page.keyboard.type('/');
  // Every row refuses in a cell, so no menu opens (slash-command.ts's `allow`).
  await expect(page.locator('[data-slash-menu]')).toHaveCount(0);
  expect(await markdown(page)).toContain('/');
});

test('the dialog lights the provider a URL resolves to, and offers a card for one no provider claims (24c)', async ({
  page,
}) => {
  await openMenu(page, 'embed');
  await page.locator('[data-slash-menu]').getByRole('button', { name: 'リンク' }).click();
  await expect(dialog(page)).toBeVisible();

  const submit = dialog(page).getByRole('button', { name: '挿入する' });
  const field = dialog(page).getByLabel('URL または埋め込みコード');
  const lit = dialog(page).locator('li[aria-current="true"]');
  // **The live region holds the standing hint from the first paint** (§24.7): it must be in the tree
  // before its text changes, not mounted with the first refusal.
  const status = dialog(page).locator('[role="alert"], [role="status"]');
  await expect(status).toHaveCount(1);
  await expect(status).toHaveAttribute('role', 'status');
  await expect(status).toHaveText(HINT);
  // The table's position before any message, for the no-shift check.
  const listBefore = (await dialog(page).locator('ul:visible').boundingBox())!.y;
  await expect(field).toHaveAttribute('aria-invalid', 'false');
  // `aria-describedby` is always set: one that comes and goes on a focused field is not read.
  const describedBy = await field.getAttribute('aria-describedby');
  expect(describedBy).toBeTruthy();
  expect(await status.getAttribute('id')).toBe(describedBy);
  await expect(submit).toBeDisabled();

  // **Typed, and not judged on its way**: a half-typed URL earns no judgment; the hint stays.
  await field.click();
  await page.keyboard.type('https://www.you');
  await expect(status).toHaveText(HINT);

  // **Pasted, answered at once**, with focus still in the field: the usual way a URL arrives.
  // **Unclaimed, so a card** (§24.2): an informative message, and the button enables.
  await field.fill('');
  await paste(page, field, UNCLAIMED);
  await expect(status).toHaveText(CARD_MESSAGE);
  await expect(field).toBeFocused();
  // **Information, not an error**: a card is a success, so `status`, not `alert`.
  await expect(status).toHaveAttribute('role', 'status');
  await expect(field).toHaveAttribute('aria-invalid', 'false');
  await expect(submit).toBeEnabled();
  // **Nothing moved**: the message holds its line while empty. Measured as `y`, since a wrapper's gap
  // can lose the reservation with `min-h` intact (§24.1).
  const listAfter = (await dialog(page).locator('ul:visible').boundingBox())!.y;
  expect(listAfter).toBe(listBefore);

  // **Re-pasting the same URL raises no change event**, where the pasted flag is consumed. Left set,
  // it would judge the next keystroke as finished, and keep the button enabled mid-edit.
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ControlOrMeta+V');
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('h');
  await expect(status).toHaveText(HINT);
  await expect(submit).toBeDisabled();

  await field.fill(YOUTUBE);
  // **The confirmation is the lit row and the enabled button, nothing else** (§24.1). An embed's
  // button never waits for `attempted`: a provider's exact shape cannot half-match.
  await expect(lit).toHaveCount(1);
  await expect(lit).toContainText('YouTube');
  await expect(submit).toBeEnabled();
  // `toHaveText`: `getByRole` matches substrings, so 「YouTube として挿入する」 would still match.
  await expect(submit).toHaveText('挿入する');

  // **A card button waits for `attempted`**: almost any URL qualifies, and `fill` is no paste, blur
  // or Enter.
  await field.fill(UNCLAIMED);
  await expect(submit).toBeDisabled();
  await expect(lit).toHaveCount(0);
  await expect(status).toHaveText(HINT);

  // Enter means done: for a card-eligible URL, insert.
  await field.press('Enter');
  await expect(dialog(page)).toHaveCount(0);
  expect(await markdown(page)).toContain(`<div class="link-card" data-href="${UNCLAIMED}">`);
});

// Both kinds of provider refusal, in a fresh dialog (24c's generic case now inserts and closes).
test('a provider refusal either drops the card or keeps it, by its own two-kind rule (24c.2)', async ({
  page,
}) => {
  await openMenu(page, 'embed');
  await page.locator('[data-slash-menu]').getByRole('button', { name: 'リンク' }).click();
  const submit = dialog(page).getByRole('button', { name: '挿入する' });
  const field = dialog(page).getByLabel('URL または埋め込みコード');
  const lit = dialog(page).locator('li[aria-current="true"]');
  const status = dialog(page).locator('[role="alert"], [role="status"]');

  // **Refused in the provider's words, dropping the card**: a Figma prototype has a fixable
  // `/design/` URL, which beats a card (§24.1's 「勧めない」, `Provider.cardFallback` false).
  await field.fill(FIGMA_PROTO);
  await field.press('Enter');
  await expect(status).toHaveText(FIGMA_REFUSAL);
  await expect(status).toHaveAttribute('role', 'alert');
  await expect(submit).toBeDisabled();
  // No row lights: the host matched, the URL did not resolve.
  await expect(lit).toHaveCount(0);

  // **The other kind keeps the card**, with the reason as information (§24.1's 「残す」,
  // `cardFallback` true). **Blurred, not entered**, to read the message: Enter would insert.
  await field.fill(DOCSWELL_VIDEO);
  await field.blur();
  await expect(status).toHaveText(DOCSWELL_REFUSAL);
  await expect(status).toHaveAttribute('role', 'status');
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(dialog(page)).toHaveCount(0);
  expect(await markdown(page)).toContain(`<div class="link-card" data-href="${DOCSWELL_VIDEO}">`);

  // **Narrow**: a video's sentence must not answer for a user page, which is a plain card.
  await openMenu(page, 'embed');
  await page.locator('[data-slash-menu]').getByRole('button', { name: 'リンク' }).click();
  await dialog(page).getByLabel('URL または埋め込みコード').fill(DOCSWELL_USER);
  await dialog(page).getByLabel('URL または埋め込みコード').press('Enter');
  await expect(dialog(page)).toHaveCount(0);
  expect(await markdown(page)).toContain(`<div class="link-card" data-href="${DOCSWELL_USER}">`);
});

// Refused by providers and `normalizeCardHref` alike: the one path that stays `'none'`.
const UNUSABLE = 'not a url';
const UNUSABLE_MESSAGE = 'この URL は挿入できません。';

test('a value nothing can use says so, and falls silent once the field is empty again (24c.3)', async ({
  page,
}) => {
  await openMenu(page, 'embed');
  await page.locator('[data-slash-menu]').getByRole('button', { name: 'リンク' }).click();
  const submit = dialog(page).getByRole('button', { name: '挿入する' });
  const field = dialog(page).getByLabel('URL または埋め込みコード');
  const status = dialog(page).locator('[role="alert"], [role="status"]');

  await field.fill(UNUSABLE);
  await field.blur();
  await expect(status).toHaveText(UNUSABLE_MESSAGE);
  await expect(status).toHaveAttribute('role', 'alert');
  await expect(submit).toBeDisabled();

  // An empty field is not a refusal; the standing hint answers (§24.7/§24.8). A keystroke clears
  // `attempted`, so a second blur reaches the blank answer.
  await field.fill('');
  await field.blur();
  await expect(status).toHaveText('');
});

// **Speaker Deck: the row that asks for the embed code, and the field that takes it** (§16.10,
// §24.1). The body already accepted the snippet as a paste (§16.9); this dialog had not. Measured
// together: a row asking for markup over a field refusing it would be worse.
test('the Speaker Deck row asks for the embed code, and the field takes it (24h)', async ({
  page,
}) => {
  await openMenu(page, 'embed');
  await page.locator('[data-slash-menu]').getByRole('button', { name: 'リンク' }).click();
  await expect(dialog(page)).toBeVisible();

  const field = dialog(page).getByLabel('URL または埋め込みコード');
  const submit = dialog(page).getByRole('button', { name: '挿入する' });
  const status = dialog(page).locator('[role="alert"], [role="status"]');
  const row = dialog(page).getByRole('listitem').filter({ hasText: 'Speaker Deck' });
  // The mark shows before any paste, the only moment it can. **The cell's exact text**, since
  // `toContainText` passes with the mark dropped; the legend explains it (§24.6).
  await expect(row.locator('[data-embed-kind]')).toHaveText(SPEAKERDECK_CELL);
  await expect(dialog(page).getByText(SPEAKERDECK_LEGEND, { exact: true })).toBeVisible();
  // The other eight have a bare kind and no legend line; a mark on every row would fail here.
  await expect(
    dialog(page).getByRole('listitem').filter({ hasText: 'YouTube' }).locator('[data-embed-kind]'),
  ).toHaveText('動画');

  // The deck page refuses and drops the card: storage is unchanged (§16.9), and the fix, the embed
  // code, beats a fallback (「勧めない」, `cardFallback` false). Said at the wrong paste.
  await paste(page, field, SPEAKERDECK_PAGE);
  await expect(submit).toBeDisabled();
  await expect(status).toHaveText(SPEAKERDECK_REFUSAL);
  await expect(status).toHaveAttribute('role', 'alert');

  // The code resolves and lights the row: `hostOf` of markup is '', so asking the field instead of
  // the resolved reference would enable the button beside unlit rows.
  await field.fill('');
  await paste(page, field, SPEAKERDECK_IFRAME);
  await expect(submit).toBeEnabled();
  await expect(dialog(page).locator('li[aria-current="true"]')).toContainText('Speaker Deck');
  // A resolved embed shows only the lit row and the button; the hint does not return.
  await expect(status).toHaveText('');

  // **The player URL is stored, not the markup**, rebuilt from the id (§16.9).
  await submit.click();
  await expect(dialog(page)).toHaveCount(0);
  const body = await markdown(page);
  expect(body).toContain(SPEAKERDECK_PLAYER);
  expect(body).not.toContain('<iframe');
});

// The table is the only list of what can be embedded, generated from the registry
// (lib/embed-provider.test.ts); this checks the dialog draws all of it.
test('the dialog lists every provider that can be embedded (24d)', async ({ page }) => {
  await openMenu(page, 'embed');
  await page.locator('[data-slash-menu]').getByRole('button', { name: 'リンク' }).click();
  await expect(dialog(page)).toBeVisible();
  for (const name of [
    'YouTube',
    'X',
    'SlideShare',
    'Figma',
    'Speaker Deck',
    'Docswell',
    'GitHub Gist',
    'CodeSandbox',
    'CodePen',
  ]) {
    await expect(dialog(page).getByText(name, { exact: true }), name).toBeVisible();
  }
});

// **Into the middle of a document**: ProseMirror's selection must survive focus leaving for the
// dialog, and in an empty document the only place would pass either way.
test('the dialog inserts at the line the menu was opened on (24e)', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, '前の段落\n\nここに入る\n\n後の段落\n');

  // Caret at the end of 「ここに入る」, then a new line. **Set, not clicked**: right after
  // `loadMarkdown` a click landed in the third paragraph about one run in three.
  const end = await page.evaluate((text: string) => {
    const el = document.querySelector('.ProseMirror') as (Element & { editor?: Editor }) | null;
    const editor = el?.editor;
    if (!editor) throw new Error('no live editor on .ProseMirror');
    let found: number | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (found !== null) return false;
      if (node.isTextblock && node.textContent === text) found = pos + node.nodeSize - 1;
      return true;
    });
    if (found === null) throw new Error(`no paragraph reading ${text}`);
    return found;
  }, 'ここに入る');
  await setRange(page, end);
  await page.keyboard.press('Enter');
  await page.keyboard.type('/embed');
  await page.locator('[data-slash-menu]').getByRole('button', { name: 'リンク' }).click();

  await dialog(page).getByLabel('URL または埋め込みコード').fill(CODEPEN);
  await dialog(page).getByRole('button', { name: '挿入する' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await settle(page);

  const body = await markdown(page);
  expect(body).toContain(CODEPEN);
  // Between the two paragraphs, above the last.
  expect(body.indexOf('ここに入る')).toBeLessThan(body.indexOf(CODEPEN));
  expect(body.indexOf(CODEPEN)).toBeLessThan(body.indexOf('後の段落'));
  await expect(page.locator('.ProseMirror .embed-view')).toHaveCount(1);
});

test('Escape and the backdrop close the dialog without inserting (24f)', async ({ page }) => {
  await openMenu(page, 'embed');
  await page.locator('[data-slash-menu]').getByRole('button', { name: 'リンク' }).click();
  await dialog(page).getByLabel('URL または埋め込みコード').fill(YOUTUBE);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  expect(await markdown(page)).not.toContain(YOUTUBE);

  // The field forgets an abandoned URL: the dialog is the whole half-made state.
  await page.keyboard.type('/embed');
  await page.locator('[data-slash-menu]').getByRole('button', { name: 'リンク' }).click();
  await expect(dialog(page).getByLabel('URL または埋め込みコード')).toHaveValue('');
  await dialog(page).press('Escape');
  await expect(dialog(page)).toHaveCount(0);
});

// §24.1's shape rule: a bottom sheet with nine rows filled most of a phone screen and could not fit
// a keyboard. Both viewports in one test: "fills the screen" alone passes with a full-height desktop
// slab.
test.describe('the dialog is a full screen on a phone and a card on a desktop (24g)', () => {
  const openDialog = async (page: Page) => {
    await page.goto('/admin/posts/new');
    await expect(page.locator('.ProseMirror')).toBeVisible();
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('/embed');
    await page.locator('[data-slash-menu]').getByRole('button', { name: 'リンク' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    return page.getByRole('dialog').evaluate((el) => {
      const box = el.getBoundingClientRect();
      const host = el.parentElement?.getBoundingClientRect();
      return {
        height: Math.round(box.height),
        // The backdrop, not `innerHeight`, which counts a headless scrollbar.
        available: Math.round(host?.height ?? 0),
        width: Math.round(box.width),
        outerWidth: Math.round(host?.width ?? 0),
      };
    });
  };

  test.describe('narrow', () => {
    test.use({ viewport: { width: 390, height: 700 } });
    test('fills it', async ({ page }) => {
      const box = await openDialog(page);
      expect(box.height).toBe(box.available);
      expect(box.width).toBe(box.outerWidth);
    });
  });

  test.describe('wide', () => {
    test.use({ viewport: { width: 1280, height: 800 } });
    test('does not', async ({ page }) => {
      const box = await openDialog(page);
      expect(box.height).toBeLessThan(box.available);
      expect(box.width).toBeLessThan(box.outerWidth);
    });
  });
});

// The post tabs (docs/link-card-requirements.md §21): the card picker's search, for a fresh insert
// (§24.2). Which posts each tab returns is app/api/posts/search/route.test.ts's claim (§24.9); here
// only that each tab asks for its own scope.
test('the post tabs search this blog’s posts and insert a card (24.7a, 24.9)', async ({ page }) => {
  await openMenu(page, 'リンク');
  await page.locator('[data-slash-menu]').getByRole('button', { name: 'リンク' }).click();
  await expect(dialog(page)).toBeVisible();

  const searchRequest = () =>
    page.waitForRequest((request) => request.url().includes('/api/posts/search?q='));
  const own = searchRequest();
  await dialog(page).getByRole('tab', { name: '自分の記事' }).click();
  expect(new URL((await own).url()).searchParams.get('scope')).toBe('mine');
  const all = searchRequest();
  await dialog(page).getByRole('tab', { name: '全記事' }).click();
  expect(new URL((await all).url()).searchParams.get('scope')).toBeNull();

  await dialog(page).getByPlaceholder('記事のタイトルで検索…').fill('React');
  const row = dialog(page).getByRole('button', { name: 'React Server Components を学ぶよ' });
  // The seeded post has no image, so its row is drawn as its category's mark (CM-6,
  // docs/category-mark-requirements.md §4) with a size: a React `<svg>` takes it from
  // `.category-art svg`.
  const mark = row.locator('.category-art');
  await expect(mark).toHaveAttribute('data-category', 'tech');
  await expect(row.locator('img')).toHaveCount(0);
  const markBox = (await mark.boundingBox())!;
  expect(markBox.width).toBeCloseTo(44, 0);
  expect(markBox.height).toBeCloseTo(44, 0);
  expect((await mark.locator('svg').boundingBox())!.height).toBeGreaterThan(0);
  await row.click();

  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('.ProseMirror .link-card-view .link-card-title')).toHaveText(
    'React Server Components を学ぶよ',
  );
  expect(await markdown(page)).toContain('<div class="link-card" data-href="/posts/second-post">');
});

// §18's guard from this field: the same `resolveInsertTarget` (lib/insert-target.ts), a second call
// site, not a second rule (§21).
test('the URL field refuses this post’s own address (24.7b)', async ({ page }) => {
  const title = `insert-dialog 自参照テスト ${Date.now()}`;
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill(title);
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('本文');
  await expectAutosaved(page);
  await page.waitForURL(/\/admin\/posts\/\d+\/edit/);
  const slug = await postSlug(page);

  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/リンク');
  await page.locator('[data-slash-menu]').getByRole('button', { name: 'リンク' }).click();

  const field = dialog(page).getByLabel('URL または埋め込みコード');
  const submit = dialog(page).getByRole('button', { name: '挿入する' });
  const status = dialog(page).locator('[role="alert"], [role="status"]');
  await paste(page, field, `${BASE_URL}/posts/${slug}`);
  await expect(status).toHaveText('この記事自身は参照できません');
  await expect(status).toHaveAttribute('role', 'alert');
  await expect(submit).toBeDisabled();

  // Another post's address is still a card: the refusal is about this post.
  await field.fill('');
  await paste(page, field, `${BASE_URL}/posts/second-post`);
  await expect(status).toHaveText(CARD_MESSAGE);
  await expect(status).toHaveAttribute('role', 'status');
  await expect(submit).toBeEnabled();
});
