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

// tiptap-markdown adds a `markdown` storage exposing getMarkdown(), but ships no type
// augmentation for it — register it here, beside the extension that installs it, so
// editor.storage.markdown is typed for every reader (PostEditor's onUpdate is the one that
// serializes the body back to markdown).
declare module '@tiptap/core' {
  interface Storage {
    markdown: MarkdownStorage;
    // The link card's, for the one field PostEditor writes into it: the slug of the post being
    // edited (§18). Declared beside markdown's for the same reason — the host reads
    // `editor.storage.linkCard` and nothing else would type it.
    linkCard: LinkCardStorage;
  }
}

// Everything the post editor's ProseMirror schema and plugin set is made of, in one list.
//
// It lives here rather than inline in PostEditor.tsx because it answers a different question
// from everything else in that component: PostEditor owns the post's form and its
// publish/autosave state machine, while this owns what the *document* can contain and which
// plugin is asked first. The two changed for unrelated reasons and the array had grown to
// roughly half the file.
//
// **The order is load-bearing and this list is the record of it.** ExtensionManager reverses
// the array before gathering plugins, so a later entry is asked first — several of the notes
// below depend on that, IsolatingBoundary's most explicitly. Add to it in the place the
// neighbouring comments describe, not at the end.
//
// `showNotice` is the whole of the outside world this needs: one refusal notice, owned by
// PostEditor so two refusals cannot raise two toasts, handed to every guard that can turn a
// gesture down.
export function postEditorExtensions(showNotice: (message: string) => void): Extensions {
  return [
    // heading/bulletList/orderedList are replaced by the guarded versions below (same
    // nodes, but they refuse to convert a code block into prose — see
    // guarded-block-toggles.ts), so disable StarterKit's own to avoid a double
    // registration. Heading keeps its level restriction there rather than here.
    // codeBlock is replaced by CodeBlockWithLanguage (adds an in-editor language
    // picker); disable StarterKit's so the `codeBlock` node isn't registered twice.
    // blockquote is likewise replaced by our Blockquote (StarterKit's copy bundles a
    // duplicate prosemirror-state whose Backspace join breaks `instanceof` — see
    // blockquote-extension.ts), so disable it here to avoid a double registration.
    // underline is disabled outright: it had no toolbar button (reachable only via the
    // undocumented Mod-u), and rehype-sanitize's schema (lib/render.ts) doesn't allow a
    // bare <u> tag, so it silently vanished on publish — a WYSIWYG lie with no UI to fix.
    // bold/italic/strike/code are replaced by the guarded versions below (same behavior,
    // but toggling one that's excluded by accentEmphasis is a true no-op — see
    // guarded-toggle.ts), so disable StarterKit's own to avoid a double registration.
    // trailingNode is replaced by ours below: same appended paragraph, but it waits while a
    // just-fired input rule can still be undone, so Backspace after a block shortcut typed at
    // the end of the document restores what was typed — see trailing-node-extension.ts.
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
      // document is replaced by ours: the same top node, but its content expression admits the
      // footnote definitions' section as an optional last child — see footnote-extension.ts.
      document: false,
      // link is replaced by ours below: the same extension with the mark made non-inclusive, so
      // the 。 typed after a link stays out of it — see editor/link-extension.ts.
      link: false,
    }),
    // Kept (it is what makes a pasted URL a link) but must not open on click: the default sends a
    // left click to window.open, so a link inside the editor could not be clicked into and the
    // caret could never be placed in it — the text was uneditable and, with no toolbar control
    // for links either, unremovable. Only these two options are overridden, so autolink keeps its
    // default (docs/link-requirements.md §3, §4); linkOnPaste keeps its default too, but is now
    // narrowed to a single-paragraph selection by the guard below.
    // What this gave up — "open this link" from inside the editor — is handed back by the link
    // card (editor/LinkBubble.tsx), which the caret placement this enables is what triggers.
    //
    // isAllowedUri narrows the schemes a link may use to the ones the public sanitizer will
    // actually publish — see editor/link-protocols.ts for which six drop out and why the gap
    // is closed at this end.
    Link.configure({
      openOnClick: false,
      isAllowedUri: (url, ctx) => isPublishableUri(url, ctx.defaultValidate),
    }),
    // Heads off Link's own pasteHandler for a selection spanning more than one paragraph — position
    // in this array doesn't secure that (Link's mark carries `priority: 1000`, which beats array
    // order outright), so the extension itself carries a higher priority. See
    // link-paste-paragraph-guard.ts.
    LinkPasteParagraphGuard,
    Document,
    // Directly under Document because it exists to answer for Document's content expression:
    // `block+ footnoteSection?` makes `ContentMatch.defaultType` return `footnoteSection` past
    // the first child, and TipTap's own `clearNodes` takes that unchecked and throws. Replaces
    // the command with upstream's body picking a *textblock* instead — see
    // clear-nodes-extension.ts. Reachable as Mod-Alt-0 on almost any line of a post.
    ClearNodes,
    TrailingNode,
    // TableKit bundles the table/cell nodes too, but we replace them: MarkdownTable
    // (same node, extended to serialize column alignment) and the paragraph-only
    // cells (markdown can't store block structure inside a cell), so disable its own.
    TableKit.configure({ table: false, tableCell: false, tableHeader: false }),
    // allowTableNodeSelection: prosemirror-tables' tableEditing() otherwise coerces any
    // NodeSelection wrapping a whole `table` into a CellSelection spanning it (an
    // appendTransaction — see its normalizeSelection). BlockDragHandle's drag itself no longer
    // depends on this — it captures the node/range directly at mousedown, so a coerced selection
    // wouldn't break the move — but without this flag the table's "picked up" highlight would
    // flicker from a clean NodeSelection into a CellSelection the instant you grab its handle.
    // Purely cosmetic now; kept for that visual consistency.
    MarkdownTable.configure({ allowTableNodeSelection: true, onBlocked: showNotice }),
    ParagraphTableCell,
    ParagraphTableHeader,
    DropCursorGuard,
    // Keeps a ranged edit (Backspace/Delete over a selection, typing or pasting over one) from
    // closing over a callout's or code block's edge — `isolating` only guards where a slice may
    // be *placed*, not what a replacement joins. See isolating-boundary.ts.
    //
    // Its position here is load-bearing, in both directions. ExtensionManager reverses this array
    // before gathering plugins, so a later entry is asked first: it must stay *above* Callout, so
    // that guard's handlePaste still gets a callout-carrying slice first (handlePaste is
    // first-wins), and it must stay in this array at all, so its keys beat the core Keymap
    // extension's baseKeymap deleteSelection.
    IsolatingBoundary,
    // A decoration-only store: it paints whatever range the link card pushes into it, so the text
    // the card is about is visibly the text the card is about. No keys, no commands, no schema —
    // order among the others doesn't matter. See link-highlight-extension.ts.
    LinkHighlight,
    // A decoration-only store, same shape as LinkHighlight above: rings whichever image node's
    // `src` matches the post's chosen thumbnail. See thumbnail-highlight-extension.ts.
    ThumbnailHighlight,
    // Decoration-only as well: marks the paragraph after an image when it is nothing but italic
    // text, which is what the published pipeline turns into a `<figcaption>`. See
    // image-caption-extension.ts and lib/rehype-image-caption.ts — the two must agree.
    ImageCaption,
    // `[text](url)` typed in the editor becomes a link. Sits outside the Link configuration above
    // because extension-link has no input rules of its own — see link-input-rule.ts and
    // docs/link-requirements.md §5.4.
    LinkInputRule,
    // Replaces the bare @tiptap/extension-image: same node, but its markdown serializer closes
    // the block, so a quote/fence right after an image isn't glued onto the image's line —
    // see image-extension.ts.
    Image,
    // A post of your own shown as a card instead of a line of link text. Stores only the
    // reference (`<div class="link-card" data-href>`), so the title comes from `posts` at render
    // time on both sides — see docs/link-card-requirements.md and lib/rehype-link-card.ts.
    // Must be registered above Markdown for the same reason Image is: its serializer is what
    // keeps the card out of tiptap-markdown's raw-HTML fallback.
    //
    // Which post it refuses to point at is not decided here: `editor.storage.linkCard.ownSlug`
    // carries that, because the post being edited may not have a slug yet when this list is built
    // (§18, and see the extension's own note).
    LinkCard,
    Embed,
    // Beside Embed because it is the one thing that makes one out of a paste (§16.9), and after it
    // because the command it calls is Embed's. No priority of its own: the snippet is not a bare
    // URL, so Link's own pasteHandler never claims it, and the only handler it has to run ahead of
    // is ProseMirror's default paste — which is always last.
    SpeakerdeckSnippetPaste,
    Markdown.configure({ html: true, bulletListMarker: '-', linkify: false, breaks: false }),
    // The backstop under the footnote nodes below, not a leftover from before them. Every
    // definition markdown-it-footnote accepts is claimed before this is asked; what it still
    // catches is the shapes the plugin declines — a label containing a space among them — which
    // `reference` would otherwise take as a link reference definition, turning the note's words
    // into a URL. See footnote-literal-extension.ts.
    FootnoteLiteral,
    // Footnotes (docs/footnote-requirements.md). The reference lives in the prose, the
    // definitions in one section pinned to the end of the document, and `Document` above is
    // replaced only to say that in the schema (`block+ footnoteSection?`, §3.2).
    // FootnoteLiteral above is not in competition with these: markdown-it-footnote registers
    // footnote_def *before* the `reference` rule it patches, so it is only ever asked about the
    // lines the plugin refused (§7.2).
    FootnoteReference.configure({ onBlocked: showNotice, onNotice: showNotice }),
    FootnoteDefinition.configure({ onBlocked: showNotice }),
    FootnoteSection,
    // GitHub-style alert callouts as a real node: the `[!NOTE]` marker shows as a
    // non-editable label chip and only the body is editable, so it can't be broken
    // by typing after the `]`. Serializes back to `> [!TYPE]` markdown, so storage
    // and the public render pipeline are unchanged. `onBlocked` is the same reporter the table
    // guards use: a drop carrying a callout into a quote or another callout is refused, and a
    // refused gesture changes nothing, so the notice is the whole of the feedback.
    Callout.configure({ onBlocked: showNotice }),
    // Replaces StarterKit's blockquote (disabled above): same node/input rule/commands, but
    // its Backspace join uses the canonical TextSelection so the caret survives `instanceof`.
    Blockquote,
    // Zenn-style folding block, stored as raw `<details>`/`<summary>` HTML (markdown has no
    // syntax for it — see docs/accordion-requirements.md). `onBlocked` is the shared notice: a
    // drop carrying an accordion into a quote, list, callout or cell is refused, and a refused
    // gesture changes nothing, so the message is the whole of the feedback.
    MarkdownDetails.configure({ onBlocked: showNotice }),
    MarkdownDetailsSummary,
    MarkdownDetailsContent,
    // `/` at the start of a line opens a small block-insert menu (callouts + code block);
    // choosing a row deletes the `/query` and runs that block's command.
    SlashCommand,
    // Plain code block + an editor-only language <select> (drives Shiki highlighting on
    // the public page); the `language` attribute still round-trips as a ```lang fence.
    CodeBlockWithLanguage,
    // Hover-revealed left-gutter grip on blockquotes/callouts/images/tables/code blocks:
    // click-drag the whole block to reorder it. Editor-only chrome, no markdown/model impact.
    BlockDragHandle,
    // Bold + the site's red accent as one toggle ("強調"). No native markdown syntax, so it
    // round-trips as raw `<span class="accent-emphasis">` (safe under this Markdown
    // extension's `html: true` above) — see accent-emphasis-extension.ts.
    AccentEmphasis,
    // Guarded replacements for StarterKit's bold/italic/strike (disabled above) — see
    // guarded-toggle-marks.ts and guarded-toggle.ts.
    Bold,
    Italic,
    Strike,
    // Guarded replacements for StarterKit's heading/bulletList/orderedList (disabled above):
    // same nodes, but each refuses inside a code block instead of shredding it into prose —
    // see guarded-block-toggles.ts. Body headings stay limited to the two levels the toolbar
    // exposes (大見出し = H2, 小見出し = H3): the post title is the page's only H1, so this
    // also stops a stray `# `/`#### ` markdown shortcut from injecting an H1/H4+.
    Heading.configure({ levels: [2, 3] }),
    BulletList,
    OrderedList,
    // Turn off the browser's native spellcheck for inline `code` marks — code tokens aren't
    // dictionary words, so it paints them with red squiggles (the code block's <code> is
    // likewise opted out in CodeBlockWithLanguage). Prose keeps spellcheck.
    Code.configure({ HTMLAttributes: { spellcheck: 'false' } }),
  ];
}
