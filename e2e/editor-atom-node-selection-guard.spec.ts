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

for (const { label, typeName, markdown, viewClass } of [
  { label: 'a link card', typeName: 'linkCard', markdown: CARD_MD, viewClass: 'link-card-view' },
  { label: 'an embed', typeName: 'embed', markdown: EMBED_MD, viewClass: 'embed-view' },
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
    // Baseline rather than an absolute 0: the link card's own resolved view carries a favicon
    // `<img>` of its own (fetched async off /api/posts/search, so it wasn't there right after
    // loadMarkdown — the disabled-button assertions above gave it time to resolve), so what a
    // refused paste must leave unchanged is the *count*, not "none".
    const imgCountBefore = await page.locator('.ProseMirror img').count();
    await selectNode(page, typeName);
    await pasteImage(page);

    await expect(view).toBeVisible();
    await expect(page.locator('.ProseMirror div.markdown-alert')).toHaveCount(0);
    await expect(page.locator('.ProseMirror table')).toHaveCount(0);
    await expect(page.locator(`.ProseMirror blockquote .${viewClass}`)).toHaveCount(0);
    await expect(page.locator('.ProseMirror img')).toHaveCount(imgCountBefore);
  });
}
