import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { remarkGithubAlerts } from '@/lib/remark-github-alerts';

// Render markdown → HTML through the alert transform in isolation (no gfm /
// sanitize / pretty-code) so these assertions pin the plugin's own behavior.
function render(md: string): string {
  return String(
    unified()
      .use(remarkParse)
      .use(remarkGithubAlerts)
      .use(remarkRehype)
      .use(rehypeStringify)
      .processSync(md),
  );
}

describe('remarkGithubAlerts', () => {
  it('rewrites a [!NOTE] blockquote into an alert div with a title', () => {
    const html = render('> [!NOTE]\n> Body text.');
    expect(html).toContain('<div class="markdown-alert markdown-alert-note">');
    expect(html).toContain('<p class="markdown-alert-title">ノート</p>');
    expect(html).toContain('Body text.');
    // The marker itself must not leak into the rendered content.
    expect(html).not.toContain('[!NOTE]');
    // No longer a blockquote.
    expect(html).not.toContain('<blockquote>');
  });

  it('maps each type to its accent class and Japanese label', () => {
    const cases: [string, string, string][] = [
      ['TIP', 'markdown-alert-tip', 'ヒント'],
      ['IMPORTANT', 'markdown-alert-important', '重要'],
      ['WARNING', 'markdown-alert-warning', '警告'],
      ['CAUTION', 'markdown-alert-caution', '注意'],
    ];
    for (const [marker, cls, label] of cases) {
      const html = render(`> [!${marker}]\n> x`);
      expect(html).toContain(cls);
      expect(html).toContain(`>${label}</p>`);
    }
  });

  it('is case-insensitive on the marker', () => {
    expect(render('> [!warning]\n> x')).toContain('markdown-alert-warning');
  });

  it('keeps content that shares the first line via a soft break', () => {
    const html = render('> [!NOTE]\n> First line body.');
    expect(html).toContain('First line body.');
    expect(html).not.toContain('[!NOTE]');
  });

  it('handles a marker-only first line with content in a later paragraph', () => {
    const html = render('> [!TIP]\n>\n> Separate paragraph.');
    expect(html).toContain('markdown-alert-tip');
    expect(html).toContain('<p>Separate paragraph.</p>');
    expect(html).toContain('<p class="markdown-alert-title">ヒント</p>');
  });

  it('drops a hard break right after the marker (no leading <br>)', () => {
    // The WYSIWYG editor serializes a Shift+Enter as a hard break, so the marker
    // and content share a paragraph split by a <br>. The callout must not keep it.
    const html = render('> [!NOTE]\n> \\\n> Body after a hard break.');
    expect(html).toContain('markdown-alert-note');
    expect(html).toContain('Body after a hard break.');
    expect(html).not.toContain('<br>');
  });

  it('resolves escaped brackets the editor emits (\\[!NOTE\\])', () => {
    // tiptap-markdown escapes the brackets; remark resolves them before this
    // transform sees the text, so the alert still matches.
    const html = render('> \\[!NOTE\\]\n> ok');
    expect(html).toContain('markdown-alert-note');
    expect(html).not.toContain('[!NOTE]');
  });

  it('leaves an ordinary blockquote untouched', () => {
    const html = render('> just a quote');
    expect(html).toContain('<blockquote>');
    expect(html).not.toContain('markdown-alert');
  });

  it('ignores an unknown bang tag', () => {
    const html = render('> [!FOOBAR]\n> x');
    expect(html).toContain('<blockquote>');
    expect(html).not.toContain('markdown-alert');
  });

  it('does not treat a same-line "[!NOTE] text" as an alert (marker must be alone)', () => {
    const html = render('> [!NOTE] inline text');
    expect(html).toContain('<blockquote>');
    expect(html).not.toContain('markdown-alert');
  });
});
