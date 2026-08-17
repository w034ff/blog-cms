import { Node, mergeAttributes, type CommandProps } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { PostSearchResult } from '@/lib/types';
import { canPlaceAfterCaret } from './code-block-extension';
import type { MarkdownSerializerState } from './markdown-serializer-state';

// The link card (docs/link-card-requirements.md): a block that shows an internal post as a card
// rather than as a line of link text.
//
// What is stored is a reference and nothing the reader sees:
//
//   <div class="link-card" data-href="/posts/f377f7a9a768a5b4d6f2"></div>
//
// Empty on purpose (§4.2). The title, date and description are derived from the `posts` row at
// render time — baking them in would leave a renamed post's old title sitting in every body that
// linked to it. That is also the one place this differs from the accordion, whose serializer
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

export const LinkCard = Node.create({
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

  addStorage() {
    return {
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
          const label = postCache.get(href)?.title ?? href;
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
      image.className = 'link-card-image';
      // Decorative, for the published card's reason: the title it belongs to is right beside it.
      image.alt = '';
      const setImage = (src: string | null) => {
        if (src === null) {
          image.remove();
          return;
        }
        image.src = src;
        dom.appendChild(image);
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

      const render = (n: PMNode) => {
        body.replaceChildren();
        // Both states start without one: the picker never has an image, and a resolved card puts
        // it back only once the lookup says the target has one.
        setImage(null);
        const href = currentHref(n);
        if (!href) renderPicker(body, editor, setHref);
        else
          renderCard(
            body,
            href,
            editor,
            () => setHref(''),
            () => getPos(),
            setImage,
          );
      };
      render(node);

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
          return target instanceof HTMLElement && target.closest('input, button') !== null;
        },
      };
    };
  },
});

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
const postCache = new Map<string, PostSearchResult>();

// What is known about a card's target. Three states rather than a nullable post, because "the
// answer has not come back yet" and "the route says there is no such post" are the same `null` in
// the data and must not be the same card on screen (§13.1): the second says so in the card's own
// second line, and a card that said it for the ~10ms before its own answer arrives would call every
// reference broken every time the document is opened. A failed request is `unknown` too — a lapsed
// session is not a missing post, and the card has nothing to report about it.
type Lookup =
  | { status: 'unknown' }
  | { status: 'found'; post: PostSearchResult }
  | { status: 'missing' };

async function fetchPost(href: string): Promise<Lookup> {
  const slug = href.startsWith('/posts/') ? href.slice('/posts/'.length) : '';
  // A reference that cannot name a post at all. The published side refuses the same shapes (§4.4),
  // so this is the editor saying the same thing while it can still be fixed.
  if (!slug) return { status: 'missing' };
  try {
    const res = await fetch(`/api/posts/search?slug=${encodeURIComponent(slug)}`);
    if (res.status === 404) return { status: 'missing' };
    if (!res.ok) return { status: 'unknown' };
    return { status: 'found', post: (await res.json()) as PostSearchResult };
  } catch {
    // Offline, or the session lapsed. The card keeps its reference either way — this only decides
    // what the editor draws, and §5.3's degradation is to show the path.
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

// The resolved card: the target's title and image, and a second line only when there is something
// wrong to say about it. `onClear` puts the card back into its picker state so the author can point
// it somewhere else without deleting it.
function renderCard(
  body: HTMLElement,
  href: string,
  editor: { commands: { unsetLinkCard: (at?: number) => boolean } },
  onClear: () => void,
  pos: () => number | undefined,
  setImage: (src: string | null) => void,
): void {
  const actions = head();
  actions.append(
    button('変更', onClear),
    button('リンクに戻す', () => editor.commands.unsetLinkCard(pos())),
  );

  const title = document.createElement('span');
  title.className = 'link-card-title';
  const meta = document.createElement('span');
  meta.className = 'link-card-meta';
  body.append(actions, title);

  // The second line is put up and taken down rather than emptied: a card whose target is fine has
  // no second line at all (§13.1), and an empty span still carries the line's top margin.
  const setMeta = (text: string) => {
    meta.textContent = text;
    if (text === '') meta.remove();
    else body.appendChild(meta);
  };

  // Everything the lookup decides, in one place, so the cache hit and the answer that has just
  // arrived draw the same card. Splitting them is what let the two disagree (§13): a card drawn
  // from the cache took the "not looked up yet" branch of each line and kept it forever.
  const draw = (lookup: Lookup) => {
    // The path is what §5.3 degrades to: until the title is known, what the card names is the
    // reference the author wrote, which is the thing they can act on.
    title.textContent = lookup.status === 'found' ? lookup.post.title : href;
    // The two things worth interrupting for. A draft resolves to nothing on the published page and
    // the card falls back to a plain link there (§5.2-4, §6.1); a reference the route cannot match
    // does the same, and both are fixable only from here.
    if (lookup.status === 'missing') setMeta('記事が見つかりません');
    else if (lookup.status === 'found' && lookup.post.draft) setMeta('未公開の記事');
    else setMeta('');
    setImage(lookup.status === 'found' ? lookup.post.thumbnail : null);
  };

  const cached = postCache.get(href);
  draw(cached ? { status: 'found', post: cached } : { status: 'unknown' });
  if (!cached) {
    void fetchPost(href).then((lookup) => {
      if (lookup.status === 'found') postCache.set(href, lookup.post);
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

// The insert flow (§5.2-3): search your own posts and pick one. It lives in the card rather than in
// a popup of its own so the slash menu needs no second UI framework, and so an author who inserts
// and then wanders off is left with a visible unfinished card instead of a silent no-op.
function renderPicker(
  body: HTMLElement,
  editor: { view: { dom: HTMLElement } },
  onPick: (href: string) => void,
): void {
  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'link-card-search';
  input.placeholder = '記事のタイトルで検索…';
  // Same band the resolved card puts its buttons in — see head().
  const controls = head();
  controls.appendChild(input);
  const list = document.createElement('ul');
  list.className = 'link-card-results';
  body.append(controls, list);

  const show = (results: PostSearchResult[]) => {
    list.replaceChildren();
    if (results.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'link-card-empty';
      empty.textContent = '一致する記事がありません';
      list.appendChild(empty);
      return;
    }
    for (const post of results) {
      const row = document.createElement('li');
      row.appendChild(
        button(post.draft ? `${post.title}（未公開）` : post.title, () =>
          onPick(`/posts/${post.slug}`),
        ),
      );
      list.appendChild(row);
    }
  };

  let latest = 0;
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

  input.addEventListener('input', () => void search(input.value));
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

function button(label: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  // Not a submit button: PostEditor wraps the whole editor in one <form>, so a default-type
  // button inside it submits the post (see the toolbar's dialogs, which hit this).
  el.type = 'button';
  el.textContent = label;
  el.addEventListener('click', onClick);
  return el;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    linkCard: {
      setLinkCard: (href?: string) => ReturnType;
      unsetLinkCard: (at?: number) => ReturnType;
    };
  }
}
