import { test, expect, type Page } from '@playwright/test';
import { docString } from './editor-probe';
import { loadMarkdown, setRange } from './editor-authoring';

// The editor and the public renderer used to disagree about which URI schemes may be a link, and
// the editor was the wider of the two: `ftp`, `ftps`, `tel`, `callto`, `sms` and `cid` were
// accepted here, saved to markdown, and then had their href removed outright by
// hast-util-sanitize on publish — an <a> pointing nowhere, with nothing said about it.
// components/editor/link-protocols.ts closes that gap at this end. See
// docs/link-requirements.md §2.4.
//
// Pasting HTML is the route that reaches the check: `parseHTML`'s getAttrs asks `isAllowedUri`
// before applying the mark, so a refused scheme arrives as the anchor's text and nothing else.

async function openEditor(page: Page): Promise<void> {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, 'ここ\n');
  await setRange(page, 4); // end of 「ここ」
}

async function pasteAnchor(page: Page, html: string, text: string): Promise<void> {
  await page.evaluate(
    ({ html, text }) => {
      const transfer = new DataTransfer();
      transfer.setData('text/html', html);
      transfer.setData('text/plain', text);
      document
        .querySelector('.ProseMirror')
        ?.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
        );
    },
    { html, text },
  );
}

for (const [scheme, href] of [
  ['tel', 'tel:+81312345678'],
  ['ftp', 'ftp://example.com/x'],
  ['sms', 'sms:+81312345678'],
  ['cid', 'cid:part1@example.com'],
] as const) {
  test(`a ${scheme}: link is refused instead of dying on publish`, async ({ page }) => {
    await openEditor(page);
    await pasteAnchor(page, `<a href="${href}">文字</a>`, '文字');
    expect(await docString(page)).toBe('doc(paragraph("ここ文字"))');
  });
}

test('leading whitespace does not smuggle a refused scheme through', async ({ page }) => {
  await openEditor(page);
  // The link extension strips this class of character before validating, so a predicate that
  // tests the raw string would let this pass and then the default check would accept it.
  await pasteAnchor(page, '<a href="  tel:+81312345678">文字</a>', '文字');
  expect(await docString(page)).toBe('doc(paragraph("ここ文字"))');
});

// The route that does not reach `isAllowedUri` at all: the link extension's linkOnPaste plugin
// applies the mark with a raw setMark. linkifyjs recognises `ftp://…` as a link (it does not
// recognise `tel:`/`sms:`, and reads `cid:a@example.com` as the email `a@example.com`, so ftp/ftps
// are the schemes that actually reach it), so without PostEditor's own handlePaste this would be
// an ftp link that still dies on publish.
for (const href of ['ftp://example.com/x', 'ftps://example.com/x'] as const) {
  test(`${href} pasted as plain text over a selection does not become a link`, async ({ page }) => {
    await openEditor(page);
    await setRange(page, 1, 3); // 「ここ」selected
    await page.evaluate((text) => {
      const transfer = new DataTransfer();
      transfer.setData('text/plain', text);
      document
        .querySelector('.ProseMirror')
        ?.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
        );
    }, href);
    expect(await docString(page)).toBe(`doc(paragraph("${href}"))`);
  });
}

test('a publishable URL pasted as plain text over a selection still links', async ({ page }) => {
  await openEditor(page);
  await setRange(page, 1, 3);
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', 'https://example.com');
    document
      .querySelector('.ProseMirror')
      ?.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
  });
  // Route (a) — the only way to put a link on chosen text — must be untouched by the guard above.
  expect(await docString(page)).toBe('doc(paragraph(link("ここ")))');
});

test('an https link is unaffected', async ({ page }) => {
  await openEditor(page);
  await pasteAnchor(page, '<a href="https://example.com">文字</a>', '文字');
  expect(await docString(page)).toBe('doc(paragraph("ここ", link("文字")))');
});

test('a mailto link is unaffected', async ({ page }) => {
  await openEditor(page);
  // In both allowlists, so narrowing to the publishable set must not touch it.
  await pasteAnchor(page, '<a href="mailto:a@example.com">文字</a>', '文字');
  expect(await docString(page)).toBe('doc(paragraph("ここ", link("文字")))');
});

test('an in-site relative link is unaffected', async ({ page }) => {
  await openEditor(page);
  // No scheme at all, which is how an author links to this site's own posts. The default check
  // is kept in front precisely so these go on being accepted.
  await pasteAnchor(page, '<a href="/posts/foo">文字</a>', '文字');
  expect(await docString(page)).toBe('doc(paragraph("ここ", link("文字")))');
});

test('a fragment link is unaffected', async ({ page }) => {
  await openEditor(page);
  await pasteAnchor(page, '<a href="#midashi">文字</a>', '文字');
  expect(await docString(page)).toBe('doc(paragraph("ここ", link("文字")))');
});
