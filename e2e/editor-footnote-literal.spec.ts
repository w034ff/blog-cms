import { test, expect } from '@playwright/test';
import { loadMarkdown } from './editor-authoring';
import { markdown, docString } from './editor-probe';

// Regression (measured 2026-08-02, fixed 2026-08-03): opening a post whose body used GFM
// footnote syntax destroyed the note. A definition line (`[^1]: 注釈テキスト`) is shaped like a
// markdown link reference definition, so markdown-it's `reference` rule consumed it without
// emitting a token and the body's `[^1]` resolved against it into `<a href="注釈テキスト">^1</a>`
// — the note's words left the document entirely and came back as a URL. The editor has no
// footnote node and deliberately gains none (nothing published uses footnotes); what it must not
// do is delete text the author typed. See components/editor/footnote-literal-extension.ts.
//
// Loading markdown is the whole of the trigger — this is a parse-side bug, so it needs no typing.
const FOOTNOTE_BODY = '本文[^1]\n\n[^1]: 注釈テキスト\n';

test('a footnote definition survives the round-trip as literal text', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await loadMarkdown(page, FOOTNOTE_BODY);

  // Two ordinary paragraphs: the definition line reached the document at all, which is the half
  // that used to vanish. No link node anywhere — the reference resolving into one is how the
  // note's text got laundered into an href.
  expect(await docString(page)).toBe('doc(paragraph("本文[^1]"), paragraph("[^1]: 注釈テキスト"))');

  // What would be saved. Escaped by the serializer, so re-parsing can't re-open the reference
  // path — the round-trip is stable, not merely survivable once.
  const saved = await markdown(page);
  expect(saved).toContain('注釈テキスト');
  expect(saved).not.toContain('](');

  // And the hidden input PostEditor actually submits agrees with the probe.
  await expect(page.locator('input[name="body"]')).toHaveValue(/注釈テキスト/);

  // Second pass over the serializer's own output: the text is still there and still not a link.
  await loadMarkdown(page, saved);
  expect(await markdown(page)).toBe(saved);
});
