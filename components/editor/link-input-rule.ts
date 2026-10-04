import { Extension, InputRule } from '@tiptap/core';

// `[text](url)` typed in the editor becomes a link (docs/link-requirements.md §5.4).
//
// Text serialization escapes `[` and `]` unconditionally (§2.2.1), and the link card depends on
// that escape (docs/link-card-requirements.md §4.1 (b)), so the syntax has to be taken while it is
// being typed. `extension-link` has no input rule of its own. Paste stays literal:
// `transformPastedText` is false (§5.4), and changing that is a decision about every paste.

// The optional title is the form the serializer writes (§2.2: `[text](href "title")`). Empty text
// does not match (an invisible link); whitespace ends the href, as in markdown, because the title
// begins there. The lookbehind leaves `![alt](src)` to the image extension; a `[^!]` would consume
// a character and shift every offset below.
const LINK_SYNTAX = /(?<!!)\[([^[\]]+)\]\(([^\s()]+)(?:\s+"([^"]*)")?\)$/;

export const LinkInputRule = Extension.create({
  name: 'linkInputRule',

  addInputRules() {
    return [
      new InputRule({
        find: LINK_SYNTAX,
        handler: ({ state, range, match, can }) => {
          const [fullMatch, text, href, title] = match;
          if (!text || !href) return null;

          // `setLink` checks the href against `isAllowedUri` (link-protocols.ts) and then
          // `canSetMark`, which refuses an accordion title (`marks: ''`) and inline `code`.
          // Declining leaves the literal text, href and all; applying a filtered mark would lose the
          // URL. (TipTap's runner already skips carets next to `spec.code` marks; the gate does not
          // rely on that upstream behaviour.)
          if (!can().setLink({ href })) return null;

          const type = state.schema.marks.link;
          if (!type) return null;

          const { tr } = state;
          const textStart = range.from + fullMatch.indexOf(text);
          const textEnd = textStart + text.length;

          // Delete the tail first: taking `[` out first would move everything behind it.
          tr.delete(textEnd, range.to);
          tr.delete(range.from, textStart);
          tr.addMark(range.from, range.from + text.length, type.create({ href, title }));
          // What `setLink` sets for itself. The link text can be a URL — `[https://a](/posts/b)` —
          // and autolink would otherwise reconsider it and overwrite the href just written.
          tr.setMeta('preventAutolink', true);
        },
      }),
    ];
  },
});
