import { resolveEmbed } from './embed-provider';

// The two things that exist because a deck's id is not in the URL of its own page
// (docs/embed-requirements.md §16.3): reading the reference out of Speaker Deck's embed snippet
// (§16.9), and recognising the page URL an author reaches for instead so the editor can say what to
// copy (§16.10).
//
// Every other provider's embed is "copy the address bar, paste it"; this one was "open Share, copy
// the embed code, dig the `src` out of it by hand". The first function removes the digging, and the
// second is what tells an author holding the wrong URL which button to press.
//
// **This never decides what is valid. `resolveEmbed` does.** Everything below only *finds a
// candidate id* in a string; the returned href is then handed to `resolveEmbed`, and nothing that it
// refuses is ever returned. So the set of references the editor can store is exactly what it was
// before this file existed — what widens is the shape the author may paste, not the shape that may
// be stored (§16.9's security note).
//
// No DOM is built. The two snippets reach the clipboard as `text/plain` (Speaker Deck's buttons
// write `data-clipboard-text`, measured 2026-08-26), so the input is a string and reading it as one
// avoids the question of what an HTML parser would do with an attacker's markup.

// The provider name `resolveEmbed` gives a deck, and the only one this file may act on. A literal
// for `embedMarkShapes`' reason — the string is the provider's name in one place
// (lib/embed-provider.ts) and there is no protocol constant to borrow, as there is for X.
const SPEAKERDECK = 'speakerdeck';

// Long enough for either snippet with room to spare (the iframe form measures ~520 characters), and
// short enough that nothing below runs over an arbitrarily large paste. The patterns are all
// anchored or single-pass with no nested quantifiers, so this is a cheapness bound rather than a
// correctness one.
const MAX_SNIPPET = 8192;

// **A containment gate, not the validity rule.** Its whole job is to keep anything that is not a
// bare hex run out of the string that gets interpolated into a URL below — a `data-id` carrying a
// `/` or a `?` would otherwise build a URL that parses as a different path. What counts as a real
// deck id stays `SPEAKERDECK_ID`'s business inside `resolveEmbed`, which is stricter than this
// (`{24,32}`) and is asked immediately afterwards.
const CONTAINABLE_ID = /^[0-9a-f]{1,64}$/;

// `<iframe … src="https://speakerdeck.com/player/<id>" …>`, the "Copy iframe code" button's output.
// Double quotes only, because that is what Speaker Deck writes; a hand-retyped snippet using single
// quotes falls through to an ordinary text paste, which is the same answer every unrecognised paste
// gets.
const IFRAME_SRC = /<iframe\b[^>]*\bsrc="([^"]*)"/i;
// `<script … class="speakerdeck-embed" data-id="<id>" …>`, the "Copy JS code" button's output.
// **The `src` in that snippet is not read, and must never be.** It names Speaker Deck's own
// `embed.js`, and §6 forbids running a third party's script on this origin under any circumstances
// — this reads one attribute out of a string, which is not the same act and must not become it.
const SCRIPT_EMBED_CLASS = /<script\b[^>]*\bclass="[^"]*\bspeakerdeck-embed\b[^"]*"/i;
const SCRIPT_DATA_ID = /<script\b[^>]*\bdata-id="([^"]*)"/i;

// The canonical reference for a deck id, or null when `resolveEmbed` will not have it. The two
// snippet shapes both funnel through here, so there is one string that can be stored and it is
// built from a gated id rather than copied out of the author's paste.
function playerHref(id: string): string | null {
  if (!CONTAINABLE_ID.test(id)) return null;
  const href = `https://speakerdeck.com/player/${id}`;
  return resolveEmbed(href)?.provider === SPEAKERDECK ? href : null;
}

// The deck reference a pasted Speaker Deck embed snippet names, or null for anything else — which
// is every other paste in the editor, so the null path is the common one and has to be cheap.
//
// The trigger is deliberately narrow: the text must *begin* with one of the two tags. A paragraph
// that merely mentions a snippet, or a URL with an iframe quoted after it, is not an author asking
// for an embed, and turning it into one would take away text they meant to keep.
export function speakerdeckSnippetHref(text: string): string | null {
  const snippet = text.trim();
  if (snippet.length > MAX_SNIPPET) return null;
  if (!snippet.startsWith('<iframe') && !snippet.startsWith('<script')) return null;

  const src = IFRAME_SRC.exec(snippet)?.[1];
  if (src !== undefined) {
    // **The host is checked by asking `resolveEmbed` about the author's own string first.** Reading
    // the id out and rebuilding the URL without this would turn `<iframe src="https://evil.example/
    // player/<id>">` into a Speaker Deck deck — harmless to render, but a silent retarget of what
    // the author pasted, which is not this function's to do.
    if (resolveEmbed(src)?.provider !== SPEAKERDECK) return null;
    // `resolveEmbed` has already established the path is `/player/<id>`, so the last segment is the
    // id. Rebuilt rather than stored as-is so that a query string or a trailing slash in the
    // snippet cannot ride along into the document.
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

// `/<user>/<slug>` — the deck page, which is the URL the deck's own 「Copy link」 button hands over
// and the one an author reaches for first. Two segments, so a user page and the front page do not
// match.
const DECK_PAGE = /^\/[^/]+\/[^/]+\/?$/;

// Whether a reference is a Speaker Deck URL that names a deck but cannot become an embed — the one
// case in this editor where 「カードにする」 is the only button on offer and the author may well have
// wanted the other one (§16.10).
//
// **Not a check on what is embeddable.** That is `resolveEmbed`'s, and it is asked here: anything it
// accepts is already an embed and needs no advice. This only decides whether a line of guidance is
// worth showing beside a reference it refused.
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
