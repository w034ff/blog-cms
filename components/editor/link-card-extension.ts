import { Node, mergeAttributes, type CommandProps, type Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { PostSearchResult } from '@/lib/types';
import { externalCardHost, isOwnPostHref, normalizeCardHref } from '@/lib/link-card-href';
import {
  CARD_PLACEHOLDER_DARK_SRC,
  externalCardImage,
  internalCardImage,
  type CardImage,
} from '@/lib/link-card-image';
import { resolveInsertTarget, SELF_REFERENCE_NOTE } from '@/lib/insert-target';
import { categoryLabel } from '@/lib/content';
import {
  BACK_SHAPES,
  buildIcon,
  EXTERNAL_LINK_SHAPES,
  PENCIL_SHAPES,
  UNLINK_SHAPES,
  type IconShape,
} from './svg/icon-shapes';
import { canPlaceAfterCaret } from './code-block-extension';
import { focusThenRun } from './focus-then-run';
import { escapeAttribute } from './html-escape';
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
// Empty on purpose (§4.2): title, date and description are derived at render time from the `posts`
// row (or, for an external card, the `link_previews` row, §14.3), so a renamed post never leaves a
// stale title behind. Raw HTML rather than a `@[card](url)` syntax because text serialization
// escapes `[` unconditionally (§4.1 (b)); markdown-it runs with `html: true` and the public side
// with rehype-raw, as for accent emphasis.

function serializeLinkCard(state: MarkdownSerializerState, node: PMNode): void {
  const href = typeof node.attrs.href === 'string' ? node.attrs.href : '';
  state.write(`<div class="link-card" data-href="${escapeAttribute(href)}"></div>`);
  // Closes the block, or whatever follows is glued onto this line.
  state.closeBlock(node);
}

// Storage rather than an option (§18): options are fixed when the extension list is built, before
// a new post has a slug, while storage is live and the host may write it later.
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
  // A leaf the caret cannot enter, so the link bubble never appears in it (§7-1) and the whole card
  // is one drag target.
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

  // Not validated here: the published side must answer for hand-written HTML anyway, so validation
  // lives at resolution time (lib/rehype-link-card.ts, §4.4).
  parseHTML() {
    return [{ tag: 'div.link-card' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'link-card' })];
  },

  addStorage(): LinkCardStorage {
    return {
      // '' until PostEditor writes the real slug, so §18's check doesn't fire without one.
      ownSlug: '',
      markdown: {
        serialize: serializeLinkCard,
        // markdown-it's raw-HTML passthrough plus parseHTML above.
        parse: {},
      },
    };
  },

  addCommands() {
    return {
      // Insert a resolved card at the caret (docs/embed-requirements.md §24,
      // docs/link-card-requirements.md §5.2-2/§5.2-3), exactly as `setEmbed` does: an empty textblock
      // is replaced, otherwise the card goes after it. The fallback uses `canPlaceAfterCaret`
      // (code-block-extension.ts), which the slash menu asks too.
      setLinkCard:
        (href = '') =>
        ({ chain, state }: CommandProps): boolean => {
          const { $from, empty } = state.selection;
          if (
            empty &&
            $from.depth >= 1 &&
            $from.parent.isTextblock &&
            $from.parent.content.size === 0
          ) {
            const parent = $from.node($from.depth - 1);
            const index = $from.index($from.depth - 1);
            if (parent.canReplaceWith(index, index + 1, this.type)) {
              const from = $from.before($from.depth);
              return chain()
                .insertContentAt(
                  { from, to: $from.after($from.depth) },
                  { type: this.name, attrs: { href } },
                )
                .setNodeSelection(from)
                .run();
            }
          }
          if (!canPlaceAfterCaret(state, this.type)) return false;
          const at = $from.after($from.depth);
          return chain()
            .insertContentAt(at, { type: this.name, attrs: { href } })
            .setNodeSelection(at)
            .run();
        },

      // §7-3: back to a link, so the atom is not a one-way door; the exact inverse of §5.2, with the
      // resolved title (or the path) as text. `at` comes from the NodeView, since clicking its button
      // doesn't move the selection; the fallback serves a drag-handle NodeSelection.
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
      // §14.6-2: turn the link the caret is in into a card. **Only when the link is the whole line**
      // (§5.2-1). The whole textblock is replaced, not emptied, since an empty paragraph left above
      // is real in the editor but absent in markdown (accordion-requirements.md §8.2).
      linkToCard:
        (range: { from: number; to: number }, href: string) =>
        ({ chain, state }: CommandProps): boolean => {
          const $from = state.doc.resolve(range.from);
          if (!$from.parent.isTextblock || $from.depth < 1) return false;
          if (range.from !== $from.start() || range.to !== $from.end()) return false;
          // Asked of the link's own textblock. Not `canPlaceAfterCaret`, which refuses a range and
          // would let a list item's first paragraph be replaced.
          const parent = $from.node($from.depth - 1);
          const index = $from.index($from.depth - 1);
          if (!parent.canReplaceWith(index, index + 1, this.type)) return false;
          // **This button is the author saying "ask again"** (§14.3.2), so the cached face goes too.
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

  // A real card, not a placeholder (§7), as a plain-DOM NodeView with no contentDOM.
  addNodeView() {
    return ({ node, editor, getPos }) => {
      // Read on every draw: a new post gains its slug on the first autosave, and `this.storage` is the
      // live object PostEditor writes to.
      const ownSlug = () => this.storage.ownSlug;
      const dom = document.createElement('div');
      dom.className = 'link-card link-card-view';
      // Chrome, not editable text.
      dom.setAttribute('contenteditable', 'false');

      const body = document.createElement('div');
      body.className = 'link-card-body';
      dom.appendChild(body);

      // The image, right of the text column as on the published card (§13). A sibling of `body`, so
      // `body.replaceChildren()` leaves it and `render` manages it.
      const image = document.createElement('img');
      // Decorative, for the published card's reason: the title it belongs to is right beside it.
      image.alt = '';
      // For the house mark's per-scheme file (§17.3). The single `<img>` moves in and out of it.
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
        // Set on every draw, never toggled: the `<img>` is reused across lookups (§17).
        image.className = drawn.placeholder
          ? 'link-card-image link-card-placeholder'
          : 'link-card-image';
        image.src = drawn.src;
        if (drawn.placeholder) {
          picture.append(darkSource, image);
          dom.appendChild(picture);
        } else {
          // Moving the image out leaves the previous card's `<source>` behind.
          picture.remove();
          dom.appendChild(image);
        }
      };

      const currentHref = (n: PMNode) => (typeof n.attrs.href === 'string' ? n.attrs.href : '');

      // 「変更」 is local chrome state, not a node attribute (§7-3.1), so opening the picker is not an
      // edit and needs no undo.
      let editing = false;
      // The node `render` last drew, for callers outside a render pass.
      let current = node;

      // Deferred a frame so the DOM isn't rebuilt inside the click that hit it. **This is not the
      // double-click fix** (the fixed head band is): a real second click comes ~150-300ms later, so a
      // spec using `dblclick()` passes on this line alone; the spec spaces its clicks. `getPos()` is
      // read inside, since the NodeView may be gone.
      const setHref = (href: string) => {
        requestAnimationFrame(() => {
          const pos = getPos();
          if (typeof pos !== 'number') return;
          // A pick always ends editing.
          editing = false;
          editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, 'href', href));
          // **`update` is not guaranteed to follow:** re-picking the same post is an `eq()` node, so
          // ProseMirror skips it and the picker would stay up (§20f). Render directly; a second
          // draw is idempotent.
          const updated = editor.state.doc.nodeAt(pos);
          if (updated) render(updated);
        });
      };

      // The picker's second answer (docs/embed-requirements.md §5-1): a provider-claimed URL replaces
      // the card with an embed. Deferred a frame, since this destroys the NodeView mid-click.
      const toEmbed = (href: string) => {
        requestAnimationFrame(() => {
          const pos = getPos();
          if (typeof pos !== 'number') return;
          editor.commands.nodeToEmbed(pos, href);
        });
      };

      const render = (n: PMNode) => {
        current = n;
        body.replaceChildren();
        // Both states start without one: the picker never has an image, and a resolved card puts
        // it back only once the lookup says the target has one.
        setImage(null);
        const href = currentHref(n);
        if (!editing && href)
          renderCard(
            body,
            href,
            editor,
            () => {
              editing = true;
              render(current);
            },
            () => getPos(),
            setImage,
            ownSlug(),
          );
        // The cancel button only where there is a card to cancel back to: a freshly-inserted card
        // reaches this branch with `editing` still false and `href` already empty, and gets none.
        else
          renderPicker(
            body,
            editor,
            setHref,
            toEmbed,
            ownSlug(),
            editing ? cancelEditAndFocus : null,
          );
      };
      render(node);

      // Abandoning an edit puts selection and focus back on the card. A bare `view.dom.focus()` would
      // reveal the document's actual selection, which 変更 never moved and can be anywhere.
      const cancelEditAndFocus = () => {
        editing = false;
        render(current);
        const pos = getPos();
        if (typeof pos === 'number') editor.chain().setNodeSelection(pos).focus().run();
      };

      // Clicking outside also cancels, only when there is a card to go back to. **No focus grab:**
      // the click has already put focus where the author wanted.
      const onOutsidePointerDown = (event: MouseEvent) => {
        if (!editing) return;
        const target = event.target;
        // `globalThis.Node`, not this file's own tiptap `Node` import — the DOM interface.
        if (target instanceof globalThis.Node && dom.contains(target)) return;
        editing = false;
        render(current);
      };
      document.addEventListener('mousedown', onOutsidePointerDown);

      // What `stopEvent` below claims — stated once, because the drop refusal has to refuse exactly
      // what the claim takes out of ProseMirror's reach and no more (refuseChromeDrops).
      const claimsEvent = (target: HTMLElement) => target.closest('input, button') !== null;
      // The search box is natively droppable, and a drop there moved document text into it
      // (docs/editor-pitfalls.md §18).
      refuseChromeDrops(dom, claimsEvent, () => editor.view);

      return {
        dom,
        update: (updated: PMNode) => {
          if (updated.type !== this.type) return false;
          render(updated);
          return true;
        },
        // All chrome; never document content.
        ignoreMutation: () => true,
        // Keeps ProseMirror off the search box and buttons, or typing a query edits the post.
        // **Only the controls:** claiming the whole card swallowed the mousedown that makes a
        // NodeSelection (docs/editor-pitfalls.md §18).
        stopEvent: (event: Event) => {
          const target = event.target;
          return target instanceof HTMLElement && claimsEvent(target);
        },
        // Every card adds a document-level listener above; without this it outlives the card a
        // delete or an undo takes out, and stacks one per NodeView ProseMirror ever builds for it.
        destroy: () => document.removeEventListener('mousedown', onOutsidePointerDown),
      };
    };
  },
});

// The lines a resolved card draws, from either lookup, so a single `draw` cannot treat the two
// differently (the §13 failure).
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

// Lookups already made, per page, keyed by href: a card is rebuilt whenever its node is replaced
// (re-parse, undo, re-pick). A stale entry never reaches a reader (§6). **The whole answer is kept**,
// not just the title, or later builds drew less than the first (§13).
const cardCache = new Map<string, CardFace>();

// References whose next lookup must bypass a remembered failure (docs/link-card-requirements.md
// §14.3.2), set only by `linkToCard`. Module state, not storage, which is for what the host
// writes; keyed by reference, so cards sharing a URL share the refresh.
const forceRefresh = new Set<string>();

// Names the two buttons on screen that re-ask (§14.3.2).
const RETRY_NOTE = 'タイトルを取得できませんでした（リンクに戻してカードにし直すと再取得します）';

// Three states (§13.1): "not answered yet" and "nothing there" are both `null` in the data but must
// not look the same, or every card would read as broken for the ~10ms before its answer. A failed
// request (e.g. a lapsed session) is `unknown` too. `missing` carries its own words: the two kinds
// are fixed differently (§14.7).
type Lookup =
  | { status: 'unknown' }
  | { status: 'found'; card: CardFace }
  | { status: 'missing'; note: string };

// The reference decides which table answers, as on the published side. The stored href gets the
// §14.5.1 rewrite too, since `parseHTML` accepts any `data-href`: an absolute URL to one of this
// blog's posts would otherwise be refused by the preview route.
function lookupCard(href: string, ownSlug: string): Promise<Lookup> {
  const reference = normalizeCardHref(href, window.location.origin) ?? href;
  // Consumed once, even if the page fails again, or ordinary renders would hit the network that
  // `FAIL_TTL_MS` keeps them off. Read first, so an internal branch can't swallow it.
  const force = forceRefresh.delete(href);
  // A stored self-reference (§18) would otherwise resolve to the post being edited. `missing`, since
  // only `found` is cached.
  if (isOwnPostHref(reference, ownSlug)) {
    return Promise.resolve({ status: 'missing', note: SELF_REFERENCE_NOTE });
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
        // The same `internalCardImage` the published resolver uses (§17).
        image: internalCardImage(post.thumbnail),
      },
    };
  } catch {
    // Offline, or the session lapsed. The card keeps its reference either way — this only decides
    // what the editor draws, and §5.3's degradation is to show the path.
    return { status: 'unknown' };
  }
}

// The external half (§14.5). Asked on every render, which keeps the stored row warm (§14.3).
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
    // Nothing readable (a challenge page, a timeout, this server itself, §14.5.1). The row
    // remembers the failure for `FAIL_TTL_MS`, so the note says how to re-ask (§14.3.2).
    if (!preview) return { status: 'missing', note: RETRY_NOTE };
    // No description: the NodeView has never shown one (§14.7). The image arrives already as the
    // signed /api/link-image path, identical to the published card's.
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

// The fixed-height top band for both states' controls. Bottom-anchored, 「変更」 and 「リンクに戻す」
// moved up under where the first result row had been, so a double-click on a row cleared or
// dissolved the card just made. Here a stray second click lands on the search input.
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
  editor: Editor,
  onClear: () => void,
  pos: () => number | undefined,
  setImage: (picture: CardImage | null) => void,
  ownSlug: string,
): void {
  const actions = head();
  actions.append(
    // Opening a card's target (§7.4), which `openOnClick: false` took away. A control, not a click on
    // the card, which selects it. A new tab, as LinkBubble and the published card do
    // (docs/link-requirements.md §7.2).
    button('開く', () => window.open(href, '_blank', 'noopener,noreferrer'), {
      icon: EXTERNAL_LINK_SHAPES,
    }),
    button('変更', onClear, { icon: PENCIL_SHAPES }),
    // Refocused first, as the embed's does: the command removes this button, which holds focus.
    button('リンクに戻す', () => focusThenRun(editor, (c) => c.unsetLinkCard(pos())), {
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

  // Added and removed rather than emptied (an empty span keeps its margin, §13.1), in a fixed order,
  // since the note and the host become known at different moments.
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

  // One draw for a cache hit and a fresh answer, so they cannot disagree (§13).
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
      // 「変更」 may have detached these spans mid-lookup, and `setImage` would hang a thumbnail on
      // the picker.
      if (!title.isConnected) return;
      draw(lookup);
    });
  }
}

// The insert flow (§5.2-3), in the card itself, so an abandoned insert leaves a visible card. One
// field: an http(s) URL is a reference (§14.6-1), anything else a title search.
// `normalizeCardHref` turns this blog's own post URL into the internal reference (§14.5.1).
function renderPicker(
  body: HTMLElement,
  editor: { view: { dom: HTMLElement } },
  onPick: (href: string) => void,
  onEmbed: (href: string) => void,
  ownSlug: string,
  // Set only when 「変更」 opened this on a resolved card, which can be returned to.
  onCancel: (() => void) | null,
): void {
  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'link-card-search';
  input.placeholder = '記事のタイトルで検索、または URL を貼り付け…';
  // Same band the resolved card puts its buttons in — see head().
  const controls = head();
  controls.appendChild(input);
  if (onCancel) controls.appendChild(button('キャンセル', onCancel, { icon: BACK_SHAPES }));
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
      // When the query matched only this post, say why rather than "no match".
      empty.textContent =
        offered.length < results.length ? SELF_REFERENCE_NOTE : '一致する記事がありません';
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

  // The one row a URL produces. Bumps `latest` so an older search can't land on top.
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
    // Shared with the insert dialog (lib/insert-target.ts) so a URL cannot resolve differently
    // depending on which of the two surfaces sees it first — §21 of link-card-requirements.md.
    const target = resolveInsertTarget(value, ownSlug, window.location.origin);
    switch (target.kind) {
      case 'embed':
        showReference('この URL を埋め込みにする', () => onEmbed(target.href));
        return;
      case 'embed-refused':
        showRefusal(target.message);
        return;
      case 'card-refused-self':
        // This post's own address (§18): a line, not a dead row.
        showRefusal(SELF_REFERENCE_NOTE);
        return;
      case 'card':
        showReference('この URL をカードにする', () => onPick(target.href));
        return;
      case 'none':
        void search(value);
        return;
    }
  });
  // Escape: `onCancel` refocuses the card (§7.4.1); the raw `dom.focus()` is only for a card-less
  // picker.
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (onCancel) {
      onCancel();
      return;
    }
    editor.view.dom.focus();
  });
  void search('');
  // Deferred: the NodeView's DOM is not in the document yet when this runs, and focus() on a
  // detached element does nothing.
  requestAnimationFrame(() => input.focus());
}

// One row of the insert search (§5.2-5): picture, title, category. The picture is
// `internalCardImage`, so every row has one (the house mark when needed, §17) and titles line up.
// **The accessible name is the title (plus the draft note) only:** e2e/editor-link-card.spec.ts
// matches it as a full string.
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
  // A badge rather than title text: it is a property, and an ellipsis ate it first.
  if (post.draft) {
    const badge = document.createElement('span');
    badge.className = 'link-card-result-badge';
    badge.textContent = '未公開';
    // Already in the button's own label above, so a screen reader would otherwise hear it twice.
    badge.setAttribute('aria-hidden', 'true');
    head.appendChild(badge);
  }
  text.appendChild(head);
  const category = document.createElement('span');
  category.className = 'link-card-result-category';
  category.textContent = categoryLabel(post.category);
  text.appendChild(category);

  el.append(resultImage(internalCardImage(post.thumbnail)), text);
  el.addEventListener('click', onPick);
  return el;
}

// The row's picture, with the card's `<picture>` mechanism (§17.3), built fresh per row.
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

// `icon` makes a band control. **Icon and label at every width**: below 30rem (40rem with a picture,
// §7.4.2) the label is visually hidden, not removed, since it is the accessible name (§7.4).
// `danger` tints rather than fills, as elsewhere in the chrome.
function button(
  label: string,
  onClick: () => void,
  options: { icon?: readonly IconShape[]; danger?: boolean } = {},
): HTMLButtonElement {
  const el = document.createElement('button');
  // Not a submit button inside PostEditor's <form>.
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
