import { Extension } from '@tiptap/core';
import type MarkdownIt from 'markdown-it';

// Keeps a footnote-shaped definition line as literal text when markdown-it-footnote will not take
// it, so that markdown-it's `reference` rule cannot.
//
// A definition line is shaped like a link reference definition, and the `reference` rule consumes
// it, turning the note's words into a URL. markdown-it-footnote's `footnote_def` runs first, but it
// declines a label containing a space (`[^a b]: 注釈テキスト`), which then falls to `reference`.
// This is the backstop for those lines: they stay text and the serializer escapes them back.
// Only `^`-prefixed labels are declined, so real reference definitions keep working.

type BlockRuler = MarkdownIt['block']['ruler'];
// The rule signature straight off `at()`, so it can't drift from the installed markdown-it.
type BlockRule = Parameters<BlockRuler['at']>[1];

// `__rules__` is private and @types/markdown-it doesn't declare it, but `at()` replaces a rule
// without handing back the one it replaced, and this guard has to delegate to the original for
// every non-footnote label. On public API alone the only option is disabling `reference`
// outright, which would take ordinary link reference definitions down with it.
type BlockRulerInternals = { __rules__: { name: string; fn: BlockRule; alt: string[] }[] };

const OPEN_BRACKET = 0x5b; // [
const CARET = 0x5e; // ^

// tiptap-markdown runs every extension's parse.setup on each parse, not once per editor, so
// re-wrapping would nest the guard one layer deeper per call. Remember which instances are
// already patched instead.
const patched = new WeakSet<MarkdownIt>();

export function keepFootnoteDefinitionsLiteral(markdownit: MarkdownIt): void {
  if (patched.has(markdownit)) return;

  const ruler = markdownit.block.ruler;
  const reference = (ruler as typeof ruler & BlockRulerInternals).__rules__.find(
    (rule) => rule.name === 'reference',
  );
  // No reference rule means nothing can swallow the line in the first place.
  if (!reference) return;

  const parseReference = reference.fn;
  ruler.at(
    'reference',
    (state, startLine, endLine, silent) => {
      const start = state.bMarks[startLine] + state.tShift[startLine];
      if (
        state.src.charCodeAt(start) === OPEN_BRACKET &&
        state.src.charCodeAt(start + 1) === CARET
      ) {
        return false;
      }
      return parseReference(state, startLine, endLine, silent);
    },
    { alt: reference.alt },
  );

  patched.add(markdownit);
}

export const FootnoteLiteral = Extension.create({
  name: 'footnoteLiteral',

  addStorage() {
    return {
      markdown: {
        parse: { setup: keepFootnoteDefinitionsLiteral },
      },
    };
  },
});
