import { Extension } from '@tiptap/core';
import type MarkdownIt from 'markdown-it';

// Keeps a footnote-shaped definition line as literal text when markdown-it-footnote will not take
// it, so that markdown-it's `reference` rule cannot.
//
// This started as the whole of the footnote story: with no footnote plugin installed, a definition
// line (`[^1]: 注釈テキスト`) is shaped exactly like a markdown link reference definition
// (`[label]: destination`), and the `reference` block rule claimed it — the line was consumed
// without emitting a token, and the `[^1]` in the body then resolved against it into
// `<a href="注釈テキスト">^1</a>`. Opening a post did not merely fail to render the footnote; it
// took the note's words out of the document and handed them back as a URL.
//
// Footnotes are supported now (footnote-extension.ts), and markdown-it-footnote's `footnote_def`
// rule is registered *before* `reference`, so every definition it accepts is claimed long before
// this guard is asked. What keeps this file alive is the set of lines it does **not** accept.
// `footnote_def` refuses a label containing a space and returns the line to the block rules —
// measured, `[^a b]: 注釈テキスト` comes back as `<a href="%E6%B3%A8...">^a b</a>` with the guard
// removed, which is the original data loss exactly.
//
// So the role narrowed rather than ended: this is the backstop for the footnote-shaped lines the
// plugin declines. They stay ordinary text, the serializer's own escaping writes them back as
// `\[^a b\]: 注釈テキスト`, and the words survive. Declining only `^`-prefixed labels leaves real
// link reference definitions working.

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
