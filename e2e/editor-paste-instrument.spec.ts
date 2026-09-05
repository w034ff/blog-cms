import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { docString, markdown, settle } from './editor-probe';
import { loadMarkdown, setRange } from './editor-authoring';

// Calibration for the instrument every other paste spec uses (docs/link-requirements.md §9).
//
// Eleven `setData` call sites across this suite build a `DataTransfer` and dispatch a `paste`
// event, and §10's two paste rejections and §11's route-(a) guard all rest on what they measured.
// A synthesized event always arrives *with* `clipboardData`, so it never takes prosemirror-view's
// other branch — the one that lets the browser paste into a hidden node and reads the DOM back.
// Whether the real key goes down the same road was assumed, never measured.
//
// So this file pastes the same string both ways and compares the documents to each other. It is
// not here to pin what paste does; the other files do that. It is here so that the day the two
// instruments diverge, one spec goes red and names every rejection built on the synthetic one.
// The same shape as `closeHistory`'s read-back in editor-authoring.ts: checked, not assumed.
//
// **This calibrates the plain-text shape only, and that is a real limit.** `writeText` can put
// nothing but `text/plain` on the clipboard, while a real copy from a web page also carries
// `text/html` — and §2.5 is the standing proof that a flavour nobody asked about can decide the
// outcome (`vscode-editor-data` turned a paste into a code block). Calibrating the HTML shape means
// opening a page and copying a real selection, which is a different experiment.
//
// **It also uses the machine's clipboard**, which is why it is one file and not a pattern: running
// it replaces whatever the developer had copied.

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

// The instrument the other specs use: `text/plain` on a hand-built DataTransfer.
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

// The real one: the system clipboard, then the key. Chrome treats 127.0.0.1 as a secure context, so
// `navigator.clipboard` exists here. If it does not, this throws — a missing instrument fails the
// test rather than quietly turning it green, which is why §9's reason for keeping the カード's
// コピー button out of the specs does not apply to using the clipboard as a fixture.
async function pasteReal(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
  await page.keyboard.press('Control+v');
}

type Paste = (page: Page, text: string) => Promise<void>;

// A fresh document, a caret or selection placed by position, then the given paste.
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
  // Route (a) — `linkOnPaste` over a non-empty selection. The shape §11 narrowed and §10 twice
  // declined to touch, so the shape whose measurements most need the instrument to be honest.
  const { synthetic, real } = await bothInstruments(context, { md: 'ここ\n', from: 1, to: 3 });
  expect(real).toBe(synthetic);
  // Not vacuous: both actually made the link, rather than both doing nothing.
  expect(real).toBe(`doc(paragraph(link("ここ")))`);
});

test('the real key and the synthesized event agree on pasted HTML (16c)', async ({ page }) => {
  // The flavour half. `ClipboardItem` puts both types on the real clipboard — `writeText` cannot,
  // which is what the comment in editor-link-card.spec.ts was written against — so the browser
  // builds the `clipboardData` this time and route (d) is reached by the key rather than by a
  // hand-built DataTransfer.
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
  // **The one place the instrument and reality disagree — and it is not the event.** The browser
  // serializes the resolved `a.href` property at copy time, not the literal attribute, so every
  // href route (d) receives is absolute. A fragment link copied off a published post therefore
  // arrives as a URL to that post, never as the bare `#user-content-…` the suite's fixtures pass.
  // §2.1.1 was written the other way round until this was measured (2026-08-27).
  await page.goto('/posts/hello-world');
  await page.evaluate(async () => {
    const host = document.createElement('div');
    // The literal attribute a published post carries: sanitize renamed the id and
    // rehypeClobberFragmentLinks rewrote the href to match it.
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
  // Absolute, pointing at the post it was copied from, and percent-encoded by the resolution.
  expect(md).toContain('/posts/hello-world#user-content-');
  // Not the shape the fixtures use — which is the whole finding.
  expect(md).not.toContain('](#user-content-見出し)');
});

test('the real key and the synthesized event agree on an empty selection (16b)', async ({
  context,
}) => {
  // Route (c) — the paste rule, which fires with no selection and links the URL itself.
  const { synthetic, real } = await bothInstruments(context, { md: '\n', from: 1 });
  expect(real).toBe(synthetic);
  expect(real).toBe(`doc(paragraph(link("${URL_TEXT}")))`);
});
