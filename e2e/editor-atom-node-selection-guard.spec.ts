import { test, expect, type Page } from '@playwright/test';
import { loadMarkdown, selectNode } from './editor-authoring';

// A node-selected atom (linkCard, embed, image) is a range with no inside: setCallout, insertTable,
// toggleBlockquote and setImage replaced or wrapped it. All four guard on the type name
// (callout-extension.ts, table-extensions.ts, blockquote-extension.ts, useImageUpload.ts).

const CARD_HREF = '/posts/second-post';
const CARD_MD = `<div class="link-card" data-href="${CARD_HREF}"></div>`;
const EMBED_MD =
  '<div class="embed" data-href="https://www.youtube.com/watch?v=hDPybQwAuVo"></div>';
// A real upload: the pasted 1x1 would be indistinguishable from a 1x1 original.
const IMAGE_MD =
  '![](/uploads/125b9697a8fd9e40c31b371d57e50da3c75a4b2dc91facd63adbbcef723c41ef.png)';

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

// The row's name in IMAGE_BLOCKED_HOSTS, quoted exactly so another refusal cannot pass.
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
  // A body image is the same shape; its losses were visible rather than silent.
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

    // A disabled button refuses the click; enabled, the command would run and fail below.
    await calloutButton.click({ force: true });
    await tableButton.click({ force: true });
    await quoteButton.click({ force: true });

    // Paste has no control to grey, so it is exercised. **The refusal is asserted first**: it is
    // synchronous, while a paste that gets through waits on the upload, so an immediate document check
    // passes either way. srcs, not a count: a failed guard swaps the picture and keeps one.
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
