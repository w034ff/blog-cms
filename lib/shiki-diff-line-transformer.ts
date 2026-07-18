import type { ShikiTransformer } from 'shiki';

// A word-boundary check for the bare `diff` flag lib/rehype-code-filename.ts encodes into the
// fence's meta string (alongside `title="…"`, when both are present).
const DIFF_META_FLAG = /(?:^|\s)diff(?:\s|$)/;

// Both the meta-flag test and the line split are per-BLOCK facts, but the line() hook below
// runs per LINE — so they're computed once in preprocess and stashed in `this.meta`, shiki's
// per-highlight-run scratch space (typed via this augmentation; the interface is shipped
// empty for exactly this purpose). `null` means "not a diff block".
declare module '@shikijs/types' {
  interface ShikiTransformerContextMeta {
    diffLines?: string[] | null;
  }
}

// A code block is a diff based on the `diff` meta flag, not the Shiki language — a
// `diff_<lang>` fence highlights as its real language (e.g. `ts`), with diff coloring layered
// on top, so this can no longer key off `this.options.lang === 'diff'`. Shiki's bundled `diff`
// grammar (used for the no-language `diff`/`diff_` form) only carries the +/- markup as a
// token *foreground* color (see @shikijs/langs/diff + the github-dark/light themes'
// markup.inserted/deleted scopes) — rehype-pretty-code never surfaces the scope's
// `background`, so a bare diff fence reads as barely-tinted text instead of a GitHub-style
// diff. This adds a class per line so CSS (app/globals.css) can paint the full row, based on
// the raw source line's leading +/- (excluding the `+++`/`---` file-header lines of a unified
// diff).
export function diffLineHighlight(): ShikiTransformer {
  return {
    name: 'diff-line-highlight',
    preprocess(code) {
      const isDiff = DIFF_META_FLAG.test(this.options.meta?.__raw ?? '');
      this.meta.diffLines = isDiff ? code.split('\n') : null;
    },
    line(hast, line) {
      const raw = this.meta.diffLines?.[line - 1];
      if (raw === undefined) return;
      if (raw.startsWith('+') && !raw.startsWith('+++')) {
        this.addClassToHast(hast, 'diff-line-add');
      } else if (raw.startsWith('-') && !raw.startsWith('---')) {
        this.addClassToHast(hast, 'diff-line-remove');
      }
    },
  };
}
