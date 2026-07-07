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
    expect(html).toContain('markdown-alert-title');
    expect(html).toContain('警告');
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
