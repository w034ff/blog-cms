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

// A diff block is one with the `diff` meta flag, not the Shiki language, since `diff_<lang>`
// highlights as `<lang>`. Shiki's `diff` grammar only colours the +/- text, and rehype-pretty-code
// never surfaces the scope's background, so each +/- line (not `+++`/`---` headers) gets a class
// for app/globals.css to paint the row.
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
