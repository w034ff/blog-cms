import { Node, mergeAttributes, type CommandProps } from '@tiptap/core';
import type { Node as PMNode, NodeType } from '@tiptap/pm/model';
import { NodeSelection, Plugin } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { resolveEmbed, type EmbedTarget } from '@/lib/embed-provider';
import {
  EMBED_SILENCE_MS,
  EMBED_VISIBLE_THRESHOLD,
  readXCall,
  X_ORIGIN,
  X_PROVIDER,
} from '@/lib/embed-message';
import type { MarkdownSerializerState } from './markdown-serializer-state';
import { refuseChromeDrops } from './useDragContainment';

// The embed (docs/embed-requirements.md): a block that plays or shows an external item in place,
// rather than naming it with a line of link text.
//
// What is stored is the reference the author handed over and nothing else:
//
//   <div class="embed" data-href="https://www.youtube.com/watch?v=hDPybQwAuVo&amp;t=90"></div>
//
// One node and one class for every provider (§4). The provider, the src, and the accessible name
// are all derived from that string by lib/embed-provider.ts, which both this file and the published
// stage ask — so adding a provider touches neither the document format nor the sanitize schema.
//
// The URL is stored rather than an extracted id: the id alone would need a second attribute for the
// start time, and 「リンクに戻す」 would hand the author back a URL they never wrote.
//
// **Nothing here fetches** (§3.2). That is what separates an embed from a link card, which holds a
// reference into a table that a route has to fill and keep fresh.

// HTML attribute escaping, not markdown escaping — the serializer writes this line as raw HTML, so
// markdown-it parses it back, and an unescaped `"` would end the attribute early. The card's
// serializer carries the same three replacements for the same reason, `&` first.
function escapeHref(href: string): string {
  return href.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function serializeEmbed(state: MarkdownSerializerState, node: PMNode): void {
  const href = typeof node.attrs.href === 'string' ? node.attrs.href : '';
  state.write(`<div class="embed" data-href="${escapeHref(href)}"></div>`);
  // Closes the block for serializeLinkCard's reason: without it whatever follows is emitted onto
  // this line and reaches the public pipeline glued to the div.
  state.closeBlock(node);
}

// Names one placement in the provider's messages (§10.5), the counterpart of the id rehypeEmbed
// mints per element. A NodeView keeps its own for its whole life: when the reference changes the
// iframe reloads and re-announces itself under the same name.
let viewCount = 0;

// §8.2. A click landing beside a narrower-than-column embed (only embed-x today, §10.9) never
// reaches the node's own DOM at all — measured 2026-08-25, `document.elementFromPoint` there
// returns `view.dom` itself, not `.embed-view` or the iframe, so the click fell through to the
// browser's own caret-from-point search and could land in a neighbouring block instead of
// selecting the embed.
//
// Geometric, not provider-keyed: this asks the same question of every embed node's own DOM rect,
// so a provider whose box already spans the column (YouTube, the unresolved-note state) never
// matches — nothing here has to know which providers are narrow, and a future one that caps its
// width gets the fix for free.
function embedDeadZonePlugin(embedType: NodeType): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown(view: EditorView, event: MouseEvent) {
          // A click that hit anything more specific than the editable root already resolves
          // correctly (the embed's own dom, another block, a mark) and must be left alone.
          if (event.target !== view.dom) return false;
          let hit: number | null = null;
          view.state.doc.forEach((node, offset) => {
            if (hit !== null || node.type !== embedType) return;
            const dom = view.nodeDOM(offset);
            if (!(dom instanceof HTMLElement)) return;
            const rect = dom.getBoundingClientRect();
            const besideIt = event.clientX < rect.left || event.clientX > rect.right;
            if (event.clientY >= rect.top && event.clientY <= rect.bottom && besideIt) {
              hit = offset;
            }
          });
          if (hit === null) return false;
          event.preventDefault();
          view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, hit)));
          view.focus();
          return true;
        },
      },
    },
  });
}

export const Embed = Node.create({
  name: 'embed',
  group: 'block',
  // A leaf the caret cannot enter, like the card. It is what lets the whole block be one drag
  // target, and what keeps the link bubble away from a node that contains no link mark.
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
  // The reference is NOT validated here, for the card's reason (§4.2): an editor-side check covers
  // one door only, and the published side has to answer for hand-written HTML regardless — so
  // validation lives in one place, at resolution time. An unusable reference round-trips intact and
  // renders as a plain link when published.
  parseHTML() {
    return [{ tag: 'div.embed' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'embed' })];
  },

  addStorage() {
    return {
      markdown: {
        serialize: serializeEmbed,
        // markdown-it's raw-HTML passthrough plus parseHTML above, the route accent emphasis and
        // the link card both take. The stored form already is the DOM shape this node parses.
        parse: {},
      },
    };
  },

  addCommands() {
    return {
      // §5-2: turn the link the caret is in into an embed. The bubble asks this, and it is the
      // mirror of linkToCard — including the placement question, which is about replacing one
      // textblock rather than about inserting after it, so a link inside a sentence and the first
      // paragraph of a list item both refuse.
      linkToEmbed:
        (range: { from: number; to: number }, href: string) =>
        ({ chain, state }: CommandProps): boolean => {
          const $from = state.doc.resolve(range.from);
          if (!$from.parent.isTextblock || $from.depth < 1) return false;
          if (range.from !== $from.start() || range.to !== $from.end()) return false;
          const parent = $from.node($from.depth - 1);
          const index = $from.index($from.depth - 1);
          if (!parent.canReplaceWith(index, index + 1, this.type)) return false;
          return chain()
            .insertContentAt(
              { from: $from.before($from.depth), to: $from.after($from.depth) },
              { type: this.name, attrs: { href } },
            )
            .run();
        },

      // §5-1: the card's picker takes URLs too, and a URL a provider claims should not have to
      // become a card first. The card node at `at` is replaced outright, so the author gets one
      // block for one paste rather than a card that has to be undone.
      //
      // Kept general — it replaces whatever block sits at `at` — because the question that matters
      // is whether the parent can hold an embed there, not which node is being displaced.
      nodeToEmbed:
        (at: number, href: string) =>
        ({ chain, state }: CommandProps): boolean => {
          const node = state.doc.nodeAt(at);
          if (!node) return false;
          const $at = state.doc.resolve(at);
          if (!$at.parent.canReplaceWith($at.index(), $at.index() + 1, this.type)) return false;
          return chain()
            .insertContentAt(
              { from: at, to: at + node.nodeSize },
              { type: this.name, attrs: { href } },
            )
            .setNodeSelection(at)
            .run();
        },

      // Undo the embed without losing the reference — the caret cannot enter an atom, so without
      // this the block is a one-way door. The link text is the URL itself: no fetch has run, so
      // there is no title to put there, and the URL is what the author wrote in the first place.
      //
      // `at` is passed by the NodeView, which knows its own position, and falls back to the
      // selection so an embed picked up by the block drag handle can be dissolved too. Clicking a
      // button inside the block does not move the selection, which is what made the card's own
      // fallback insufficient there.
      unsetEmbed:
        (at?: number) =>
        ({ chain, state }: CommandProps): boolean => {
          const from = at ?? state.selection.from;
          const node = state.doc.nodeAt(from);
          if (node?.type !== this.type) return false;
          const href = typeof node.attrs.href === 'string' ? node.attrs.href : '';
          if (!href) {
            return chain()
              .deleteRange({ from, to: from + node.nodeSize })
              .run();
          }
          return chain()
            .insertContentAt(
              { from, to: from + node.nodeSize },
              {
                type: 'paragraph',
                content: [{ type: 'text', marks: [{ type: 'link', attrs: { href } }], text: href }],
              },
            )
            .run();
        },
    };
  },

  addProseMirrorPlugins() {
    return [embedDeadZonePlugin(this.type)];
  },

  // The embed as the author sees it (§7): the same two elements and the same iframe the published
  // page gets, because an editor that shows every block but this one has stopped being WYSIWYG.
  //
  // A plain-DOM NodeView with no contentDOM — the node is an atom, so everything here is chrome.
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('div');
      dom.setAttribute('contenteditable', 'false');

      const actions = document.createElement('div');
      actions.className = 'embed-head';
      const unset = document.createElement('button');
      // Not a submit button: PostEditor wraps the whole editor in one <form>, so a default-type
      // button inside it submits the post.
      unset.type = 'button';
      unset.textContent = 'リンクに戻す';
      unset.addEventListener('click', () => {
        const pos = getPos();
        editor.commands.unsetEmbed(typeof pos === 'number' ? pos : undefined);
      });
      actions.appendChild(unset);

      // Built once and kept. **Detaching an `<iframe>` discards its browsing context**, so
      // `replaceChildren` reloads the player whether or not `src` was touched — which is why the
      // children are only swapped when the state actually changes below, and why re-pointing `src`
      // is guarded separately. An update that changes neither must leave this DOM alone: a video
      // the author is watching is not something an edit elsewhere gets to restart.
      const frame = document.createElement('div');
      frame.className = 'embed-frame';
      const iframe = document.createElement('iframe');
      iframe.loading = 'lazy';
      // The published iframe's attribute, for the reason lib/rehype-embed.ts states (§10.8): X's
      // own document reserves a scrollbar track that nothing scrolls. `setAttribute` rather than
      // the property, because what is being asked for is the obsolete HTML attribute.
      iframe.setAttribute('scrolling', 'no');
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      iframe.allowFullscreen = true;
      frame.appendChild(iframe);

      // What a reference no provider claims looks like here. The published side degrades it to a
      // plain link (§6); the editor says so instead, because this is the surface where it can be
      // fixed and the author is the one holding the URL.
      const note = document.createElement('span');
      note.className = 'embed-note';

      // Which of the two states is on screen, so the swap happens on a crossing rather than on
      // every update. `null` until the first render puts something there.
      let showing: 'player' | 'note' | null = null;
      let current: PMNode = node;
      const instanceId = `emb-view-${(viewCount += 1)}`;
      // The reference whose post the provider could not produce. Remembered rather than re-asked,
      // because an edit elsewhere re-runs `render` and must not put a known-empty player back.
      // Cleared when the reference itself changes, which is the only thing that can change the
      // answer.
      let failedHref: string | null = null;
      let silence: number | null = null;
      // Whether the iframe has said anything at all. Separate from the clock because the two are
      // not ordered: an embed already on screen can report its height before the observer's first
      // callback runs, and arming a clock for it would turn a working post into the failure note
      // eight seconds later.
      let answered = false;
      // Whether the block has been on screen at all, and whether what is on it answers back. The
      // clock needs both, and neither is known at the moment the other becomes true — an embed can
      // be scrolled to long before an edit re-points it at another provider, and vice versa — so
      // they are kept rather than acted on where they are observed.
      let visible = false;
      let speaks = false;
      // The reference `render` last drew, so a change of reference can be told from a redraw of the
      // same one.
      let lastHref: string | null = null;

      const clearSilence = () => {
        if (silence === null) return;
        window.clearTimeout(silence);
        silence = null;
      };

      // **Only the provider that speaks gets a clock** (§10.6, corrected 2026-08-24). A YouTube
      // player holds its own ratio and sends nothing at all, so silence from it is not news — armed
      // for it, the clock replaced a working player with the failure note eight seconds after the
      // author scrolled to it. The published side never had this: it selects `.embed-x` (see
      // `components/EmbedFrames.tsx`), and this is the editor's counterpart of that selector.
      const arm = () => {
        if (!visible || !speaks || answered || silence !== null || showing !== 'player') return;
        silence = window.setTimeout(() => {
          silence = null;
          if (showing !== 'player') return;
          failedHref = typeof current.attrs.href === 'string' ? current.attrs.href : '';
          render(current);
        }, EMBED_SILENCE_MS);
      };

      const render = (n: PMNode) => {
        current = n;
        const href = typeof n.attrs.href === 'string' ? n.attrs.href : '';
        const target: EmbedTarget | null = resolveEmbed(href);
        // A new reference is a new question, and nothing the old one answered carries over: a post
        // that reported its height says nothing about the one replacing it, so the clock is re-armed
        // for it below rather than left disarmed by its predecessor's answer.
        if (lastHref !== null && lastHref !== href) {
          failedHref = null;
          answered = false;
          clearSilence();
        }
        lastHref = href;
        speaks = target?.provider === X_PROVIDER;
        dom.className = target
          ? `embed embed-view embed-${target.provider}`
          : 'embed embed-view embed-unresolved';
        // Three states, not two. **The author is told rather than shown the degraded form** — the
        // published page turns an unfetchable post into a plain link (§10.6), but this is the
        // surface where the reference can still be corrected, so it says what happened instead.
        // §7.2 settled that for a reference no provider claims; a post that no longer exists is the
        // same kind of news.
        if (!target || failedHref === href) {
          dom.className = 'embed embed-view embed-unresolved';
          if (!target) {
            note.textContent = href === '' ? '参照がありません' : `埋め込みにできない参照: ${href}`;
          } else {
            note.textContent = `取得できない投稿です（削除済み・非公開・存在しない）: ${href}`;
          }
          if (showing !== 'note') {
            dom.replaceChildren(actions, note);
            showing = 'note';
          }
          return;
        }
        const src = target.src(instanceId);
        if (iframe.src !== src) iframe.src = src;
        iframe.title = target.title;
        iframe.allow = target.allow;
        if (showing !== 'player') {
          dom.replaceChildren(actions, frame);
          showing = 'player';
        }
        arm();
      };
      render(node);

      // The same two answers the reader's browser waits for (`components/EmbedFrames.tsx`), for the
      // same reason: a post's height is its content's, and whether the post exists at all is
      // something only its own iframe can report. Kept here rather than shared with that file
      // because the two surfaces do different things with the second answer.
      const onMessage = (event: MessageEvent) => {
        if (event.origin !== X_ORIGIN) return;
        // And from this placement's own frame. **The id is not enough**: it names a placement, and
        // anything that copies this element copies the name with it. The block drag handle's
        // preview cloned the whole NodeView, iframe included — a clone is a live browsing context,
        // not a picture — and the copy answered under `emb-view-1` from a box of a different width,
        // which shrank the block still sitting in the document (measured 2026-08-24; the clone is
        // gone now, blankClonedFrames in block-drag-handle.ts, and this is the check that makes the
        // question "did MY frame say it" rather than "did something say it").
        if (!iframe.contentWindow || event.source !== iframe.contentWindow) return;
        const call = readXCall(event.data);
        if (call?.id !== instanceId) return;
        const height = call.params?.[0]?.height;
        if (call.method === 'twttr.private.resize' && typeof height === 'number') {
          answered = true;
          clearSilence();
          frame.style.height = `${height}px`;
        } else if (call.method === 'twttr.private.no_results') {
          clearSilence();
          failedHref = typeof current.attrs.href === 'string' ? current.attrs.href : '';
          render(current);
        }
      };
      window.addEventListener('message', onMessage);

      // Started by visibility and never by load: nothing is sent while the iframe is off screen,
      // even though the post inside it is already drawn (§10.5). Once seen is enough — a block
      // scrolled past and back is not a second chance to fail — so the flag outlives the observer.
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.unobserve(entry.target);
            visible = true;
            arm();
          }
        },
        { threshold: EMBED_VISIBLE_THRESHOLD },
      );
      observer.observe(dom);

      // What `stopEvent` below claims, and the matching drop refusal — same pair, same reason as the
      // link card's (refuseChromeDrops). No droppable text control lives in this band today, so
      // nothing is destroyed by a drop here yet; the refusal is what keeps that true when one does.
      const claimsEvent = (target: HTMLElement) => target.closest('button') !== null;
      refuseChromeDrops(dom, claimsEvent, () => editor.view);

      return {
        dom,
        update: (updated: PMNode) => {
          if (updated.type !== this.type) return false;
          render(updated);
          return true;
        },
        // Everything in here is chrome the NodeView owns; none of it is document content, so
        // ProseMirror must never read a mutation back into the document.
        ignoreMutation: () => true,
        destroy: () => {
          window.removeEventListener('message', onMessage);
          observer.disconnect();
          clearSilence();
        },
        // Narrowed to the button rather than claimed for the whole block, the distinction the card
        // paid for: swallowing every event inside `dom` also swallows the mousedown that makes a
        // NodeSelection, and then clicking the block selects nothing. The iframe is not listed
        // because events inside it never reach this document at all.
        stopEvent: (event: Event) => {
          const target = event.target;
          return target instanceof HTMLElement && claimsEvent(target);
        },
      };
    };
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    embed: {
      linkToEmbed: (range: { from: number; to: number }, href: string) => ReturnType;
      nodeToEmbed: (at: number, href: string) => ReturnType;
      unsetEmbed: (at?: number) => ReturnType;
    };
  }
}
