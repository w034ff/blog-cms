import { Mark } from '@tiptap/core';
import { guardedToggle } from './guarded-toggle';

// The "強調" mark: bold weight + the site's single red accent (same hue as h2's underline,
// h3's left rule, and the callout icons — red is this theme's general emphasis color, not
// warning-specific, so reusing it here for inline text needs no new hue). A single combined
// mark rather than separately toggled bold+color, so one shortcut/button gets both. Renders as
// `<span class="accent-emphasis">` rather than `<strong>`: the built-in bold mark's own
// parseHTML matches any `<strong>`, and re-parsing our serialized markdown would then attach
// both marks to the same text and double-serialize it. `.accent-emphasis` (app/globals.css)
// is intentionally unscoped (not `.prose .accent-emphasis`) so the same rule colors both this
// content mark and the toolbar button's preview glyph.
export const AccentEmphasis = Mark.create({
  name: 'accentEmphasis',

  // Mutually exclusive with every other punctuation-delimited mark. The problem is generic to
  // all of bold/italic/strike: letting one coexist with accentEmphasis on a partially-overlapping,
  // whitespace-free range serializes as an independent `**…**`/`*…*`/`~~…~~` overlapping a
  // `<span>…</span>` at a boundary that can land the delimiter directly between plain text and
  // the span's `<` with no space — CommonMark's flanking rule then rejects that delimiter as an
  // opener and it survives literally into the published HTML. Code has a different but related
  // failure: a code span's content is never HTML-parsed, so an accent-emphasis span nested inside
  // one shows up as literal escaped `&lt;span…&gt;` text instead of being rendered.
  //
  // The two toggle orders are NOT symmetric, and the difference is intentional:
  //   - bold/italic/strike onto accent-emphasized text is BLOCKED. TipTap's canSetMark only asks
  //     whether an *existing* mark excludes the incoming one — exactly this direction — so the
  //     command reports false: the toolbar grays the button out, and guardedToggle keeps the
  //     dead transaction off the undo stack.
  //   - accentEmphasis onto bold/italic/strike REPLACES them. canSetMark never looks the other
  //     way (those marks keep the default `excludes: '_self'`, so they don't exclude us), so the
  //     dispatch goes through and prosemirror-transform's addMark — which uses the symmetric
  //     Mark#addToSet — emits a RemoveMarkStep for whatever can't coexist. Accepted as this
  //     mark's semantics: 強調 replaces other inline decoration rather than stacking with it.
  //     Nothing is lost for bold (`.accent-emphasis` already renders bold weight); italic and
  //     strike are dropped deliberately, in exchange for never emitting markdown that fails to
  //     round-trip.
  //   - code is symmetric on its own: @tiptap/extension-code declares `excludes: '_'`, which
  //     blocks accentEmphasis from its side too, so neither order ever replaces anything.
  //     Listing it below is therefore redundant, but it keeps the intent readable.
  //
  // `accentEmphasis` leads the list to restore self-exclusion: prosemirror-model applies the
  // implicit `[self]` only when `excludes` is left undefined (Schema's constructor:
  // `excl == null ? [type] : gatherMarks(...)`), so naming anything at all silently drops it.
  // Harmless while this mark has no attrs — Mark#addToSet short-circuits on `this.eq(other)` —
  // but it would bite the moment one is added. Spelled out rather than `_self`, which is not a
  // keyword inside the list (gatherMarks would throw on it as an unknown mark name).
  excludes: 'accentEmphasis bold italic strike code',

  parseHTML() {
    return [{ tag: 'span.accent-emphasis' }];
  },

  renderHTML() {
    return ['span', { class: 'accent-emphasis' }, 0];
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-e': () => this.editor.commands.toggleAccentEmphasis(),
      'Mod-Shift-E': () => this.editor.commands.toggleAccentEmphasis(),
    };
  },

  addCommands() {
    return {
      // guardedToggle (see guarded-toggle.ts) — same no-op-dispatch-still-costs-an-undo-step
      // issue, but with a narrower reach than on the other marks, per the asymmetry noted at
      // `excludes` above: this only fires where an existing mark excludes accentEmphasis, i.e. an
      // inline `code` span (or a parent node that allows no marks at all). Toggling onto
      // bold/italic/strike is a real edit that replaces them, not a blocked no-op.
      toggleAccentEmphasis: guardedToggle(this.name),
    };
  },

  addStorage() {
    return {
      markdown: {
        // No native markdown syntax for this, so it round-trips as raw inline HTML — safe
        // because the Markdown extension is configured with `html: true` (PostEditor.tsx),
        // which passes literal `<span>`/`</span>` through markdown-it unescaped instead of
        // encoding them as text. parseHTML above then picks the tag back up on load.
        serialize: {
          open: '<span class="accent-emphasis">',
          close: '</span>',
          mixable: true,
          expelEnclosingWhitespace: true,
        },
        parse: {
          // handled by markdown-it's raw-HTML passthrough + parseHTML above
        },
      },
    };
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    accentEmphasis: {
      toggleAccentEmphasis: () => ReturnType;
    };
  }
}
