import type { ShikiTransformer } from 'shiki';

// Shiki's bundled `diff` grammar only carries the +/- markup as a token *foreground*
// color (see @shikijs/langs/diff + the github-dark/light themes' markup.inserted/deleted
// scopes) — rehype-pretty-code never surfaces the scope's `background`, so a ```diff
// fence reads as barely-tinted text instead of a GitHub-style diff. This adds a class per
// line so CSS (app/globals.css) can paint the full row, based on the raw source line's
// leading +/- (excluding the `+++`/`---` file-header lines of a unified diff).
export function diffLineHighlight(): ShikiTransformer {
  return {
    name: 'diff-line-highlight',
    line(hast, line) {
      if (this.options.lang !== 'diff') return;
      const raw = this.source.split('\n')[line - 1] ?? '';
      if (raw.startsWith('+') && !raw.startsWith('+++')) {
        this.addClassToHast(hast, 'diff-line-add');
      } else if (raw.startsWith('-') && !raw.startsWith('---')) {
        this.addClassToHast(hast, 'diff-line-remove');
      }
    },
  };
}
