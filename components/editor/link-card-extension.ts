import { Node, mergeAttributes, type CommandProps } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { PostSearchResult } from '@/lib/types';
import { externalCardHost, isOwnPostHref, normalizeCardHref } from '@/lib/link-card-href';
import {
  CARD_PLACEHOLDER_DARK_SRC,
  externalCardImage,
  internalCardImage,
  type CardImage,
} from '@/lib/link-card-image';
import { resolveEmbed } from '@/lib/embed-provider';
import { DEFAULT_CATEGORY } from '@/lib/content';
import {
  buildIcon,
  EXTERNAL_LINK_SHAPES,
  PENCIL_SHAPES,
  UNLINK_SHAPES,
  type IconShape,
} from './svg/icon-shapes';
import { canPlaceAfterCaret } from './code-block-extension';
import type { MarkdownSerializerState } from './markdown-serializer-state';
import { refuseChromeDrops } from './useDragContainment';

// The link card (docs/link-card-requirements.md): a block that shows a post, or an external page,
// as a card rather than as a line of link text.
//
// What is stored is a reference and nothing the reader sees:
//
//   <div class="link-card" data-href="/posts/f377f7a9a768a5b4d6f2"></div>
//   <div class="link-card" data-href="https://example.com/article"></div>
//
// Empty on purpose (§4.2). The title, date and description are derived from the `posts` row at
// render time — baking them in would leave a renamed post's old title sitting in every body that
// linked to it. An external card's lines are derived too, from the `link_previews` row the editor
// filled (§14.3); what differs is only which table answers.
//
// Storing a reference is also the one place this differs from the accordion, whose serializer
// writes its `<summary>` text into the markdown: an accordion's content is the author's, a card's
// belongs to another record.
//
// Raw HTML rather than a `@[card](url)` syntax because a node-written form has to survive the same
// round trip an author's typing does, and text serialization escapes `[` unconditionally — the
// same mechanism that turns a hand-typed `[電話](tel:…)` into `\[電話\]` (§4.1 (b)). markdown-it is
// configured with `html: true` (PostEditor.tsx) and the public pipeline already runs rehype-raw,
// so this passes both ways with no new parser. `accent-emphasis-extension.ts` round-trips through
// raw HTML for the same reason.

// HTML attribute escaping, not markdown escaping. The serializer writes this line as raw HTML, so
// it is markdown-it that parses it back — and an unescaped `"` would end the attribute early,
// taking the rest of the reference with it. `&` first, or it would double-escape the entities the
// later replacements introduce.
function escapeHref(href: string): string {
  return href.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function serializeLinkCard(state: MarkdownSerializerState, node: PMNode): void {
  const href = typeof node.attrs.href === 'string' ? node.attrs.href : '';
  state.write(`<div class="link-card" data-href="${escapeHref(href)}"></div>`);
  // Closes the block for the same reason serializeImage does: without it, whatever follows is
  // emitted onto this line, and a `>` or a fence there would reach the public pipeline glued to
  // the card's div.
  state.closeBlock(node);
}

// Storage rather than an option, and the difference is the whole of §18's wiring: options are
// fixed when the extension list is built, and `useEditor` keeps the list from the first render —
// which is before a brand-new post has a row, and therefore before it has a slug at all. Storage is
// the one piece of an extension the host may write later (`editor.storage.linkCard`, kept live by
// ExtensionManager), and the card only needs the answer at the moment it draws itself.
export type LinkCardStorage = {
  // The post open in the editor, '' when it has none yet. What a card refuses to point at.
  ownSlug: string;
  // tiptap-markdown's hooks, which is what storage on this node was for until now.
  markdown: {
    serialize: (state: MarkdownSerializerState, node: PMNode) => void;
    parse: Record<string, never>;
  };
};

export const LinkCard = Node.create<Record<string, never>, LinkCardStorage>({
  name: 'linkCard',
  group: 'block',
  // A leaf the caret cannot enter. §7-1 hangs on this: with no position inside the card,
  // `isActive('link')` never turns true there and the link bubble stays away without needing a
  // rule of its own. It is also what lets the whole card be one drag target.
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      href: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-href') ?? '',
        renderHTML: (attributes) => ({ 'data-href': attributes.href }),
      },
    };
  },

  // Matches what the serializer writes, and therefore also what an author can paste as raw HTML.
  // The reference is NOT validated here: an editor-side check would only cover this one door, and
  // the published side has to answer for hand-written HTML anyway — so validation lives in one
  // place, at resolution time (lib/rehype-link-card.ts, §4.4). An unusable reference round-trips
  // intact and simply renders as a plain link when published.
  parseHTML() {
    return [{ tag: 'div.link-card' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'link-card' })];
  },

  addStorage(): LinkCardStorage {
    return {
      // Starts as "there is no such post", the way the callout's onBlocked starts as a no-op: an
      // extension mounted on its own, and a post that has no row yet, both want §18's question to
      // simply not fire. PostEditor writes the real answer in as soon as there is one.
      ownSlug: '',
      markdown: {
        serialize: serializeLinkCard,
        // Parsing is markdown-it's raw-HTML passthrough plus parseHTML above, the same route
        // accent emphasis takes. No `updateDOM` hook: the stored form already is the DOM shape
        // this node parses, so nothing has to be reshaped on the way in.
        parse: {},
      },
    };
  },

  addCommands() {
    return {
      // Insert. `href` is optional because the slash menu inserts an unresolved card and the
      // author picks the post inside it (§5.2-3) — the NodeView shows a search box until then.
      //
      // canPlaceAfterCaret (code-block-extension.ts) is the whole placement rule, and it is what
      // `available` in the slash menu asks via `can()`. A cell (`paragraph+`) and an accordion
      // title (`text*`) refuse; a list item accepts from its second child on.
      setLinkCard:
        (href = '') =>
        ({ chain, state }: CommandProps): boolean => {
          if (!canPlaceAfterCaret(state, this.type)) return false;
          const { $from } = state.selection;
          const at = $from.after($from.depth);
          // Placed after the caret's whole textblock rather than at the selection, so a caret in
          // mid-sentence doesn't split the line — the same reasoning insertCodeBlock uses.
          return chain()
            .insertContentAt(at, { type: this.name, attrs: { href } })
            .setNodeSelection(at)
            .run();
        },

      // §7-3: undo the card without losing the reference. Without this, a card is a one-way door —
      // the caret can't enter an atom, so there is nothing to select and retype.
      //
      // The link text is the resolved title where one is known and the path otherwise, so the
      // sentence the author gets back reads like something they would have written. The `link`
      // mark carries the same href, which is why this is the exact inverse of what §5.2 builds.
      // `at` is passed by the NodeView, which knows its own position; it falls back to the
      // selection so a card picked up by the block drag handle (a NodeSelection) can be dissolved
      // too. The fallback alone is not enough: clicking a button inside the card does not move the
      // selection, so the command asked about wherever the caret happened to be and quietly
      // refused (measured — it took the 4b spec red).
      unsetLinkCard:
        (at?: number) =>
        ({ chain, state }: CommandProps): boolean => {
          const from = at ?? state.selection.from;
          const node = state.doc.nodeAt(from);
          if (node?.type !== this.type) return false;
          const href = typeof node.attrs.href === 'string' ? node.attrs.href : '';
          if (!href) {
            // An unresolved card has no reference to keep: remove it rather than leaving an
            // empty link behind.
            return chain()
              .deleteRange({ from, to: from + node.nodeSize })
              .run();
          }
          const label = cardCache.get(href)?.title ?? href;
          return chain()
            .insertContentAt(
              { from, to: from + node.nodeSize },
              {
                type: 'paragraph',
                content: [
                  { type: 'text', marks: [{ type: 'link', attrs: { href } }], text: label },
                ],
              },
            )
            .run();
        },
      // §14.6-2: turn the link the caret is in into a card, which is the second of the two
      // entry points and the only one that starts from something already written.
      //
      // **Only when the link is the whole line.** A card occupies a block (§5.2-1), so making one
      // out of a link inside a sentence would have to either take the sentence's words away or
      // leave a copy of them behind. The range is passed in by the bubble, which resolved the mark
      // to draw itself, and this refuses unless it covers the textblock exactly — the same shape
      // §4.1 (d) described when it considered promoting a line-alone link at the parser instead.
      //
      // The whole textblock is replaced rather than emptied and followed by a card: an empty
      // paragraph left above the card is invisible in markdown (it does not serialize) but real in
      // the editor, which is the mismatch accordion-requirements.md §8.2 names.
      linkToCard:
        (range: { from: number; to: number }, href: string) =>
        ({ chain, state }: CommandProps): boolean => {
          const $from = state.doc.resolve(range.from);
          if (!$from.parent.isTextblock || $from.depth < 1) return false;
          if (range.from !== $from.start() || range.to !== $from.end()) return false;
          // The placement question, asked about the link's own textblock rather than about the
          // selection. **`canPlaceAfterCaret` is the wrong question here** and was used at first:
          // it answers "may a block go *after* the caret's textblock", refuses a range outright
          // (which is what the selection is right after 適用 — reported 2026-08-18), and would
          // allow the first paragraph of a list item to be replaced, leaving the item headless.
          // What this command does is replace one textblock with a card, so that is what is asked.
          const parent = $from.node($from.depth - 1);
          const index = $from.index($from.depth - 1);
          if (!parent.canReplaceWith(index, index + 1, this.type)) return false;
          // **This button is the author saying "ask again"** (§14.3.2). The remembered face is
          // dropped along with the remembered failure: a cache hit skips `lookupCard` entirely, so
          // leaving it would answer an explicit refresh without asking anyone anything.
          cardCache.delete(href);
          forceRefresh.add(href);
          return chain()
            .insertContentAt(
              { from: $from.before($from.depth), to: $from.after($from.depth) },
              { type: this.name, attrs: { href } },
            )
            .run();
        },
    };
  },

  // The card as the author sees it (§7): a real card, not a placeholder, because a WYSIWYG editor
  // that shows every block but this one has stopped being one — the same argument
  // docs/link-requirements.md §3 makes against `autolink: false`.
  //
  // A plain-DOM NodeView, matching the callout and the code block. There is no contentDOM: the node
  // is an atom, so nothing inside it is document content and everything here is chrome.
  addNodeView() {
    return ({ node, editor, getPos }) => {
      // Read on every draw rather than captured here: a brand-new post gains its slug from the
      // first autosave, and this NodeView may well have been built before that answer came back.
      // `this.storage` is the editor's own object, not a copy — ExtensionManager hands the live one
      // to every context it builds — so what PostEditor writes is what this reads.
      const ownSlug = () => this.storage.ownSlug;
      const dom = document.createElement('div');
      dom.className = 'link-card link-card-view';
      // Nothing in here is editable text. Without this ProseMirror would let the caret into the
      // chrome and try to read the fetched title back as document content.
      dom.setAttribute('contenteditable', 'false');

      const body = document.createElement('div');
      body.className = 'link-card-body';
      dom.appendChild(body);

      // The target's image, in the same place the published card puts it: a fixed box to the right
      // of the text column (§13). It is a sibling of `body` rather than a child, so the picker's
      // list and the card's lines can be rebuilt without disturbing it — which also means
      // `body.replaceChildren()` does not take it down and `render` has to.
      const image = document.createElement('img');
      // Decorative, for the published card's reason: the title it belongs to is right beside it.
      image.alt = '';
      // The wrapper the house mark needs and a real picture does not (§17.3): a file per colour
      // scheme, chosen by the page. Built once and used only while the mark is showing — the
      // `<img>` moves in and out of it, so there is one image element either way and the layout
      // rules, which key on `.link-card-image`, never see the difference.
      const picture = document.createElement('picture');
      const darkSource = document.createElement('source');
      darkSource.media = '(prefers-color-scheme: dark)';
      darkSource.srcset = CARD_PLACEHOLDER_DARK_SRC;
      const setImage = (drawn: CardImage | null) => {
        if (drawn === null) {
          picture.remove();
          image.remove();
          return;
        }
        // Both classes are set on every draw, never toggled from the last one: the same `<img>` is
        // reused across lookups, so a card that resolved to the house mark and is then pointed at
        // a post with a real picture would otherwise keep painting it on the tint (§17).
        image.className = drawn.placeholder
          ? 'link-card-image link-card-placeholder'
          : 'link-card-image';
        image.src = drawn.src;
        if (drawn.placeholder) {
          picture.append(darkSource, image);
          dom.appendChild(picture);
        } else {
          // `appendChild` moves the image out of the wrapper, which is what leaves the previous
          // card's `<source>` behind rather than letting it decide this card's picture.
          picture.remove();
          dom.appendChild(image);
        }
      };

      const currentHref = (n: PMNode) => (typeof n.attrs.href === 'string' ? n.attrs.href : '');

      // Deferred by a frame so the DOM under the pointer is not rebuilt while the browser is still
      // dispatching the click that hit it: without this, `update` → `render` → `replaceChildren`
      // runs synchronously inside the result row's own handler.
      //
      // **This is not what fixes the double click** — the fixed head band in globals.css is, and
      // it is sufficient on its own. Measured both ways: with the band reverted and this deferral
      // kept, a second click 250ms later still destroys the card; with the band in place and this
      // deferral removed, it does not. A frame is ~16ms and a second click is ~150-300ms, so this
      // can only ever cover a synthetic gesture — which it does, and that is the trap it leaves
      // behind: `dblclick()` in a spec fires both clicks inside one frame, so a regression spec
      // written that way passes on this line alone while the geometry is broken. The spec spaces
      // its clicks for that reason.
      //
      // `getPos()` is read inside the callback rather than captured: a frame is long enough for
      // the document to have changed, and the NodeView may be gone entirely.
      const setHref = (href: string) => {
        requestAnimationFrame(() => {
          const pos = getPos();
          if (typeof pos !== 'number') return;
          editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, 'href', href));
        });
      };

      // The picker's second answer (docs/embed-requirements.md §5-1): a URL a provider claims
      // replaces this card with an embed outright, so one paste makes one block rather than a card
      // the author then has to undo. Deferred by a frame for setHref's reason, and more so — this
      // one destroys the NodeView whose button is still dispatching the click.
      const toEmbed = (href: string) => {
        requestAnimationFrame(() => {
          const pos = getPos();
          if (typeof pos !== 'number') return;
          editor.commands.nodeToEmbed(pos, href);
        });
      };

      const render = (n: PMNode) => {
        body.replaceChildren();
        // Both states start without one: the picker never has an image, and a resolved card puts
        // it back only once the lookup says the target has one.
        setImage(null);
        const href = currentHref(n);
        if (!href) renderPicker(body, editor, setHref, toEmbed, ownSlug());
        else
          renderCard(
            body,
            href,
            editor,
            () => setHref(''),
            () => getPos(),
            setImage,
            ownSlug(),
          );
      };
      render(node);

      // What `stopEvent` below claims — stated once, because the drop refusal has to refuse exactly
      // what the claim takes out of ProseMirror's reach and no more (refuseChromeDrops).
      const claimsEvent = (target: HTMLElement) => target.closest('input, button') !== null;
      // The picker's search box is a natively droppable text control, so a drop there was Chrome's
      // to run: measured, dragging 前の段落 onto it left doc(paragraph("です"), linkCard, …) with the
      // words in the box — the document's text destroyed by a move ProseMirror never authorized.
      refuseChromeDrops(dom, claimsEvent, () => editor.view);

      return {
        dom,
        update: (updated: PMNode) => {
          if (updated.type !== this.type) return false;
          render(updated);
          return true;
        },
        // Everything in here is chrome the NodeView owns and rewrites; none of it is document
        // content, so ProseMirror must never try to read a mutation back into the document.
        ignoreMutation: () => true,
        // Keeps ProseMirror's handlers off the search box and the buttons — without this a
        // keystroke in the input is treated as a keystroke in the document, and typing a query
        // edits the post instead.
        //
        // Narrowed to the controls themselves rather than to the whole card, and that distinction
        // is load-bearing: claiming every event inside `dom` also swallowed the mousedown that
        // makes a NodeSelection, so clicking a card selected nothing and §7-1's "the caret cannot
        // enter, so the bubble stays away" had no visible selection to stand on (measured — it
        // took the 4a spec red). A click on the card's own background is a click on a block, and
        // belongs to the editor.
        stopEvent: (event: Event) => {
          const target = event.target;
          return target instanceof HTMLElement && claimsEvent(target);
        },
      };
    };
  },
});

// The lines a resolved card draws, whichever kind of target answered. Both lookups below build
// one of these, so `draw` is a single function that cannot treat the two kinds differently by
// accident — the failure §13 records (a cached card taking the "not looked up yet" branch of every
// line) was exactly a second drawing path getting out of step with the first.
type CardFace = {
  title: string;
  // The second line, and '' when there is nothing wrong to say (§13.1).
  note: string;
  // The provenance line, and null on an internal card, whose target is this same blog (§14.4).
  domain: string | null;
  // Null only on an external target with no og:image: an internal card always has a picture, the
  // site's own mark when the post has none (§17).
  image: CardImage | null;
};

// Lookups already made, keyed by href. A card holds only a reference (§4.2), so every NodeView
// built for one would otherwise be a round trip — and the same card is built again whenever the
// node is replaced rather than updated: re-parsing the document, undoing a delete, picking the same
// post back in the picker. (An edit elsewhere in the document is not one of those — ProseMirror
// leaves an untouched node's view alone, measured 2026-08-18.) Scoped to the page: a reload picks
// up a renamed post, and the published page resolves independently (§6), so a stale entry here can
// never reach a reader.
//
// The whole answer is kept, not just the title. With a title-only cache the second card drew less
// than the first: the fetch is skipped once the entry exists, so everything derived from the rest
// of the answer — the draft note, and now the image — was missing from every build after the one
// that fetched (§13).
const cardCache = new Map<string, CardFace>();

// References whose next lookup must ask the page again instead of believing a remembered failure
// (docs/link-card-requirements.md §14.3.2). Written only by `linkToCard` — the author's explicit
// 「カードにする」 — and consumed by the first `lookupCard` that draws that reference.
//
// Module state next to `cardCache` rather than a field on `LinkCardStorage`: storage exists for the
// one thing the *host* writes after the extension list is built (`ownSlug`), and this is set and
// consumed inside this file. Keyed by reference, so two cards pointing at the same URL share the
// one refresh — which is what the author asked for, since the row they are refreshing is shared too.
const forceRefresh = new Set<string>();

// One wording for all four doors (§18). The author is told the same thing whether they are picking
// a post, pasting their own URL, or looking at a card that already points at this article.
const SELF_NOTE = 'この記事自身は参照できません';

// The other half of §14.3.2: the failure is remembered, and this is the gesture that forgets it.
// Both buttons it names are on this card already — 「リンクに戻す」 here, 「カードにする」 in the
// link bubble the reference falls back into — so it describes what the author can see, not a
// control they have to find.
const RETRY_NOTE = 'タイトルを取得できませんでした（リンクに戻してカードにし直すと再取得します）';

// What is known about a card's target. Three states rather than a nullable answer, because "the
// answer has not come back yet" and "the route says there is nothing there" are the same `null` in
// the data and must not be the same card on screen (§13.1): the second says so in the card's own
// second line, and a card that said it for the ~10ms before its own answer arrives would call every
// reference broken every time the document is opened. A failed request is `unknown` too — a lapsed
// session is not a missing post, and the card has nothing to report about it.
//
// `missing` carries its own words because the two kinds fail differently and the author acts on
// them differently: a reference naming no post is fixed by pointing the card somewhere else, an
// external page that would not answer is often fixed by nothing at all (§14.7).
type Lookup =
  | { status: 'unknown' }
  | { status: 'found'; card: CardFace }
  | { status: 'missing'; note: string };

// Which table answers is decided by the reference itself, the same way the published side decides
// it (app/posts/[slug]/page.tsx), and there is exactly one shape that is not internal.
//
// The stored href is put through the same rewrite the two entry points apply (§14.5.1), because
// this is the third door and it is open on purpose: `parseHTML` accepts any `data-href`, so a body
// can arrive carrying `https://<this blog>/posts/<slug>` — hand-written, or pasted as raw HTML.
// Without the rewrite that card asks the preview route about this server's own address, is refused
// there, and reports that the author's own post could not be read.
function lookupCard(href: string, ownSlug: string): Promise<Lookup> {
  const reference = normalizeCardHref(href, window.location.origin) ?? href;
  // Consumed here, once, whatever the lookup then decides — **including when the page fails
  // again**. Leaving it set would put the next ordinary render back on the network, which is the
  // automatic path `FAIL_TTL_MS` exists to keep off it. Read before the branches below so a
  // self-reference or an internal post cannot swallow it on the external card's behalf.
  const force = forceRefresh.delete(href);
  // The fourth door, and the only one that answers for a card that already exists (§18): a body
  // carrying a self-reference — written before this rule, hand-edited, or pasted as raw HTML —
  // reaches the editor as an ordinary card and would otherwise resolve to the post the author is
  // looking at. `missing` rather than `found` with a note, because only `found` is written to
  // `cardCache`, and a reference nobody may point at has no business being cached as a face.
  if (isOwnPostHref(reference, ownSlug)) {
    return Promise.resolve({ status: 'missing', note: SELF_NOTE });
  }
  return externalCardHost(reference) === null
    ? fetchPost(reference)
    : fetchPreview(reference, force);
}

async function fetchPost(href: string): Promise<Lookup> {
  const slug = href.startsWith('/posts/') ? href.slice('/posts/'.length) : '';
  // A reference that cannot name a post at all. The published side refuses the same shapes (§4.4),
  // so this is the editor saying the same thing while it can still be fixed.
  if (!slug) return { status: 'missing', note: '記事が見つかりません' };
  try {
    const res = await fetch(`/api/posts/search?slug=${encodeURIComponent(slug)}`);
    if (res.status === 404) return { status: 'missing', note: '記事が見つかりません' };
    if (!res.ok) return { status: 'unknown' };
    const post = (await res.json()) as PostSearchResult;
    return {
      status: 'found',
      card: {
        title: post.title,
        // A draft resolves to nothing on the published page and the card falls back to a plain
        // link there (§5.2-4, §6.1), which is only fixable from here.
        note: post.draft ? '未公開の記事' : '',
        domain: null,
        // The route answers with `resolveThumbnail`'s value and this side turns a null into the
        // house mark — the same function the published card's resolver calls, so the two cannot
        // decide differently what a post with no picture looks like (§17).
        image: internalCardImage(post.thumbnail),
      },
    };
  } catch {
    // Offline, or the session lapsed. The card keeps its reference either way — this only decides
    // what the editor draws, and §5.3's degradation is to show the path.
    return { status: 'unknown' };
  }
}

// The external half (§14.5). The route decides whether this costs a SELECT or a fetch; the editor
// only ever asks it, and asks it again on every render, which is what keeps the stored row warm
// without a refresh button anyone has to remember to press (§14.3).
async function fetchPreview(href: string, force: boolean): Promise<Lookup> {
  const host = externalCardHost(href);
  if (host === null) return { status: 'missing', note: 'タイトルを取得できませんでした' };
  try {
    const res = await fetch(
      `/api/link-preview?url=${encodeURIComponent(href)}${force ? '&force=1' : ''}`,
    );
    if (!res.ok) return { status: 'unknown' };
    const { preview } = (await res.json()) as {
      preview: { title: string; image: string } | null;
    };
    // The page answered nothing readable — a Cloudflare challenge, a timeout, a host that is
    // this server itself (§14.5.1). The card keeps its reference and shows the URL instead.
    // The way back, named in the card itself: the row remembers this failure for 30 minutes
    // (`FAIL_TTL_MS`), so an author who has just fixed the other side — a sharing setting, most
    // often — would otherwise be told the same thing by a card that never asked again (§14.3.2).
    if (!preview) return { status: 'missing', note: RETRY_NOTE };
    // The description is not drawn here. The NodeView has never shown one — §13 added the image,
    // not the description — and this card inherits that rather than introducing a second answer to
    // "what does the editor show" (§14.7).
    //
    // The image is already the signed /api/link-image path when it arrives: the route signs it, so
    // the editor and the published page put the identical `<img src>` on screen and the third
    // party's own URL never reaches this browser.
    return {
      status: 'found',
      card: {
        title: preview.title,
        note: '',
        domain: host,
        image: externalCardImage(preview.image || null),
      },
    };
  } catch {
    return { status: 'unknown' };
  }
}

// The band both states put their controls in, and the reason the card's buttons cannot be hit by a
// second click meant for the picker.
//
// The two states are different heights — a resolved card is three lines, the picker is a search box
// plus a list — so anything bottom-anchored moves *up* into the band the result rows occupied when
// the card resolves. That is exactly what happened: 「変更」 and 「リンクに戻す」 rendered within
// 3px of where the first result row had been, so a double-click on a row cleared or dissolved the
// card the first click had just made (recovered from the WAL, then reproduced — a card the author
// believed they had left behind was a plain text link by the time it reached the public page).
//
// So the controls are top-anchored instead, in a band of fixed height that holds the search box in
// one state and the buttons in the other. The picker's only clickable rows live below this band,
// and a stray click inside it lands on the search input, which does nothing to the document.
function head(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'link-card-head';
  return el;
}

// The resolved card: the target's title and image, a line only when there is something wrong to say
// about it, and — on an external card — the host it points at (§14.4). `onClear` puts the card back
// into its picker state so the author can point it somewhere else without deleting it.
function renderCard(
  body: HTMLElement,
  href: string,
  editor: { commands: { unsetLinkCard: (at?: number) => boolean } },
  onClear: () => void,
  pos: () => number | undefined,
  setImage: (picture: CardImage | null) => void,
  ownSlug: string,
): void {
  const actions = head();
  actions.append(
    // The card's own repayment of a debt (§7.4). `openOnClick: false` took opening a link away from
    // inside the editor (docs/link-requirements.md §3) and the bubble gave it back to text links
    // (§5.5); a card had no way at all — 「変更」 opens an empty picker and 「リンクに戻す」 destroys
    // the card to get at the link underneath it.
    //
    // A control rather than a click on the title or the picture: the card is an atom, so a click on
    // its body is how the author selects it to delete or drag, and the picture is a large target to
    // lose to a navigation nobody meant. Same call the bubble's href line makes (LinkBubble.tsx),
    // including the new tab, which is what the published card does now too
    // (docs/link-requirements.md §7.2).
    button('開く', () => window.open(href, '_blank', 'noopener,noreferrer'), {
      icon: EXTERNAL_LINK_SHAPES,
    }),
    button('変更', onClear, { icon: PENCIL_SHAPES }),
    button('リンクに戻す', () => editor.commands.unsetLinkCard(pos()), {
      icon: UNLINK_SHAPES,
      danger: true,
    }),
  );

  const title = document.createElement('span');
  title.className = 'link-card-title';
  const meta = document.createElement('span');
  meta.className = 'link-card-meta';
  const domain = document.createElement('span');
  domain.className = 'link-card-domain';
  body.append(actions, title);

  // The lines below the title are put up and taken down rather than emptied: a card whose target is
  // fine has no second line at all (§13.1), and an empty span still carries the line's top margin.
  //
  // Both are detached first and appended in order, so the two cannot arrive in the order they
  // happened to be set — the note is written by the answer and the host by the reference, which do
  // not become known at the same moment.
  const setLines = (note: string, host: string | null) => {
    meta.remove();
    domain.remove();
    if (note !== '') {
      meta.textContent = note;
      body.appendChild(meta);
    }
    if (host !== null) {
      domain.textContent = host;
      body.appendChild(domain);
    }
  };

  // Everything the lookup decides, in one place, so the cache hit and the answer that has just
  // arrived draw the same card. Splitting them is what let the two disagree (§13): a card drawn
  // from the cache took the "not looked up yet" branch of each line and kept it forever.
  const draw = (lookup: Lookup) => {
    // The reference is what §5.3 degrades to: until the title is known, what the card names is what
    // the author wrote, which is the thing they can act on.
    title.textContent = lookup.status === 'found' ? lookup.card.title : href;
    // The things worth interrupting for, all decided by the lookup rather than here: a draft or a
    // reference the route cannot match on one side, a page that would not answer on the other
    // (§14.7). Both are fixable only from this card.
    setLines(
      lookup.status === 'found' ? lookup.card.note : lookup.status === 'missing' ? lookup.note : '',
      lookup.status === 'found' ? lookup.card.domain : null,
    );
    setImage(lookup.status === 'found' ? lookup.card.image : null);
  };

  const cached = cardCache.get(href);
  draw(cached ? { status: 'found', card: cached } : { status: 'unknown' });
  if (!cached) {
    void lookupCard(href, ownSlug).then((lookup) => {
      if (lookup.status === 'found') cardCache.set(href, lookup.card);
      // The card this answer was for may be gone: 「変更」 detaches these spans while the lookup is
      // still in flight. Harmless while `draw` only wrote into them — they were unreachable — but
      // `setImage` reaches the NodeView's own `dom`, which by then belongs to the picker, so a late
      // answer would hang a thumbnail beside its search box. (False on the way in as well, since
      // ProseMirror inserts `dom` after the NodeView is built; only this path can be late.)
      if (!title.isConnected) return;
      draw(lookup);
    });
  }
}

// The insert flow (§5.2-3): search your own posts and pick one — or paste a URL, which is the
// first of the two entry points an external card has (§14.6-1). It lives in the card rather than in
// a popup of its own so the slash menu needs no second UI framework, and so an author who inserts
// and then wanders off is left with a visible unfinished card instead of a silent no-op.
//
// One field answers both because the two are told apart by what was typed, not by a mode the author
// has to choose: anything that parses as an http(s) URL is a reference, everything else is a search
// for a title. `normalizeCardHref` also rewrites a URL pointing at this blog's own post into the
// internal reference, so pasting the published address of your own article makes the card that
// reads `posts` live rather than a stored snapshot of it (§14.5.1).
function renderPicker(
  body: HTMLElement,
  editor: { view: { dom: HTMLElement } },
  onPick: (href: string) => void,
  onEmbed: (href: string) => void,
  ownSlug: string,
): void {
  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'link-card-search';
  input.placeholder = '記事のタイトルで検索、または URL を貼り付け…';
  // Same band the resolved card puts its buttons in — see head().
  const controls = head();
  controls.appendChild(input);
  const list = document.createElement('ul');
  list.className = 'link-card-results';
  body.append(controls, list);

  const show = (results: PostSearchResult[]) => {
    list.replaceChildren();
    // The article being written is not among the candidates (§18): a list of things to pick has no
    // business holding a row that cannot be picked.
    const offered = results.filter((post) => !isOwnPostHref(`/posts/${post.slug}`, ownSlug));
    if (offered.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'link-card-empty';
      // The one place dropping the row would say something untrue: the query matched this post and
      // nothing else, so 「一致する記事がありません」 would deny an article the author can see the
      // title of. Where other candidates remain, the quiet removal needs no explanation — there is
      // something to pick, and the missing row is the article they are looking at.
      empty.textContent = offered.length < results.length ? SELF_NOTE : '一致する記事がありません';
      list.appendChild(empty);
      return;
    }
    for (const post of offered) {
      const row = document.createElement('li');
      row.appendChild(resultRow(post, () => onPick(`/posts/${post.slug}`)));
      list.appendChild(row);
    }
  };

  let latest = 0;

  // The one row a URL produces, whichever block it is going to become. `latest` is bumped here
  // too: a search sent before the author finished pasting must not land on top of this row when its
  // answer arrives.
  const showReference = (label: string, apply: () => void) => {
    latest += 1;
    list.replaceChildren();
    const row = document.createElement('li');
    row.appendChild(button(label, apply));
    list.appendChild(row);
  };
  // A URL that names something, and the reason it cannot become a block. Same `latest` bump as
  // showReference: an in-flight search must not land on top of this line either.
  const showRefusal = (note: string) => {
    latest += 1;
    list.replaceChildren();
    const row = document.createElement('li');
    row.className = 'link-card-empty';
    row.textContent = note;
    list.appendChild(row);
  };

  const search = async (query: string) => {
    const ticket = (latest += 1);
    try {
      const res = await fetch(`/api/posts/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) return;
      const results = (await res.json()) as PostSearchResult[];
      // Answers can arrive out of order, and a stale one would replace the list the author is
      // looking at with results for a prefix they've already typed past.
      if (ticket === latest) show(results);
    } catch {
      // Same as the card's lookup: nothing to draw, and the card keeps its state.
    }
  };

  input.addEventListener('input', () => {
    const value = input.value.trim();
    // A URL a provider claims is an embed, not a card (docs/embed-requirements.md §5-1), and it is
    // asked first for the bubble's reason: `normalizeCardHref` accepts every external http(s) URL,
    // so it would answer for a YouTube link too and offer a card that publishes as a plain link.
    if (resolveEmbed(value) !== null) {
      showReference('この URL を埋め込みにする', () => onEmbed(value));
      return;
    }
    const cardHref = normalizeCardHref(input.value, window.location.origin);
    // This blog's own published address for this very post, which §14.5.1 has already rewritten
    // into the internal reference by the time it gets here (§18). Refused with a line rather than
    // with an unresponsive row: an offer that does nothing is worse than no offer.
    if (cardHref !== null && isOwnPostHref(cardHref, ownSlug)) showRefusal(SELF_NOTE);
    else if (cardHref !== null) showReference('この URL をカードにする', () => onPick(cardHref));
    else void search(input.value);
  });
  // Escape hands focus back to the document rather than closing anything — there is nothing to
  // close, and leaving focus in the box means the next keystroke is still swallowed by stopEvent.
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') editor.view.dom.focus();
  });
  void search('');
  // Deferred: the NodeView's DOM is not in the document yet when this runs, and focus() on a
  // detached element does nothing.
  requestAnimationFrame(() => input.focus());
}

// One row of the insert search (§5.2-5): the post's picture, its title, and the category it sits
// in. It was a line of plain text until 2026-09-01 — the same data the card itself has drawn since
// §13 was fetched for every row and then thrown away, so the author picked from a list of titles
// and only saw the picture after committing to one.
//
// **The picture is `internalCardImage`, not `post.thumbnail`.** Every row here points at one of
// this blog's own posts, so every row has a picture — the house mark stands in for a post with
// none (§17). That matters more in a list than on a single card: a row with an empty frame reads
// as a broken image next to rows that have one, and the frame is what makes the titles line up.
//
// **The accessible name is set explicitly and stays what it was.** A row now draws three things,
// so its name would otherwise become "title 未公開 category" — and `e2e/editor-link-card.spec.ts`
// asks for these rows by `getByRole('button', { name: CARD_TITLE })`, which is a full-string match.
// The label is the title (plus the draft note, which is the one thing here a reader must not miss);
// the category is supplementary and the picture is decorative, so neither joins it.
function resultRow(post: PostSearchResult, onPick: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  // Not a submit button, for `button()`'s reason: PostEditor wraps the editor in one <form>.
  el.type = 'button';
  el.className = 'link-card-result';
  el.setAttribute('aria-label', post.draft ? `${post.title}（未公開）` : post.title);

  const text = document.createElement('span');
  text.className = 'link-card-result-text';
  const head = document.createElement('span');
  head.className = 'link-card-result-head';
  const title = document.createElement('span');
  title.className = 'link-card-result-title';
  title.textContent = post.title;
  head.appendChild(title);
  // 未公開 was appended to the title as 「（未公開）」 until this row grew a second line. A badge
  // rather than more title text: what it says is a property of the post, not part of its name, and
  // inside the title it was the first thing an ellipsis ate.
  if (post.draft) {
    const badge = document.createElement('span');
    badge.className = 'link-card-result-badge';
    badge.textContent = '未公開';
    // Already in the button's own label above, so a screen reader would otherwise hear it twice.
    badge.setAttribute('aria-hidden', 'true');
    head.appendChild(badge);
  }
  text.appendChild(head);
  // Dropped when it is the blank field's sentinel: `DEFAULT_CATEGORY` is what a post with no
  // category has, so printing it would put "uncategorized" under most of the list and say nothing.
  if (post.category !== DEFAULT_CATEGORY) {
    const category = document.createElement('span');
    category.className = 'link-card-result-category';
    category.textContent = post.category;
    text.appendChild(category);
  }

  el.append(resultImage(internalCardImage(post.thumbnail)), text);
  el.addEventListener('click', onPick);
  return el;
}

// The row's picture. Same `<picture>` mechanism the card's own image uses (§17.3) and for the same
// reason — the house mark is the site's name in the foreground colour, so the wrong file is
// invisible rather than merely off — but built per row rather than reused: rows are thrown away and
// rebuilt on every keystroke, so there is no previous state for a stale `<source>` to leak from.
function resultImage(drawn: CardImage): HTMLElement {
  const image = document.createElement('img');
  // Decorative: the title it belongs to is on the same row, and the button is named above.
  image.alt = '';
  image.className = drawn.placeholder
    ? 'link-card-result-image link-card-result-placeholder'
    : 'link-card-result-image';
  image.src = drawn.src;
  if (!drawn.placeholder) return image;
  const picture = document.createElement('picture');
  const darkSource = document.createElement('source');
  darkSource.media = '(prefers-color-scheme: dark)';
  darkSource.srcset = CARD_PLACEHOLDER_DARK_SRC;
  picture.append(darkSource, image);
  return picture;
}

// `icon` is what makes a band control; the picker's result rows pass none and stay plain text.
//
// **A control carries its icon AND its label at every width.** Which of the two is visible is the
// stylesheet's business (`app/globals.css`: the label below 30rem, the icon above it), and it is
// visually-hidden rather than `display: none` on purpose — the label is the button's accessible
// name, so removing it from the tree at narrow widths would leave three unnamed buttons for a
// screen reader and take every `getByRole('button', { name: … })` in the specs with it (§7.4).
//
// `danger` tints the control instead of filling it. That is how this editor already says
// "destructive" — the bubble's 解除 and the toolbar's テーブルを削除 both wear the same red text
// (`ToolbarButton`'s `destructive`), and a fill would read as a weight the rest of the chrome does
// not carry.
function button(
  label: string,
  onClick: () => void,
  options: { icon?: readonly IconShape[]; danger?: boolean } = {},
): HTMLButtonElement {
  const el = document.createElement('button');
  // Not a submit button: PostEditor wraps the whole editor in one <form>, so a default-type
  // button inside it submits the post (see the toolbar's dialogs, which hit this).
  el.type = 'button';
  if (options.icon) {
    const text = document.createElement('span');
    text.className = 'link-card-action-label';
    text.textContent = label;
    el.append(buildIcon(options.icon), text);
    if (options.danger) el.classList.add('link-card-action-danger');
  } else {
    el.textContent = label;
  }
  el.addEventListener('click', onClick);
  return el;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    linkCard: {
      setLinkCard: (href?: string) => ReturnType;
      unsetLinkCard: (at?: number) => ReturnType;
      linkToCard: (range: { from: number; to: number }, href: string) => ReturnType;
    };
  }
}
