// Which URI schemes may become a link in the editor.
//
// Two allowlists sit at the ends of this pipeline and they do not agree. The editor's — TipTap's
// Link extension, whose list matches the general HTML-sanitizer lineage — admits `ftp`, `ftps`,
// `tel`, `callto`, `sms` and `cid`. The public renderer's does not: `lib/render.ts` sanitizes with
// hast-util-sanitize's `defaultSchema`, whose own comment reads "Follows GitHub style sanitation",
// and its `protocols.href` allows only `http`, `https`, `irc`, `ircs`, `mailto` and `xmpp`. An href
// outside that set is not rewritten but *removed*, leaving an `<a>` with nothing behind it.
//
// So a link in one of those six looked right while writing and died silently on publish
// (docs/link-requirements.md §2.4).
//
// The gap is closed on the editor's side not because these schemes are unsafe but because this
// blog has no use for them: admitting them would mean widening the sanitizer's schema and owning a
// list that today needs no justification beyond "GitHub's". If a phone link is ever wanted, this is
// the wrong end to change.
const DIES_ON_PUBLISH = /^(?:ftp|ftps|tel|callto|sms|cid):/i;

// The link extension strips these characters from a URI before testing it, so the same ones have
// to come out here — otherwise `" tel:+81…"` walks past the test above and is then accepted by the
// default check behind it. Copied from @tiptap/extension-link rather than approximated with `\s`,
// which does not cover the C0 controls at the start of the range.
const URI_WHITESPACE = /[\0-\x20\xA0\u1680\u180E\u2000-\u2029\u205F\u3000]/g;

// Passed to the Link extension as `isAllowedUri`. `defaultValidate` is the extension's own check,
// kept in front so relative paths and fragments are accepted as before; this only subtracts.
export function isPublishableUri(url: string, defaultValidate: (url: string) => boolean): boolean {
  return defaultValidate(url) && !DIES_ON_PUBLISH.test(url.replace(URI_WHITESPACE, ''));
}
