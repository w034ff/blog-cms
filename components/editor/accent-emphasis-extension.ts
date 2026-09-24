import { Mark } from '@tiptap/core';
import { guardedToggle } from './guarded-toggle';

// The "強調" mark: bold weight plus the site's red accent, as one mark so one shortcut gets both.
// Renders as `<span class="accent-emphasis">`, not `<strong>`: bold's parseHTML matches any
// `<strong>`, so a re-parse would attach both marks. `.accent-emphasis` (app/globals.css) is
// unscoped so it also colors the toolbar button's glyph.
export const AccentEmphasis = Mark.create({
  name: 'accentEmphasis',

  // Exclusive with the delimiter marks: a bold/italic/strike overlapping the `<span>` can put a
  // delimiter against the span's `<`, where CommonMark's flanking rule leaves it literal in the
  // published HTML; inside a code span the `<span>` itself shows as escaped text.
  //
  // The two toggle orders are deliberately asymmetric:
  //   - bold/italic/strike onto 強調 is BLOCKED: canSetMark only asks whether an *existing* mark
  //     excludes the incoming one, so the button greys out.
  //   - 強調 onto bold/italic/strike REPLACES them: those keep `excludes: '_self'`, and addMark's
  //     symmetric Mark#addToSet removes what can't coexist. Bold loses nothing (the span is bold);
  //     italic and strike are dropped in exchange for markdown that always round-trips.
  //   - code blocks both ways on its own (`excludes: '_'`); listed below for readability.
  //
  // `accentEmphasis` leads the list because naming anything drops the implicit self-exclusion
  // (Schema's constructor: `excl == null ? [type] : gatherMarks(...)`). `_self` is not valid
  // inside the list — gatherMarks throws on it.
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
      // guardedToggle only matters here inside inline `code` or a node that allows no marks;
      // toggling onto bold/italic/strike is a real replacing edit.
      toggleAccentEmphasis: guardedToggle(this.name),
    };
  },

  addStorage() {
    return {
      markdown: {
        // No markdown syntax, so it round-trips as raw inline HTML: markdown-it runs with
        // `html: true` (PostEditor.tsx) and parseHTML picks the tag back up on load.
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
