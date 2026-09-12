import { test, expect, type Page } from '@playwright/test';
import { closeHistory, loadMarkdown } from './editor-authoring';
import { markdown, shot } from './editor-probe';
import { BLOB_NOTICES } from '../components/editor/github-blob-import';
import { gotoPublished } from './published-post';

// The GitHub blob import in the live editor (docs/embed-requirements.md §19). Browser-only twice
// over: the button's press is asynchronous, which no other control on the link card is, and what it
// produces is a code block whose fence is only observable through the editor's own serializer.
//
// **GitHub is stubbed here, and can be.** The gist embed could not be (§18.10's G7 — a sandboxed
// opaque-origin frame's requests do not reach Playwright's routing), but this fetch is made by the
// page itself, so `page.route` sees it. What is being measured is this repository's half: the URL
// it builds, the block it writes, and what it does when the answer is a failure.
const BLOB = 'https://github.com/facebook/react/blob/main/packages/react/index.ts';
const RAW = 'https://raw.githubusercontent.com/facebook/react/main/packages/react/index.ts';
const FILE = ["import { a } from 'a';", '', 'export const b = 1;', 'export const c = 2;', ''].join(
  '\n',
);

// The stub, and the record of what was asked for — the URL this side builds is half of what §19.3
// is about, so the spec keeps it rather than trusting the response to imply it.
async function stubRaw(
  page: Page,
  reply: { status: number; body?: string; contentType?: string } = { status: 200, body: FILE },
): Promise<string[]> {
  const asked: string[] = [];
  await page.route('https://raw.githubusercontent.com/**', async (route) => {
    asked.push(route.request().url());
    await route.fulfill({
      status: reply.status,
      contentType: reply.contentType ?? 'text/plain; charset=utf-8',
      body: reply.body ?? '404: Not Found',
      headers: { 'access-control-allow-origin': '*' },
    });
  });
  return asked;
}

async function openWith(page: Page, source: string): Promise<void> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, source);
}

const IMPORT = 'コードブロックにする';

test('the bubble offers the code block, not a card, for a blob URL (§19.2)', async ({ page }) => {
  const asked = await stubRaw(page);
  await openWith(page, `<${BLOB}>\n\n本文\n`);

  await page.locator('.ProseMirror a').first().click();
  await expect(page.getByRole('button', { name: 'コピー' })).toBeVisible();
  // One URL, one meaning (§3.3), extended to the third outcome: the card would show a social image
  // and none of the file, so it is not offered beside this.
  await expect(page.getByRole('button', { name: 'カードにする' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '埋め込みにする' })).toHaveCount(0);
  await shot(page, '01-bubble-blob-button');

  await page.getByRole('button', { name: IMPORT }).click();
  await expect(page.locator('.ProseMirror pre')).toHaveCount(1);

  // The address is built from the URL's own segments, and it is the raw host that is asked (§19.3).
  expect(asked).toEqual([RAW]);
  // The fence carries the language the extension named and, in the filename slot, the blob URL
  // itself (§19.4). The whole document, because two things have to be absent: the link's own
  // paragraph, replaced rather than left above the block, and any line under it.
  expect(await markdown(page)).toBe(
    [`\`\`\`ts:${BLOB}`, FILE.trimEnd(), '```', '', '本文'].join('\n'),
  );
  // The header is a link to the file, not the URL as text and not a line under the block (§19.4).
  const source = page.locator('.ProseMirror .code-block-source');
  await expect(source).toHaveAttribute('href', BLOB);
  await expect(source.locator('.code-block-source-repo')).toHaveText('facebook/react');
  await expect(source.locator('.code-block-source-path')).toHaveText('packages/react/index.ts');
  // The field it stands in for is not also on screen.
  await expect(page.locator('.ProseMirror .code-block-filename')).toBeHidden();
  await shot(page, '02-editor-code-block');

  // **Reopening the post is where a fence's filename goes wrong**, and this filename is new in
  // kind: it carries slashes and dots into the info string, which markdown-it folds whole into
  // `language-ts:packages/react/index.ts` and `updateCodeBlockDOM` splits at the *first* colon
  // (code-block-extension.ts records two bugs that looked correct until the reload). So the round
  // trip is measured rather than reasoned about — the header keeps the whole path and the language
  // stays picked.
  const produced = await markdown(page);
  await loadMarkdown(page, produced);
  expect(await markdown(page)).toBe(produced);
  await expect(page.locator('.ProseMirror .code-block-source')).toHaveAttribute('href', BLOB);
  await expect(page.locator('.ProseMirror .code-block-lang')).toHaveValue('ts');
});

test('a line fragment imports only those lines (§19.3)', async ({ page }) => {
  await stubRaw(page);
  await openWith(page, `<${BLOB}#L3-L4>\n\n本文\n`);
  await page.locator('.ProseMirror a').first().click();
  await page.getByRole('button', { name: IMPORT }).click();
  await expect(page.locator('.ProseMirror pre')).toHaveCount(1);

  expect(await markdown(page)).toBe(
    [
      `\`\`\`ts:${BLOB}#L3-L4`,
      'export const b = 1;',
      'export const c = 2;',
      '```',
      '',
      '本文',
    ].join('\n'),
  );
});

test('one press, one undo (§19.4)', async ({ page }) => {
  await stubRaw(page);
  await openWith(page, `<${BLOB}>\n\n本文\n`);
  // `setContent` is one history event, and an import made inside the grouping delay after it joined
  // that event — one Ctrl-Z emptied the editor (measured 2026-08-29, before the `uiEvent` meta).
  // Closed here as well so what this test measures is the insertion's own group, not the delay.
  await closeHistory(page);
  await page.locator('.ProseMirror a').first().click();
  await page.getByRole('button', { name: IMPORT }).click();
  await expect(page.locator('.ProseMirror pre')).toHaveCount(1);

  // One insertion, so one Ctrl-Z takes it — and it must not join whatever the author did before
  // pressing the button (`uiEvent`, github-blob-import.ts).
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.ProseMirror pre')).toHaveCount(0);
  expect(await markdown(page)).toBe(`<${BLOB}>\n\n本文`);
});

test('a file GitHub will not serve leaves the link alone and says so (§19.5)', async ({ page }) => {
  await stubRaw(page, { status: 404 });
  await openWith(page, `<${BLOB}>\n\n本文\n`);
  const toast = page.getByRole('status');
  await expect(toast).toHaveCount(0);

  await page.locator('.ProseMirror a').first().click();
  await page.getByRole('button', { name: IMPORT }).click();

  await expect(toast).toBeVisible();
  await expect(toast).toHaveText(BLOB_NOTICES.fetch);
  // The link is still a link: a failed import costs the author nothing they had.
  await expect(page.locator('.ProseMirror pre')).toHaveCount(0);
  expect(await markdown(page)).toBe(`<${BLOB}>\n\n本文`);
  await shot(page, '03-fetch-failed');
});

test('a file the import could never take is offered the card instead (§19.2)', async ({ page }) => {
  // A `.png` had the import button before this, where pressing it could only ever fail. The URL is
  // not claimed at all now, so it falls through to the card — the outcome Qiita and Zenn give a
  // non-text file, decided here from the URL rather than from a fetch.
  await stubRaw(page);
  await openWith(page, `<https://github.com/facebook/react/blob/main/logo.png>\n\n本文\n`);
  await page.locator('.ProseMirror a').first().click();
  await expect(page.getByRole('button', { name: 'コピー' })).toBeVisible();
  await expect(page.getByRole('button', { name: IMPORT })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'カードにする' })).toBeVisible();
});

test('a binary the extension did not name is refused by the response (§19.5)', async ({ page }) => {
  // The second net, and the one that cannot be fooled: `.dat` is in no list, so the button is
  // offered — and what refuses it is the content-type GitHub answers with.
  await stubRaw(page, { status: 200, body: 'PNG ', contentType: 'image/png' });
  await openWith(page, `<https://github.com/facebook/react/blob/main/blob.dat>\n\n本文\n`);
  await page.locator('.ProseMirror a').first().click();
  await page.getByRole('button', { name: IMPORT }).click();

  await expect(page.getByRole('status')).toHaveText(BLOB_NOTICES.binary);
  await expect(page.locator('.ProseMirror pre')).toHaveCount(0);
  // The link is untouched, as it is for every other failure.
  expect(await markdown(page)).toBe(
    '<https://github.com/facebook/react/blob/main/blob.dat>\n\n本文',
  );
});

test('a GitHub URL that is not one file keeps the card (§19.2)', async ({ page }) => {
  await stubRaw(page);
  // A repository page: no file to read, so the button is absent and the card is what is offered.
  // The absence above means what it says only because this one is present.
  await openWith(page, `<https://github.com/facebook/react>\n\n本文\n`);
  await page.locator('.ProseMirror a').first().click();
  await expect(page.getByRole('button', { name: 'コピー' })).toBeVisible();
  await expect(page.getByRole('button', { name: IMPORT })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'カードにする' })).toBeVisible();
});

test('the import lands where the link ended up, not where it started (§19.4)', async ({ page }) => {
  // The one thing this feature has that no other entry point does: the document can change while
  // the fetch is out. The answer is held until the author has typed a line above the link, so the
  // stored range is stale by exactly that much — and the block must still replace the link.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('https://raw.githubusercontent.com/**', async (route) => {
    await held;
    await route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: FILE,
      headers: { 'access-control-allow-origin': '*' },
    });
  });

  // The link is the *last* paragraph, so the edit below moves it without touching it. Typing inside
  // the link's own line is a different case and aborts on purpose (§19.4): the line stops being the
  // link, which is what makes it replaceable by a block.
  //
  // Three lines above it because the card is portalled over the text around the link — one line up
  // is under the card, and clicking there hits the card instead (measured 2026-08-29).
  await openWith(page, `一行目\n\n二行目\n\n三行目\n\n<${BLOB}>\n`);
  await page.locator('.ProseMirror a').first().click();
  await page.getByRole('button', { name: IMPORT }).click();

  // Grow the paragraphs above the link while the request is held: every position the import
  // remembered is now stale by exactly this much.
  await page.locator('.ProseMirror p').first().click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('足した文字');
  await page.keyboard.press('Enter');

  release();
  await expect(page.locator('.ProseMirror pre')).toHaveCount(1);
  expect(await markdown(page)).toBe(
    [
      '足した文字',
      '',
      '一行目',
      '',
      '二行目',
      '',
      '三行目',
      '',
      `\`\`\`ts:${BLOB}`,
      FILE.trimEnd(),
      '```',
    ].join('\n'),
  );
  await shot(page, '04-mapped-through-edits');
});

test('the published block wears the same header (§19.4)', async ({ page }) => {
  // The two surfaces draw the header from the same stored string by different code — the NodeView
  // builds DOM, `lib/rehype-code-source.ts` builds hast — so "the editor shows what publishes"
  // is a claim about two implementations agreeing, and only this measures the second one in place.
  await stubRaw(page);
  await page.goto('/admin/posts/new');
  await page.getByLabel('タイトル').fill('GitHub blob spec');
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, `<${BLOB}>\n`);
  await page.locator('.ProseMirror a').first().click();
  await page.getByRole('button', { name: IMPORT }).click();
  await expect(page.locator('.ProseMirror pre')).toHaveCount(1);

  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '投稿' }).click();
  await expect(page.getByText('公開済み（最新）')).toBeVisible({ timeout: 20_000 });
  await gotoPublished(page);

  const source = page.locator('.code-source-link');
  await expect(source).toHaveAttribute('href', BLOB);
  // External, so it opens in a new tab under the same rule as any other link in the body (§6).
  await expect(source).toHaveAttribute('target', '_blank');
  await expect(page.locator('.code-source-repo')).toHaveText('facebook/react');
  await expect(page.locator('.code-source-path')).toHaveText('packages/react/index.ts');
  // The header sits on the figure it heads, not as a separate line: one row, above the code.
  const caption = await page.locator('.code-source').boundingBox();
  const pre = await page.locator('[data-rehype-pretty-code-figure] pre').boundingBox();
  expect(caption!.y + caption!.height).toBeLessThanOrEqual(pre!.y + 1);
  await shot(page, '05-published-header');
});

test('an imported block can be turned back into a link (§19.4)', async ({ page }) => {
  await stubRaw(page);
  await openWith(page, `<${BLOB}>\n\n本文\n`);
  await page.locator('.ProseMirror a').first().click();
  await page.getByRole('button', { name: IMPORT }).click();
  await expect(page.locator('.ProseMirror pre')).toHaveCount(1);
  await shot(page, '06-to-link-button');

  await page.getByRole('button', { name: 'リンクに戻す' }).click();
  await expect(page.locator('.ProseMirror pre')).toHaveCount(0);
  // Back to exactly the reference the import started from, line fragment and all — the block is
  // gone rather than emptied, and nothing of it is left above or below.
  expect(await markdown(page)).toBe(`<${BLOB}>\n\n本文`);
  // And the bubble offers the import again, which is what makes this a door rather than an exit.
  await page.locator('.ProseMirror a').first().click();
  await expect(page.getByRole('button', { name: IMPORT })).toBeVisible();
});

test('an ordinary code block is not offered the way back (§19.4)', async ({ page }) => {
  // The button is answerable only for a block that carries a reference. A hand-written block has
  // none, and the absence above means what it says only because this one is absent too.
  await openWith(page, '```ts:index.ts\nconst a = 1;\n```\n');
  await expect(page.locator('.ProseMirror pre')).toHaveCount(1);
  await expect(page.locator('.ProseMirror .code-block-filename')).toBeVisible();
  await expect(page.getByRole('button', { name: 'リンクに戻す' })).toHaveCount(0);
});

test('the way back keeps its name when the header goes to icons (§19.4)', async ({ page }) => {
  // Below 30rem the label is hidden the visually-hidden way rather than removed, so the button is
  // still findable by its accessible name — the same rule and the same reason as the link card's
  // control band. What the header's width goes back to is the file it names.
  await page.setViewportSize({ width: 420, height: 800 });
  await stubRaw(page);
  await openWith(page, `<${BLOB}>\n`);
  await page.locator('.ProseMirror a').first().click();
  await page.getByRole('button', { name: IMPORT }).click();
  await expect(page.locator('.ProseMirror pre')).toHaveCount(1);

  const label = page.locator('.code-block-to-link-label');
  await expect(label).toHaveText('リンクに戻す');
  // Hidden by size, not by `display: none` — a removed label would take the name with it.
  expect(await label.boundingBox()).toMatchObject({ width: 1, height: 1 });
  await expect(page.locator('.code-block-to-link svg')).toBeVisible();
  await shot(page, '07-narrow-header');

  // Still the button, still does the same thing.
  await page.getByRole('button', { name: 'リンクに戻す' }).click();
  await expect(page.locator('.ProseMirror pre')).toHaveCount(0);
  expect(await markdown(page)).toBe(`<${BLOB}>`);
});
