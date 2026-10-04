import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { docString, markdown, settle } from './editor-probe';
import { loadMarkdown, setRange } from './editor-authoring';

// Calibrates the synthetic paste the other specs use (docs/link-requirements.md §9). A synthesized
// event always carries `clipboardData`, so it never takes prosemirror-view's other branch (paste into
// a hidden node, read the DOM back). The same string is pasted both ways and the documents compared,
// so if the instruments diverge one spec goes red. Checked, not assumed, like `closeHistory`.
//
// **Plain text only**: `writeText` cannot carry `text/html`, and a flavour can decide the outcome
// (§2.5's `vscode-editor-data`). **It uses the machine's clipboard**, replacing whatever the
// developer copied, so it stays one file.

const URL_TEXT = 'https://example.com';

const pageErrors: string[] = [];
test.beforeEach(async ({ page, context }) => {
  pageErrors.length = 0;
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
});
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

// The other specs' instrument: `text/plain` on a hand-built DataTransfer.
async function pasteSynthetic(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', value);
    document
      .querySelector('.ProseMirror')
      ?.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
  }, text);
}

// The system clipboard, then the key. 127.0.0.1 is a secure context; a missing `navigator.clipboard`
// throws, failing rather than passing.
async function pasteReal(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
  await page.keyboard.press('Control+v');
}

type Paste = (page: Page, text: string) => Promise<void>;

// A fresh document, a positioned caret or selection, then the paste.
async function docAfterPaste(
  page: Page,
  paste: Paste,
  { md, from, to }: { md: string; from: number; to?: number },
): Promise<string> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, md);
  await setRange(page, from, to);
  await paste(page, URL_TEXT);
  await settle(page);
  return docString(page);
}

async function bothInstruments(
  context: BrowserContext,
  fixture: { md: string; from: number; to?: number },
): Promise<{ synthetic: string; real: string }> {
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    return {
      synthetic: await docAfterPaste(page, pasteSynthetic, fixture),
      real: await docAfterPaste(page, pasteReal, fixture),
    };
  } finally {
    await page.close();
  }
}

test('the real key and the synthesized event agree over a selection (16a)', async ({ context }) => {
  // Route (a), `linkOnPaste` over a selection: §11's shape, the one most needing an honest instrument.
  const { synthetic, real } = await bothInstruments(context, { md: 'ここ\n', from: 1, to: 3 });
  expect(real).toBe(synthetic);
  // Both made the link, not both nothing.
  expect(real).toBe(`doc(paragraph(link("ここ")))`);
});

test('the real key and the synthesized event agree on pasted HTML (16c)', async ({ page }) => {
  // The flavour half: `ClipboardItem` puts both types on the real clipboard, so route (d) is reached by
  // the key.
  const html = '<p>前<a href="https://example.com" title="t">リンク</a>後</p>';
  const text = '前リンク後';
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();

  await loadMarkdown(page, '\n');
  await setRange(page, 1);
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
  await settle(page);
  const synthetic = await docString(page);

  await page.evaluate(
    async ({ html, text }) =>
      navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]),
    { html, text },
  );
  await loadMarkdown(page, '\n');
  await setRange(page, 1);
  await page.keyboard.press('Control+v');
  await settle(page);

  expect(await docString(page)).toBe(synthetic);
  expect(synthetic).toBe('doc(paragraph("前", link("リンク"), "後"))');
});

test('a link copied off a page arrives with its href resolved (16d)', async ({ page }) => {
  // **Where instrument and reality disagree, and not in the event**: copy serializes the resolved
  // `a.href`, so route (d) always gets an absolute URL; a fragment link copied from a post arrives as
  // that post's URL, not `#user-content-…` (§2.1.1).
  await page.goto('/posts/hello-world');
  await page.evaluate(async () => {
    const host = document.createElement('div');
    // The published attribute (sanitize renamed the id; rehypeClobberFragmentLinks followed).
    host.innerHTML = '<p><a href="#user-content-見出し">断片</a></p>';
    document.querySelector('#post-body')?.appendChild(host);
    const range = document.createRange();
    range.selectNodeContents(host);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.execCommand('copy');
    host.remove();
    await new Promise((r) => setTimeout(r, 200));
  });

  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, '\n');
  await setRange(page, 1);
  await page.keyboard.press('Control+v');
  await settle(page);

  const md = await markdown(page);
  // Absolute, to the source post, percent-encoded.
  expect(md).toContain('/posts/hello-world#user-content-');
  // Not the fixtures' shape: the finding.
  expect(md).not.toContain('](#user-content-見出し)');
});

test('the real key and the synthesized event agree on an empty selection (16b)', async ({
  context,
}) => {
  // Route (c): the paste rule, no selection, links the URL itself.
  const { synthetic, real } = await bothInstruments(context, { md: '\n', from: 1 });
  expect(real).toBe(synthetic);
  expect(real).toBe(`doc(paragraph(link("${URL_TEXT}")))`);
});
