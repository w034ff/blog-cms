import type { Root, Blockquote, Paragraph, Text } from 'mdast';
import { visit } from 'unist-util-visit';
// Pulls in the Data augmentation (hName/hProperties/hChildren) that
// mdast-util-to-hast adds, so setting node.data.hName below type-checks.
import type {} from 'mdast-util-to-hast';
import {
  CALLOUT_CLASS,
  CALLOUT_CONTENT_CLASS,
  CALLOUT_MARKER_LINE,
  CALLOUT_TITLE_CLASS,
  CALLOUT_TITLE_LABEL_CLASS,
  CALLOUT_TITLES,
  calloutTypeClass,
  toCalloutType,
} from './callout-types';

// GitHub-flavored alerts (a.k.a. admonitions): a blockquote whose first line is
// `[!NOTE]` / `[!WARNING]` / `[!CAUTION]` renders as a styled callout. The tier set, the
// Japanese labels, the marker pattern and the class names all come from lib/callout-types.ts,
// which the editor's own callout node reads too — the two surfaces have to recognise and emit
// exactly the same thing, and the sanitize schema in lib/render.ts has to allow it.
// remark-gfm does NOT implement this, so this local transform
// does it on the mdast — no new dependency. It rewrites the blockquote to a
// `<div class="markdown-alert markdown-alert-<type>">` (GitHub's class names) with
// a `<p class="markdown-alert-title">` label prepended; the CSS in globals.css
// paints the border/tint per type. Operating on the parsed tree (not raw source)
// means it's robust to how the markdown was escaped on the way in.

function isParagraph(node: Blockquote['children'][number]): node is Paragraph {
  return node.type === 'paragraph';
}

function isText(node: Paragraph['children'][number]): node is Text {
  return node.type === 'text';
}

export function remarkGithubAlerts() {
  return (tree: Root): void => {
    visit(tree, 'blockquote', (node: Blockquote) => {
      const firstBlock = node.children[0];
      if (!firstBlock || !isParagraph(firstBlock)) return;
      const firstInline = firstBlock.children[0];
      if (!firstInline || !isText(firstInline)) return;

      const match = firstInline.value.match(CALLOUT_MARKER_LINE);
      if (!match) return;
      const type = toCalloutType(match[1].toLowerCase());

      // Strip the marker line from the content. If text remains after it (content
      // shared the first line via a soft break), keep it; otherwise drop the now
      // marker-only text node — and the paragraph too if that emptied it.
      const remainder = firstInline.value.slice(match[0].length);
      if (remainder.length > 0) {
        firstInline.value = remainder;
      } else {
        firstBlock.children.shift();
        // A hard break the author put right after the marker (Shift+Enter in the
        // WYSIWYG editor) would otherwise leave a leading <br> inside the callout;
        // drop any leading breaks so Enter and Shift+Enter both render clean.
        while (firstBlock.children[0]?.type === 'break') firstBlock.children.shift();
        if (firstBlock.children.length === 0) node.children.shift();
      }

      // Build the icon/title column, wrap the body in a content column, then render
      // the blockquote as the 2-column alert container (icon | content — globals.css).
      // The type word goes in a visually-hidden <span>: the CSS ::before icon on
      // .markdown-alert-title carries the meaning on screen (icon-only, like
      // Zenn/Qiita), while screen readers still announce the callout type from the
      // sr-only label. The `emphasis` node is only a carrier for the hName/
      // hProperties override — mdast-util-to-hast emits it as the <span>, not <em>.
      const title: Paragraph = {
        type: 'paragraph',
        data: { hProperties: { className: [CALLOUT_TITLE_CLASS] } },
        children: [
          {
            type: 'emphasis',
            data: {
              hName: 'span',
              hProperties: { className: [CALLOUT_TITLE_LABEL_CLASS] },
            },
            children: [{ type: 'text', value: CALLOUT_TITLES[type] }],
          },
        ],
      };
      // The body becomes a content column beside the icon. `blockquote` is only a
      // carrier for the hName override — emitted as <div class="markdown-alert-content">.
      const content: Blockquote = {
        type: 'blockquote',
        data: { hName: 'div', hProperties: { className: [CALLOUT_CONTENT_CLASS] } },
        children: node.children,
      };
      node.children = [title, content];
      node.data = {
        ...node.data,
        hName: 'div',
        hProperties: { className: [CALLOUT_CLASS, calloutTypeClass(type)] },
      };
    });
  };
}
