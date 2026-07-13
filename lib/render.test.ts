import { describe, expect, it } from 'vitest';
import { renderMdxToHtml } from '@/lib/render';

// Guards the public render pipeline end-to-end (remark-gfm → alerts →
// remark-rehype → rehype-raw → rehype-sanitize → pretty-code). Focus: the GitHub
// alert transform and the sanitize-schema edit that lets its classes through —
// the schema is security-sensitive (untrusted non-admin authors), so these pin
// that the allowlist stays narrow.
describe('renderMdxToHtml — GitHub alerts', () => {
  it('renders a [!WARNING] blockquote as a styled alert, marker stripped', async () => {
    const html = await renderMdxToHtml('> [!WARNING]\n> Be careful **here**.');
    expect(html).toContain('markdown-alert markdown-alert-warning');
    // The type word survives sanitize inside its sr-only label span (icon-only
    // visually, but announced to screen readers) — pins that the schema edit lets
    // the span + its one allowed class through.
    expect(html).toContain('<span class="markdown-alert-title-label">警告</span>');
    // Body is wrapped in a content column div; the sanitize schema must allow it.
    expect(html).toContain('<div class="markdown-alert-content">');
    expect(html).toContain('<strong>here</strong>');
    expect(html).not.toContain('[!WARNING]');
  });

  it('keeps the alert classes but strips a non-allowlisted class', async () => {
    // The `['className', …]` value allowlist must NOT have blanket-enabled
    // className: a bogus class on raw HTML should still be sanitized away.
    const html = await renderMdxToHtml('<div class="evil">x</div>\n\n> [!NOTE]\n> ok');
    expect(html).toContain('markdown-alert-note');
    expect(html).not.toContain('evil');
  });
});

// The Zenn/Qiita ```lang:filename fence: remarkCodeFilename splits the colon so the language
// still highlights and the filename becomes a pretty-code title bar (figcaption).
describe('renderMdxToHtml — code block filename', () => {
  it('renders ```lang:filename as a highlighted block with a title figcaption', async () => {
    const html = await renderMdxToHtml('```ts:index.ts\nconst x = 1;\n```');
    // pretty-code emits the filename in a <figcaption data-rehype-pretty-code-title>.
    expect(html).toContain('data-rehype-pretty-code-title');
    expect(html).toContain('index.ts');
    // The block still highlights as TS (pretty-code wraps it in its figure), and the raw
    // `ts:index.ts` info string never leaks into a bogus language class.
    expect(html).toContain('data-rehype-pretty-code-figure');
    expect(html).not.toContain('index.ts"><code'); // no `language-ts:index.ts`-style leak
  });

  it('leaves a plain ```lang fence without a title', async () => {
    const html = await renderMdxToHtml('```ts\nconst x = 1;\n```');
    expect(html).toContain('data-rehype-pretty-code-figure');
    expect(html).not.toContain('data-rehype-pretty-code-title');
  });
});
