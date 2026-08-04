import { test, expect } from '@playwright/test';
import { loadMarkdown } from './editor-authoring';
import { markdown, docString } from './editor-probe';

// SPIKE (docs/footnote-requirements.md §7). The markdown layer for footnotes is registered and
// nothing else — no definition section, no guards, no insertion route. What this measures is the
// one question design writing cannot answer: does load → serialize → load hold?
//
// The direction that matters is serialization. Neither tiptap-markdown nor prosemirror-markdown
// carries any footnote handling, so both halves are written by hand and either could lose text.
//
// This supersedes editor-footnote-literal.spec.ts, which pinned the opposite contract — that
// `[^1]` stays literal text — and whose history belongs here. Measured 2026-08-02, fixed
// 2026-08-03: a definition line is shaped like a markdown link reference definition, so
// markdown-it's `reference` rule consumed it without emitting a token and the body's `[^1]`
// resolved against it into `<a href="注釈テキスト">^1</a>`. The note's words left the document
// entirely and came back as a URL. Footnotes were then deliberately left unsupported and the words
// merely kept as text; this spike is the reversal, so the same input now has to produce nodes.
// The guard that stood in between is still registered and is now unreachable — see
// footnote-literal-extension.ts and §7.2.

// Load, read back what would be saved, then load that and read again. A feature that round-trips
// reaches a fixed point on the second pass; one that merely survives once does not.
async function roundTrip(page: import('@playwright/test').Page, source: string) {
  await loadMarkdown(page, source);
  const first = await markdown(page);
  const doc = await docString(page);
  await loadMarkdown(page, first);
  return { first, second: await markdown(page), doc };
}

test.beforeEach(async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
});

test('a footnote round-trips as GFM syntax', async ({ page }) => {
  const { first, second, doc } = await roundTrip(page, '本文[^1]\n\n[^1]: 注釈テキスト\n');

  // Both halves are real nodes now, not the literal text the guard used to leave behind. The
  // trailing paragraph is TrailingNode's, and it is §3.1 measured rather than argued: the last
  // node is not a paragraph, so one is appended below the definition. Once the definitions live in
  // the section §3 asks for, that paragraph has to move above it.
  expect(doc).toBe(
    'doc(paragraph("本文", footnoteReference), footnoteDefinition("注釈テキスト"), paragraph)',
  );
  // The note's text is in the document, and the syntax is unescaped GFM — the whole point.
  expect(first).toContain('[^1]: 注釈テキスト');
  expect(first).toContain('本文[^1]');
  expect(first).not.toContain('\\[');
  expect(second).toBe(first);
});

test('a generated label survives the round trip unchanged', async ({ page }) => {
  // §4.1: a label is never rewritten once it exists. The default renderer drops it — `[^fn-a3f]`
  // becomes `id="fn1"` — so this is what the replaced renderer rules buy.
  const { first, second } = await roundTrip(page, '本文[^fn-a3f]\n\n[^fn-a3f]: 注釈\n');

  expect(first).toContain('[^fn-a3f]');
  expect(first).toContain('[^fn-a3f]: 注釈');
  expect(second).toBe(first);
});

test('two footnotes keep their own labels and text', async ({ page }) => {
  const { first, second } = await roundTrip(page, '[^b] と [^a]\n\n[^a]: A の注\n\n[^b]: B の注\n');

  expect(first).toContain('[^a]: A の注');
  expect(first).toContain('[^b]: B の注');
  expect(second).toBe(first);
});

test('a footnote at the end of the document round-trips', async ({ page }) => {
  // The definition section is designed to sit at the document's end (§3), so this is the shape
  // every footnote eventually takes.
  const { first, second } = await roundTrip(page, '# 見出し\n\n本文[^1]\n\n[^1]: 注釈\n');

  expect(first).toContain('[^1]: 注釈');
  expect(second).toBe(first);
});

test('an empty definition does not orphan its reference', async ({ page }) => {
  // §5.3 asserts an empty definition "may not survive the round trip", which is the premise the
  // publish-time check was built on. Measured here rather than assumed.
  const { first, second, doc } = await roundTrip(page, '本文[^x]\n\n[^x]:\n');

  expect(doc).toContain('footnoteReference');
  expect(first).toContain('[^x]');
  expect(second).toBe(first);
});

test('an inline ^[note] becomes an ordinary footnote rather than vanishing', async ({ page }) => {
  // §1 lists `^[…]` as a non-goal, but the plugin parses it the moment it is installed. What
  // happens to the author's words is the question — this pins the answer.
  const { first, second } = await roundTrip(page, '本文^[インライン注]\n');

  expect(first).toContain('インライン注');
  expect(second).toBe(first);
});

test('an orphan definition keeps its text', async ({ page }) => {
  // §5.4 says an orphan definition is kept and reported. markdown-it-footnote's tail drops it
  // instead — the definition tokens are filtered out of the stream and never re-emitted when no
  // reference claimed them. If this fails, installing the plugin makes a real case *worse* than
  // the literal-text guard it replaces.
  const { first } = await roundTrip(page, '本文\n\n[^x]: 消えては困る注釈\n');

  expect(first).toContain('消えては困る注釈');
});
