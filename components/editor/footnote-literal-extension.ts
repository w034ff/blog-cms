import { Extension } from '@tiptap/core';
import type MarkdownIt from 'markdown-it';

// Keeps GFM footnote syntax as literal text instead of letting markdown-it eat it.
//
// The editor has no footnote node, so `[^1]` is only ever plain text here — but a footnote
// *definition* line (`[^1]: 注釈テキスト`) is shaped exactly like a markdown link reference
// definition (`[label]: destination`), and markdown-it's `reference` block rule claims it:
// the line is consumed without emitting a token, and the `[^1]` in the body then resolves
// against it into `<a href="注釈テキスト">^1</a>`. So a round-trip through the editor didn't
// merely fail to render the footnote — it deleted the note's text from the document and left
// a bogus link whose href was that text.
//
// Declining the reference rule for `[^…]` labels lets the paragraph rule pick the line up as
// ordinary text; the serializer's own escaping then writes it back as `\[^1\]: 注釈テキスト`,
// which is stable across further round-trips. Footnotes stay unsupported (a deliberate call —
// nothing published uses them), but the words the author typed survive.
//
// Only `^`-prefixed labels are declined, so real link reference definitions keep working.

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
