import { Link as BaseLink } from '@tiptap/extension-link';

// The `link` mark, with one thing changed: it is not inclusive.
//
// `extension-link` writes `inclusive() { return this.options.autolink; }`, so keeping autolink on
// (§4) also decided that a character typed at a link's right edge joins the link. Those are two
// different questions and this file separates them — autolink stays exactly as it was.
//
// **Why it matters here**: in Japanese prose the character after a link is usually 。 or 、, and it
// was being swallowed — `前[リンク](…)後` became `前[リンク。](…)後` on one keystroke (measured
// 2026-08-17, docs/link-requirements.md §5.5.12). The left edge was already outside the link, so
// this also makes the two edges answer the same way, which is what Google Docs does.
//
// **What it costs**: the card can no longer ask the caret whether it is in a link — at the right
// edge `isActive('link')` is false and `getAttributes('link')` is `{}`. LinkBubble.tsx resolves the
// link from the text *before* the caret instead. §5.5.2 predicted exactly this coupling; the change
// here is what cashed it in.
//
// A local extension rather than StarterKit's own, because `inclusive` is not an option: it is a
// field of the mark's schema spec, and TipTap builds that by spreading any `extendMarkSchema`
// contributions *first* and then overwriting them with the extension's own `inclusive`
// (`getSchemaByResolvedExtensions` in @tiptap/core), so nothing outside the extension can win.
// Same shape as guarded-toggle-marks.ts and blockquote-extension.ts, which extend their StarterKit
// counterparts the same way — PostEditor turns the bundled one off to avoid a double registration.
export const Link = BaseLink.extend({
  inclusive: () => false,
});
