import { test, expect, type Page } from '@playwright/test';
import { loadMarkdown, selectNode } from './editor-authoring';

// linkCard and embed are atoms (link-card-extension.ts, embed-extension.ts): selecting one gives a
// NodeSelection whose range is exactly that node, with no content inside it. setCallout,
// insertTable, toggleBlockquote and setImage each ran their normal insert/wrap path over that
// range instead of refusing, which either replaced the card/embed outright (callout, table,
// image) or wrapped it in a blockquote it was never meant to sit inside (reported 2026-09-05). All
// four now guard on the node's type name the same way they already guard 'table' etc.
// (callout-extension.ts, table-extensions.ts, blockquote-extension.ts, useImageUpload.ts).

const CARD_HREF = '/posts/second-post';
const CARD_MD = `<div class="link-card" data-href="${CARD_HREF}"></div>`;
const EMBED_MD =
  '<div class="embed" data-href="https://www.youtube.com/watch?v=hDPybQwAuVo"></div>';
// A real upload rather than one of the 1x1 fixtures: the paste below inserts a 1x1, so a picture
// that is also 1x1 would leave the two indistinguishable if the guard ever let the swap through.
const IMAGE_MD =
  '![](/uploads/3cf43f6c9f92a311cb0de38736934c4efc6aa3d1d0968206d837e593fbe99107.png)';

const PNG_1x1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function pasteImage(page: Page): Promise<void> {
  await page.evaluate((base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
    document
      .querySelector('.ProseMirror')
      ?.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
  }, PNG_1x1_BASE64);
}

// `blockedLabel` is the row's own name in IMAGE_BLOCKED_HOSTS — the refusal notice quotes it, and
// asserting the exact string is what keeps this test from passing on some *other* refusal.
for (const { label, typeName, markdown, viewClass, blockedLabel } of [
  {
    label: 'a link card',
    typeName: 'linkCard',
    markdown: CARD_MD,
    viewClass: 'link-card-view',
    blockedLabel: 'リンクカード',
  },
  {
    label: 'an embed',
    typeName: 'embed',
    markdown: EMBED_MD,
    viewClass: 'embed-view',
    blockedLabel: '埋め込み',
  },
  // A body image is the same shape — a selectable block atom — and was left out of all four guards
  // until 2026-09-08. It differs from the two above in that its losses were visible rather than
  // silent, which is why it was not part of the original report; the refusal is uniform anyway.
  {
    label: 'an image',
    typeName: 'image',
    markdown: IMAGE_MD,
    viewClass: 'image-box',
    blockedLabel: '画像ブロック',
  },
]) {
  test(`selecting ${label} disables 囲み枠/表/引用/画像 and none of them touch it`, async ({
    page,
  }) => {
    await page.goto('/admin/posts/new');
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();

    await editor.click();
    await loadMarkdown(page, `${markdown}\n\n本文\n`);

    const view = page.locator(`.ProseMirror .${viewClass}`);
    await expect(view).toBeVisible();
    await selectNode(page, typeName);

    const calloutButton = page.getByRole('button', { name: '囲み枠' });
    const tableButton = page.getByRole('button', { name: '表' });
    const quoteButton = page.getByRole('button', { name: '引用' });
    const imagePicker = page.getByTestId('image-picker');

    await expect(calloutButton).toBeDisabled();
    await expect(tableButton).toBeDisabled();
    await expect(quoteButton).toBeDisabled();
    await expect(imagePicker).toBeDisabled();

    // Disabled buttons refuse the click at the browser level, so this also proves the guard: were
    // it not disabled, the click would run the command and the assertions below would catch the
    // node vanishing or getting wrapped.
    await calloutButton.click({ force: true });
    await tableButton.click({ force: true });
    await quoteButton.click({ force: true });

    // Paste has no toolbar affordance to grey out, so it has to be exercised directly rather than
    // inferred from a disabled control (useImageUpload.ts's own reasoning for the table/code-block
    // cases this mirrors).
    //
    // **The refusal is asserted first, and that is what makes the rest of this a real reading.**
    // A blocked paste is declined synchronously and never reaches /api/uploads; one that gets
    // through has to round-trip the upload before it changes anything. So a document assertion
    // taken straight after the gesture is green either way. Measured 2026-09-08 by deleting
    // `image` from IMAGE_BLOCKED_HOSTS: every assertion below still passed, including the src
    // comparison written to catch exactly that. The notice is the synchronous half.
    //
    // The srcs and not a count, for the image row: a guard that failed there swaps the selected
    // picture for the pasted 1x1 and leaves the count at 1.
    const srcs = () =>
      page
        .locator('.ProseMirror img')
        .evaluateAll((els) => els.map((el) => (el as HTMLImageElement).getAttribute('src')));
    const srcsBefore = await srcs();
    await selectNode(page, typeName);
    await pasteImage(page);
    await expect(page.getByRole('status')).toHaveText(`${blockedLabel}には画像を挿入できません`);

    await expect(view).toBeVisible();
    await expect(page.locator('.ProseMirror div.markdown-alert')).toHaveCount(0);
    await expect(page.locator('.ProseMirror table')).toHaveCount(0);
    await expect(page.locator(`.ProseMirror blockquote .${viewClass}`)).toHaveCount(0);
    expect(await srcs()).toEqual(srcsBefore);
  });
}
