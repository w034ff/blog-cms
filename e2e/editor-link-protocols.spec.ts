import { test, expect, type Page } from '@playwright/test';
import { docString } from './editor-probe';
import { loadMarkdown, setRange } from './editor-authoring';

// The editor accepted schemes (`ftp`, `ftps`, `tel`, `callto`, `sms`, `cid`) that hast-util-sanitize
// strips on publish, leaving an <a> to nowhere. link-protocols.ts narrows the editor
// (docs/link-requirements.md §2.4). Pasted HTML reaches the check: `parseHTML`'s getAttrs asks
// `isAllowedUri`, so a refused scheme arrives as text.

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
  // The extension strips these characters before validating; a raw-string predicate would pass it.
  await pasteAnchor(page, '<a href="  tel:+81312345678">文字</a>', '文字');
  expect(await docString(page)).toBe('doc(paragraph("ここ文字"))');
});

// linkOnPaste applies the mark with a raw setMark, bypassing `isAllowedUri`. linkifyjs finds `ftp://`
// (not `tel:`/`sms:`; `cid:a@example.com` reads as an email), so PostEditor's own handlePaste
// guards it.
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
  // Route (a), linking chosen text, is untouched by that guard.
  expect(await docString(page)).toBe('doc(paragraph(link("ここ")))');
});

test('an https link is unaffected', async ({ page }) => {
  await openEditor(page);
  await pasteAnchor(page, '<a href="https://example.com">文字</a>', '文字');
  expect(await docString(page)).toBe('doc(paragraph("ここ", link("文字")))');
});

test('a mailto link is unaffected', async ({ page }) => {
  await openEditor(page);
  // In both allowlists.
  await pasteAnchor(page, '<a href="mailto:a@example.com">文字</a>', '文字');
  expect(await docString(page)).toBe('doc(paragraph("ここ", link("文字")))');
});

test('an in-site relative link is unaffected', async ({ page }) => {
  await openEditor(page);
  // No scheme, as links to own posts are: the default check stays in front for these.
  await pasteAnchor(page, '<a href="/posts/foo">文字</a>', '文字');
  expect(await docString(page)).toBe('doc(paragraph("ここ", link("文字")))');
});

test('a fragment link is unaffected', async ({ page }) => {
  await openEditor(page);
  await pasteAnchor(page, '<a href="#midashi">文字</a>', '文字');
  expect(await docString(page)).toBe('doc(paragraph("ここ", link("文字")))');
});
