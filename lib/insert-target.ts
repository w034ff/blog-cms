// What a URL becomes when it is handed to the shared insert dialog or the link card's picker
// (docs/embed-requirements.md §24, docs/link-card-requirements.md §5.2-2/§5.2-3): an embed, a link
// card, a refusal, or — when the string is not a URL at all — nothing, leaving the caller to treat
// it as a search query instead.
//
// One function rather than two copies, because this decision runs in two places
// (components/editor/link-card-extension.ts's `renderPicker`, and the shared insert dialog) and a
// URL must not resolve differently depending on which one saw it first.

import { resolveEmbed, embedRefusal, embedCardFallback } from './embed-provider';
import { normalizeCardHref, isOwnPostHref } from './link-card-href';

// One wording for every door that refuses a self-reference (§18): the picker's search results, the
// picker's URL paste, the insert dialog's URL field, and a card that already points at this post.
export const SELF_REFERENCE_NOTE = 'この記事自身は参照できません';

export type InsertTarget =
  | { kind: 'embed'; href: string }
  // A provider claimed the host, refused this shape, and named a fixable URL instead of a card
  // (Figma, Speaker Deck) — `docs/embed-requirements.md` §24.1's 「勧めない」 class. This is the one
  // outcome that stops here rather than falling through to a card: `Provider.cardFallback` is false,
  // so resolution never reaches `normalizeCardHref` below.
  | { kind: 'embed-refused'; message: string }
  | { kind: 'card'; href: string }
  | { kind: 'card-refused-self' }
  | { kind: 'none' };

// Decision order matches `renderPicker`'s URL branch exactly (link-card-extension.ts): a provider
// is asked before `normalizeCardHref`, because that function accepts every external http(s) URL and
// would answer for a YouTube link too — offering a card that publishes as a plain link, since the
// card's own preview fetch cannot read a page a provider already claims.
//
// A refusal with `cardFallback: true` (Docswell's video, CodeSandbox's devbox — 「残す」, the card
// really is the next move) falls through to the card branch below rather than stopping at
// `embed-refused`, so the caller does not have to re-run `normalizeCardHref` itself to get there.
export function resolveInsertTarget(url: string, ownSlug: string, origin: string): InsertTarget {
  const value = url.trim();
  if (value === '') return { kind: 'none' };

  if (resolveEmbed(value) !== null) return { kind: 'embed', href: value };

  const refusal = embedRefusal(value);
  if (refusal !== null && !embedCardFallback(value)) {
    return { kind: 'embed-refused', message: refusal };
  }

  const cardHref = normalizeCardHref(value, origin);
  if (cardHref !== null) {
    if (isOwnPostHref(cardHref, ownSlug)) return { kind: 'card-refused-self' };
    return { kind: 'card', href: cardHref };
  }

  return { kind: 'none' };
}
