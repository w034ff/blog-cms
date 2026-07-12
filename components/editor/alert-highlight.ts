import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

type AlertType = 'note' | 'warning' | 'caution';

// Parallels lib/remark-github-alerts.ts (the render-side transform): the marker
// must sit alone on the blockquote's first line. Kept as a local copy so this
// client extension never imports the server-only render module.
const MARKER = /^\[!(note|warning|caution)\][^\S\n]*(?:\n|$)/i;

function alertTypeOf(blockquote: ProseMirrorNode): AlertType | null {
  const paragraph = blockquote.firstChild;
  if (!paragraph || paragraph.type.name !== 'paragraph') return null;
  // ProseMirror text nodes never hold newlines, so the marker is its own text
  // node — matching it (not the whole paragraph) means "[!NOTE] text" on one
  // line correctly fails, just like the render-side transform.
  const firstInline = paragraph.firstChild;
  if (!firstInline || !firstInline.isText || !firstInline.text) return null;
  const match = firstInline.text.match(MARKER);
  return match ? (match[1].toLowerCase() as AlertType) : null;
}

function buildDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'blockquote') return true;
    const type = alertTypeOf(node);
    if (type) {
      // Reuse the public callout classes so the editor picks up the exact same
      // per-type colors from globals.css.
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, {
          class: `markdown-alert markdown-alert-${type}`,
        }),
      );
    }
    return true;
  });
  return DecorationSet.create(doc, decorations);
}

// Editor-only live tint for GitHub-style alert callouts: colors a blockquote
// whose first line is `[!NOTE]` / `[!WARNING]` / `[!CAUTION]` (the same 3-tier
// set the render transform styles). It is a *decoration*, not a node — the
// stored markdown and its
// round-trip are untouched. Approximate preview by design: the `[!NOTE]` marker
// stays visible and no title label is injected (the render-side transform adds
// those on the published page).
export const AlertHighlight = Extension.create({
  name: 'alertHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('alertHighlight'),
        props: {
          decorations(state) {
            return buildDecorations(state.doc);
          },
        },
      }),
    ];
  },
});
