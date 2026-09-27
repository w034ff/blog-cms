import { Node, mergeAttributes, type CommandProps } from '@tiptap/core';
import type { Node as PMNode, NodeType } from '@tiptap/pm/model';
import { NodeSelection, Plugin } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { resolveEmbed, type EmbedTarget } from '@/lib/embed-provider';
import {
  EMBED_SILENCE_MS,
  EMBED_VISIBLE_THRESHOLD,
  GIST_PROVIDER,
  gistAsk,
  readGistCall,
  readXCall,
  X_ORIGIN,
  X_PROVIDER,
} from '@/lib/embed-message';
import { canPlaceAfterCaret } from './code-block-extension';
import { focusThenRun } from './focus-then-run';
import { escapeAttribute } from './html-escape';
import type { MarkdownSerializerState } from './markdown-serializer-state';
import { buildIcon, UNLINK_SHAPES } from './svg/icon-shapes';
import { refuseChromeDrops } from './useDragContainment';

// The event the host listens for, exported so the two files can't disagree. Named for the dialog,
// which also produces link cards (docs/embed-requirements.md §24.2).
export const INSERT_DIALOG_EVENT = 'editor:open-insert-dialog';

// Where the inserted node goes once the dialog comes back with a URL.
export type InsertDialogDetail = { at: number };

// The embed (docs/embed-requirements.md): a block that plays or shows an external item in place,
// rather than naming it with a line of link text.
//
// What is stored is the reference the author handed over and nothing else:
//
//   <div class="embed" data-href="https://www.youtube.com/watch?v=hDPybQwAuVo&amp;t=90"></div>
//
// One node and class for every provider (§4); lib/embed-provider.ts derives the rest on both sides,
// so a new provider touches neither the format nor the sanitize schema. The URL, not an id, so the
// start time survives and 「リンクに戻す」 returns what the author wrote. **Nothing here fetches**
// (§3.2), unlike the link card.

function serializeEmbed(state: MarkdownSerializerState, node: PMNode): void {
  const href = typeof node.attrs.href === 'string' ? node.attrs.href : '';
  state.write(`<div class="embed" data-href="${escapeAttribute(href)}"></div>`);
  // Closes the block, or whatever follows is glued onto this line.
  state.closeBlock(node);
}

// Names one placement in the provider's messages (§10.5), kept for the NodeView's life.
let viewCount = 0;

// §8.2: a click beside a narrower-than-column embed hits `view.dom` itself, so the browser's
// caret-from-point could land in a neighbouring block instead of selecting the embed. Geometric,
// not provider-keyed, so any future narrow provider is covered.
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
  // A leaf the caret cannot enter, like the card: one drag target, and no link bubble.
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

  // Not validated here (§4.2): the published side must answer for hand-written HTML anyway, so
  // validation lives at resolution time and a bad reference round-trips intact.
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
        // markdown-it's raw-HTML passthrough plus parseHTML above.
        parse: {},
      },
    };
  },

  addCommands() {
    return {
      // §5-2: the mirror of linkToCard, replacing the link's textblock, so a link inside a
      // sentence or a list item's first paragraph refuses.
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

      // §5-1: replaces the block at `at` (the card picker's URL case); what matters is whether the
      // parent can hold an embed there.
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

      // §16.9: insert at the caret. **An empty textblock is replaced**, so no invisible blank line
      // is left above; otherwise the embed goes after the textblock, never splitting it.
      setEmbed:
        (href: string) =>
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

      // Asks the host to open the shared insert dialog (docs/embed-requirements.md §24.2); inserts
      // nothing, since the URL decides. **Placement is asked of BOTH outcomes, never restated**
      // (`can().setEmbed('')`, `can().setLinkCard('')`). A DOM event because storage doesn't
      // re-render React and an option is fixed at build time (docs/link-card-requirements.md §18).
      openInsertDialog:
        (at?: number) =>
        ({ can, dispatch, editor }: CommandProps): boolean => {
          if (!can().setEmbed('') && !can().setLinkCard('')) return false;
          // Null under `can()`, which is what makes this safe to ask from the menu's `available`.
          if (dispatch) {
            // **The caret rides along**, from the caller: a focus after a blur sometimes restores
            // the selection at the document's end. The selection fallback is that unreliable read,
            // taken by no current caller.
            const target = at ?? editor.state.selection.from;
            editor.view.dom.dispatchEvent(
              new CustomEvent<InsertDialogDetail>(INSERT_DIALOG_EVENT, {
                bubbles: true,
                detail: { at: target },
              }),
            );
          }
          return true;
        },

      // Back to a link whose text is the URL (no title was ever fetched), so the atom is not a
      // one-way door. `at` comes from the NodeView, since clicking its button doesn't move the
      // selection; the selection fallback serves a drag-handle NodeSelection.
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

  // The same elements and iframe the published page gets (§7). No contentDOM: it is an atom.
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('div');
      dom.setAttribute('contenteditable', 'false');

      const actions = document.createElement('div');
      actions.className = 'embed-head';
      const unset = document.createElement('button');
      // Not a submit button inside PostEditor's <form>.
      unset.type = 'button';
      // Icon and label, as 「リンクに戻す」 looks everywhere (link-card-requirements.md §7.4).
      const unsetLabel = document.createElement('span');
      unsetLabel.className = 'embed-to-link-label';
      unsetLabel.textContent = 'リンクに戻す';
      unset.append(buildIcon(UNLINK_SHAPES), unsetLabel);
      // Focus goes back to the editor first: the click left it on this button, which the command
      // then removes, so without it focus falls to <body> and the next Ctrl-Z does nothing.
      unset.addEventListener('click', () => {
        const pos = getPos();
        focusThenRun(editor, (c) => c.unsetEmbed(typeof pos === 'number' ? pos : undefined));
      });
      actions.appendChild(unset);

      // Built once. **Detaching an `<iframe>` discards its browsing context**, so children are
      // swapped only on a state change and `src` only when it differs: an edit elsewhere must not
      // restart a playing video.
      const frame = document.createElement('div');
      frame.className = 'embed-frame';
      const iframe = document.createElement('iframe');
      iframe.loading = 'lazy';
      // As on the published iframe (lib/rehype-embed.ts, §10.8): X reserves an unused scrollbar.
      iframe.setAttribute('scrolling', 'no');
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      iframe.allowFullscreen = true;
      frame.appendChild(iframe);

      // For a reference no provider claims: published, it degrades to a link (§6); here the author
      // is told, since this is where it can be fixed.
      const note = document.createElement('span');
      note.className = 'embed-note';

      // **A Figma file whose sharing is off renders for the signed-in author but shows readers a
      // login screen** (docs/embed-requirements.md §15.6). Shown unconditionally: telling the cases
      // apart would need a fetch (§3.2).
      const hint = document.createElement('span');
      hint.className = 'embed-note embed-hint';
      hint.textContent =
        '読者に表示するには、Figma の共有設定が「リンクを知っている全員」である必要があります。';

      // Which state is on screen, so the swap happens only on a crossing.
      let showing: 'player' | 'note' | null = null;
      let current: PMNode = node;
      const instanceId = `emb-view-${(viewCount += 1)}`;
      // The reference the provider could not produce, remembered until the reference changes so a
      // re-render doesn't bring back a known-empty player.
      let failedHref: string | null = null;
      let silence: number | null = null;
      // Whether the iframe has said anything; it can answer before the observer first fires.
      let answered = false;
      // Whether the block has been on screen, and whether its provider answers back; the clock needs
      // both, and they become known independently.
      let visible = false;
      let speaks = false;
      // The reference `render` last drew.
      let lastHref: string | null = null;

      const clearSilence = () => {
        if (silence === null) return;
        window.clearTimeout(silence);
        silence = null;
      };

      // **Only a provider that speaks gets a clock** (§10.6): YouTube sends nothing, so silence
      // from it is not failure. The counterpart of EmbedFrames.tsx's selector.
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
        // A new reference re-arms the clock; the old one's answer does not carry over.
        if (lastHref !== null && lastHref !== href) {
          failedHref = null;
          answered = false;
          clearSilence();
        }
        lastHref = href;
        // X and the gist answer back (§18.5), the gist because this codebase writes its document.
        speaks = target?.provider === X_PROVIDER || target?.provider === GIST_PROVIDER;
        dom.className = target
          ? `embed embed-view embed-${target.provider}`
          : 'embed embed-view embed-unresolved';
        // **The author is told rather than shown the degraded link** (§7.2, §10.6), including for a
        // post that no longer exists.
        if (!target || failedHref === href) {
          dom.className = 'embed embed-view embed-unresolved';
          if (!target) {
            note.textContent = href === '' ? '参照がありません' : `埋め込みにできない参照: ${href}`;
          } else {
            note.textContent =
              target.provider === GIST_PROVIDER
                ? `取得できない gist です（削除済み・非公開・存在しない）: ${href}`
                : `取得できない投稿です（削除済み・非公開・存在しない）: ${href}`;
          }
          if (showing !== 'note') {
            dom.replaceChildren(actions, note);
            showing = 'note';
          }
          hint.remove();
          return;
        }
        // As on the published iframe (§18.6). **Set before the frame is pointed anywhere:** a
        // `sandbox` applies only from the next load.
        if (target.sandbox === null) iframe.removeAttribute('sandbox');
        else iframe.setAttribute('sandbox', target.sandbox);
        const src = target.src(instanceId);
        // `src` or `srcdoc`, never both; assigned only when different, since either reloads.
        if (target.srcdoc === null) {
          if (iframe.hasAttribute('srcdoc')) iframe.removeAttribute('srcdoc');
          if (iframe.src !== src) iframe.src = src;
        } else {
          const doc = target.srcdoc(src, instanceId);
          if (iframe.srcdoc !== doc) iframe.srcdoc = doc;
        }
        iframe.title = target.title;
        iframe.allow = target.allow;
        if (showing !== 'player') {
          dom.replaceChildren(actions, frame);
          showing = 'player';
        }
        // Added on its own, not via `showing`, so a provider change never detaches the iframe.
        if (target.provider === 'figma') {
          if (hint.parentNode !== dom) dom.appendChild(hint);
        } else {
          hint.remove();
        }
        arm();
      };
      render(node);

      // The two answers EmbedFrames.tsx also waits for (height, existence); not shared, because the
      // surfaces act differently on the second.
      const onMessage = (event: MessageEvent) => {
        // From this placement's own frame. **The id is not enough:** a copy of the element (the drag
        // preview once cloned the live iframe) answers under the same name.
        if (!iframe.contentWindow || event.source !== iframe.contentWindow) return;
        // Our gist reporter first: its origin is `"null"` (§18.5), so the source check is its whole
        // authentication. No files drawn is the gist's `no_results`.
        const gist = readGistCall(event.data);
        if (gist !== null) {
          if (gist.id !== instanceId) return;
          if (gist.files === 0) {
            clearSilence();
            failedHref = typeof current.attrs.href === 'string' ? current.attrs.href : '';
            render(current);
            return;
          }
          answered = true;
          clearSilence();
          frame.style.height = `${gist.height}px`;
          return;
        }
        if (event.origin !== X_ORIGIN) return;
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

      // Asks, because the frame may have announced before this listener existed (§18.5).
      const ask = () => iframe.contentWindow?.postMessage(gistAsk(), '*');
      iframe.addEventListener('load', ask);

      // Started by visibility, never by load (§10.5); once seen is enough.
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

      // What `stopEvent` claims, paired with its drop refusal as in the link card.
      const claimsEvent = (target: HTMLElement) => target.closest('button') !== null;
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
        destroy: () => {
          iframe.removeEventListener('load', ask);
          window.removeEventListener('message', onMessage);
          observer.disconnect();
          clearSilence();
        },
        // The button only: claiming the whole block swallows the NodeSelection mousedown
        // (docs/editor-pitfalls.md §18).
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
      setEmbed: (href: string) => ReturnType;
      openInsertDialog: (at?: number) => ReturnType;
      unsetEmbed: (at?: number) => ReturnType;
    };
  }
}
