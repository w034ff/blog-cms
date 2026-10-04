import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { Markdown, type MarkdownStorage } from 'tiptap-markdown';
import { MarkdownTable, ParagraphTableCell, ParagraphTableHeader } from './table-extensions';
import { Callout } from './callout-extension';
import {
  MarkdownDetails,
  MarkdownDetailsContent,
  MarkdownDetailsSummary,
} from './details-extension';
import { DropCursorGuard } from './drop-cursor-guard';
import { IsolatingBoundary } from './isolating-boundary';
import { LinkHighlight } from './link-highlight-extension';
import { ThumbnailHighlight } from './thumbnail-highlight-extension';
import { ImageCaption } from './image-caption-extension';
import { LinkInputRule } from './link-input-rule';
import { Link } from './link-extension';
import { LinkPasteParagraphGuard } from './link-paste-paragraph-guard';
import { SpeakerdeckSnippetPaste } from './speakerdeck-snippet-paste';
import { Blockquote } from './blockquote-extension';
import { TrailingNode } from './trailing-node-extension';
import { Image } from './image-extension';
import { LinkCard, type LinkCardStorage } from './link-card-extension';
import { Embed } from './embed-extension';
import { AccentEmphasis } from './accent-emphasis-extension';
import { FootnoteLiteral } from './footnote-literal-extension';
import {
  Document,
  FootnoteDefinition,
  FootnoteReference,
  FootnoteSection,
} from './footnote-extension';
import { isPublishableUri } from './link-protocols';
import { Bold, Italic, Strike, Code } from './guarded-toggle-marks';
import { Heading, BulletList, OrderedList } from './guarded-block-toggles';
import { SlashCommand } from './slash-command';
import { CodeBlockWithLanguage } from './code-block-extension';
import { ClearNodes } from './clear-nodes-extension';
import { BlockDragHandle } from './block-drag-handle';
import { Summary, SummaryGood, SummaryBad, Tldr } from './summary-extension';

// tiptap-markdown ships no type augmentation for its `markdown` storage, so it is registered here.
declare module '@tiptap/core' {
  interface Storage {
    markdown: MarkdownStorage;
    // The link card's, for the slug of the post being edited, which PostEditor writes
    // (docs/link-card-requirements.md §18).
    linkCard: LinkCardStorage;
  }
}

// Everything the post editor's schema and plugin set is made of. Kept out of PostEditor.tsx, which
// owns the form and the publish/autosave state.
//
// **The order is load-bearing.** ExtensionManager reverses the array before gathering plugins, so
// a later entry is asked first (priority still sorts ahead of position). Add in the place the
// neighbouring comments describe, not at the end.
//
// `showNotice` is the single refusal notice every guard reports through.
export function postEditorExtensions(showNotice: (message: string) => void): Extensions {
  return [
    // StarterKit's own versions are turned off wherever a local replacement is registered below
    // (see each replacement's file). `underline` is off outright: it had no button, and
    // rehype-sanitize (lib/render.ts) drops a bare <u>, so it silently vanished on publish.
    StarterKit.configure({
      heading: false,
      bulletList: false,
      orderedList: false,
      codeBlock: false,
      blockquote: false,
      bold: false,
      italic: false,
      strike: false,
      code: false,
      underline: false,
      trailingNode: false,
      document: false,
      link: false,
    }),
    // `openOnClick: false`, or a click opens the URL and the caret can never be placed in a link;
    // the link card hands "open" back. autolink and linkOnPaste keep their defaults
    // (docs/link-requirements.md §3, §4). `isAllowedUri`: link-protocols.ts.
    Link.configure({
      openOnClick: false,
      isAllowedUri: (url, ctx) => isPublishableUri(url, ctx.defaultValidate),
    }),
    // Ordered ahead of Link by its own priority, not by this position.
    LinkPasteParagraphGuard,
    Document,
    // Beside Document because it answers for Document's content expression.
    ClearNodes,
    TrailingNode,
    // Table and cell nodes are replaced by table-extensions.ts.
    TableKit.configure({ table: false, tableCell: false, tableHeader: false }),
    // allowTableNodeSelection: otherwise `normalizeSelection` coerces a table NodeSelection into a
    // CellSelection, and the drag handle's "picked up" highlight flickers. Cosmetic only.
    MarkdownTable.configure({ allowTableNodeSelection: true, onBlocked: showNotice }),
    ParagraphTableCell,
    ParagraphTableHeader,
    DropCursorGuard,
    // **Position is load-bearing:** above Callout, so the callout guard's handlePaste (first-wins)
    // sees a callout-carrying slice first; and in this array at all, so its keys beat the core
    // Keymap's deleteSelection.
    IsolatingBoundary,
    // Decoration-only; order among them doesn't matter.
    LinkHighlight,
    ThumbnailHighlight,
    ImageCaption,
    LinkInputRule,
    // Image and LinkCard stay above Markdown: their serializers keep them out of tiptap-markdown's
    // raw-HTML fallback.
    Image,
    LinkCard,
    Embed,
    // No priority of its own: Link's pasteHandler never claims a snippet, and ProseMirror's
    // default paste is always last.
    SpeakerdeckSnippetPaste,
    Markdown.configure({ html: true, bulletListMarker: '-', linkify: false, breaks: false }),
    // The backstop for footnote-shaped lines markdown-it-footnote declines, not a leftover.
    FootnoteLiteral,
    // docs/footnote-requirements.md; `Document` above is replaced for `block+ footnoteSection?`.
    FootnoteReference.configure({ onBlocked: showNotice, onNotice: showNotice }),
    FootnoteDefinition.configure({ onBlocked: showNotice }),
    FootnoteSection,
    // まとめ and TL;DR (docs/summary-requirements.md). Ahead of Callout and MarkdownDetails, so their
    // handlePaste is asked first: this guard's paste claims any slice carrying a box, and theirs
    // answer for boxes of their own inside it.
    Summary.configure({ onBlocked: showNotice }),
    SummaryGood,
    SummaryBad,
    Tldr,
    Callout.configure({ onBlocked: showNotice }),
    Blockquote,
    MarkdownDetails.configure({ onBlocked: showNotice }),
    MarkdownDetailsSummary,
    MarkdownDetailsContent,
    SlashCommand,
    CodeBlockWithLanguage,
    BlockDragHandle,
    AccentEmphasis,
    Bold,
    Italic,
    Strike,
    // H2/H3 only: the post title is the page's only H1.
    Heading.configure({ levels: [2, 3] }),
    BulletList,
    OrderedList,
    // No spellcheck squiggles on code tokens.
    Code.configure({ HTMLAttributes: { spellcheck: 'false' } }),
  ];
}
