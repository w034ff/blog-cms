import type { Root, Blockquote, Paragraph, Text } from 'mdast';
import { visit } from 'unist-util-visit';
// Pulls in the Data augmentation (hName/hProperties/hChildren) that
// mdast-util-to-hast adds, so setting node.data.hName below type-checks.
import type {} from 'mdast-util-to-hast';

// GitHub-flavored alerts (a.k.a. admonitions): a blockquote whose first line is
// `[!NOTE]` / `[!WARNING]` / `[!CAUTION]` renders as a styled callout. We scope to
// this 3-tier severity set (情報 → 警告 → 注意) to match the Zenn/Qiita convention;
// GitHub's `[!TIP]` / `[!IMPORTANT]` are intentionally left as plain blockquotes.
// remark-gfm does NOT implement this, so this local transform
// does it on the mdast — no new dependency. It rewrites the blockquote to a
// `<div class="markdown-alert markdown-alert-<type>">` (GitHub's class names) with
// a `<p class="markdown-alert-title">` label prepended; the CSS in globals.css
// paints the border/tint per type. Operating on the parsed tree (not raw source)
// means it's robust to how the markdown was escaped on the way in.
type AlertType = 'note' | 'warning' | 'caution';

// Japanese labels shown as the callout title (the site UI is Japanese).
const TITLES: Record<AlertType, string> = {
  note: '情報',
  warning: '警告',
  caution: '注意',
};

// Marker must sit alone on the blockquote's first line (GitHub's rule): the type
// tag, optional trailing spaces, then a newline or the end of the text.
const MARKER = /^\[!(note|warning|caution)\][^\S\n]*(?:\n|$)/i;

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

      const match = firstInline.value.match(MARKER);
      if (!match) return;
      const type = match[1].toLowerCase() as AlertType;

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
        data: { hProperties: { className: ['markdown-alert-title'] } },
        children: [
          {
            type: 'emphasis',
            data: {
              hName: 'span',
              hProperties: { className: ['markdown-alert-title-label'] },
            },
            children: [{ type: 'text', value: TITLES[type] }],
          },
        ],
      };
      // The body becomes a content column beside the icon. `blockquote` is only a
      // carrier for the hName override — emitted as <div class="markdown-alert-content">.
      const content: Blockquote = {
        type: 'blockquote',
        data: { hName: 'div', hProperties: { className: ['markdown-alert-content'] } },
        children: node.children,
      };
      node.children = [title, content];
      node.data = {
        ...node.data,
        hName: 'div',
        hProperties: { className: ['markdown-alert', `markdown-alert-${type}`] },
      };
    });
  };
}
