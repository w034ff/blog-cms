import { resolveEmbed } from './embed-provider';

// Because a deck's id is not in its page URL (docs/embed-requirements.md §16.3): read the reference
// out of Speaker Deck's embed snippet (§16.9), and recognise the page URL authors paste instead
// (§16.10).
//
// **This never decides what is valid; `resolveEmbed` does.** It only finds a candidate id and
// returns nothing `resolveEmbed` refuses, so what can be stored is unchanged; only what can be pasted
// widens (§16.9). No DOM: the snippets arrive as `text/plain`, and reading a string avoids parsing
// attacker markup.

// The provider name `resolveEmbed` gives a deck; a literal, as there is no protocol constant.
const SPEAKERDECK = 'speakerdeck';

// A cheapness bound on the paste (the snippets are ~520 characters); the patterns don't backtrack.
const MAX_SNIPPET = 8192;

// **A containment gate, not the validity rule:** keeps anything but a hex run (a `/`, a `?`) out of
// the interpolated URL. `SPEAKERDECK_ID` in `resolveEmbed` is stricter and asked right after.
const CONTAINABLE_ID = /^[0-9a-f]{1,64}$/;

// "Copy iframe code". Double quotes only, as Speaker Deck writes; anything else pastes as text.
const IFRAME_SRC = /<iframe\b[^>]*\bsrc="([^"]*)"/i;
// "Copy JS code". **Its `src` is never read:** it is Speaker Deck's `embed.js`, and §6 forbids
// third-party script here; reading one attribute from a string must not become running it.
const SCRIPT_EMBED_CLASS = /<script\b[^>]*\bclass="[^"]*\bspeakerdeck-embed\b[^"]*"/i;
const SCRIPT_DATA_ID = /<script\b[^>]*\bdata-id="([^"]*)"/i;

// The canonical reference for a gated deck id, or null.
function playerHref(id: string): string | null {
  if (!CONTAINABLE_ID.test(id)) return null;
  const href = `https://speakerdeck.com/player/${id}`;
  return resolveEmbed(href)?.provider === SPEAKERDECK ? href : null;
}

// The deck a pasted snippet names, or null (the common, cheap path). The text must *begin* with a
// tag: prose that mentions a snippet is not a request for an embed.
export function speakerdeckSnippetHref(text: string): string | null {
  const snippet = text.trim();
  if (snippet.length > MAX_SNIPPET) return null;
  if (!snippet.startsWith('<iframe') && !snippet.startsWith('<script')) return null;

  const src = IFRAME_SRC.exec(snippet)?.[1];
  if (src !== undefined) {
    // **The author's own string is checked first**, or an `<iframe src>` on another host would be
    // silently retargeted to Speaker Deck.
    if (resolveEmbed(src)?.provider !== SPEAKERDECK) return null;
    // The id is the path's last segment; rebuilt so no query or slash rides along.
    let path: string;
    try {
      path = new URL(src).pathname;
    } catch {
      return null;
    }
    return playerHref(path.replace(/\/$/, '').split('/').pop() ?? '');
  }

  if (!SCRIPT_EMBED_CLASS.test(snippet)) return null;
  const id = SCRIPT_DATA_ID.exec(snippet)?.[1];
  return id === undefined ? null : playerHref(id);
}

// `/<user>/<slug>`, the deck page 「Copy link」 hands over; two segments, so user and front pages
// don't match.
const DECK_PAGE = /^\/[^/]+\/[^/]+\/?$/;

// A Speaker Deck URL that names a deck but can't be an embed (§16.10), for a line of guidance. Not
// a check on embeddability, which is `resolveEmbed`'s.
export function isSpeakerdeckDeckPage(href: string): boolean {
  let url: URL;
  try {
    url = new URL(href.trim());
  } catch {
    return false;
  }
  if (url.hostname !== 'speakerdeck.com' && url.hostname !== 'www.speakerdeck.com') return false;
  if (resolveEmbed(href) !== null) return false;
  return DECK_PAGE.test(url.pathname);
}
