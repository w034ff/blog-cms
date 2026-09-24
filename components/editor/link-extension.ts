import { Link as BaseLink } from '@tiptap/extension-link';

// The `link` mark, made non-inclusive: a character typed at a link's right edge stays outside it.
// Upstream ties `inclusive` to `autolink` (`inclusive() { return this.options.autolink; }`), and
// autolink stays on (docs/link-requirements.md §4); without this, the 。 after a link in Japanese
// prose was swallowed into it. Cost: at the right edge `isActive('link')` is false, so LinkBubble
// resolves the link from the text before the caret. See docs/link-requirements.md §5.5.12.
//
// A local extension because `inclusive` is a schema field, not an option, and
// `getSchemaByResolvedExtensions` (@tiptap/core) lets the extension's own value overwrite any
// `extendMarkSchema` contribution. PostEditor turns StarterKit's link off to avoid a double
// registration.
export const Link = BaseLink.extend({
  inclusive: () => false,
});
