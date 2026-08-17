import { Extension, InputRule } from '@tiptap/core';

// `[text](url)` typed in the editor becomes a link (docs/link-requirements.md §5.4).
//
// Every other markdown shape this editor answers — headings, quotes, fences, `:::details`, `[^` —
// has an input rule, and `[]()` alone was inert. Worse than inert: text serialization escapes `[`
// and `]` unconditionally, so what the author typed was stored as `\[text\](url)` and came back
// literal from every reload (§2.2.1). That escape is not a bug to remove at the serializer — the
// link card is built on it (docs/link-card-requirements.md §4.1 (b)) — so the syntax has to be
// taken while it is still text being typed, which is the only moment this rule needs.
//
// It sits outside the Link extension because `extension-link` contributes `addPasteRules` only and
// leaves the input-rule seat empty. Keeping it here rather than in a local `.extend()` of Link puts
// the whole feature in one file, the call `LinkBubble.tsx` already made for Mod-k.
//
// Typing is the only door. `transformPastedText` is false (§5.4), so a pasted `[text](url)` is
// still literal text — input rules do not run on paste, and widening that is a different decision
// about every paste, not about this syntax.

// The title is optional because that is the form the serializer itself writes (§2.2:
// `[text](href "title")`), so an author who copies a line out of stored markdown and types it back
// gets what was there. An empty text (`[](url)`) does not match: the mark would have nothing to
// hang on and the author would be left with an invisible link. Whitespace is refused inside the
// href for the same reason markdown refuses it — it is where the title begins.
//
// The lookbehind is what keeps `![alt](src)` out, and that syntax has an owner — the image
// extension's own input rule answers it. A `[^!]` in front would match a character and shift every
// offset below by one; a zero-width assertion leaves `match[0]` starting at `[`.
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

          // One predicate answers both refusals, and it is the extension's own. `setLink` runs the
          // href through the configured `isAllowedUri` — which PostEditor narrowed to the schemes
          // the public sanitizer will actually publish (link-protocols.ts) — and then asks
          // `canSetMark`, which refuses where the mark cannot go: an accordion title (`marks: ''`)
          // and inline `code` (`excludes`). Declining leaves the literal text standing, href and
          // all; applying the mark where it is filtered would drop the href without a word and the
          // author would lose the URL, not just the styling.
          //
          // Inline `code` never reaches here anyway — TipTap's input-rule runner skips a caret
          // whose neighbouring marks carry `spec.code` (measured; prosemirror-inputrules on its own
          // looks only at the parent node, which is what §5.4 constraint 4 expected). The gate is
          // still asked for it, because that skip is upstream's and this is ours.
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
          // The link mark is inclusive whenever `autolink` is on (`inclusive()` in extension-link),
          // and it is (§4). Without this, everything typed after the `)` joins the link.
          tr.removeStoredMark(type);
          // What `setLink` sets for itself. The link text can be a URL — `[https://a](/posts/b)` —
          // and autolink would otherwise reconsider it and overwrite the href just written.
          tr.setMeta('preventAutolink', true);
        },
      }),
    ];
  },
});
