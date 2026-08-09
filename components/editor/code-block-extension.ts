import { textblockTypeInputRule } from '@tiptap/core';
import type { CommandProps, Editor, InputRule } from '@tiptap/core';
import { CodeBlock } from '@tiptap/extension-code-block';
import type { Node as PMNode, NodeType } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorState } from '@tiptap/pm/state';
import { stepIntoNextIsolating, stepIntoPreviousIsolating } from './isolating-boundary';
import type { MarkdownSerializerState } from './markdown-serializer-state';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    codeBlockInsert: {
      // Put a code block at the caret: convert the current paragraph where that is legal, or add
      // one as the next block of its parent where it is not (a list item). See its comment.
      insertCodeBlock: () => ReturnType;
    };
  }
}

// Whether an empty code block may be added as the caret's textblock's *next sibling* — the
// question `setCodeBlock` never asks, because converting is all it does.
//
// A list item is the case this exists for: `listItem` is `paragraph block*`, so a code block is
// legal there but only from the second child on, and converting the first paragraph would leave
// the item headless. A table cell answers false and must keep doing so — ParagraphTableCell is
// `paragraph+`, and a code block in a cell has no GFM pipe form (table-extensions.ts).
function canPlaceAfterCaret(state: EditorState, type: NodeType): boolean {
  const { $from, empty } = state.selection;
  // Only for a caret: with a range, "after the textblock" is not where the author is pointing.
  if (!empty || $from.depth < 1) return false;
  const parent = $from.node($from.depth - 1);
  const index = $from.index($from.depth - 1);
  return parent.canReplaceWith(index + 1, index + 1, type);
}

// Curated language menu for the in-editor code block. The ids are Shiki language ids
// (the public render pipeline highlights via rehype-pretty-code → Shiki, lib/render.ts),
// so what you pick here is exactly what gets highlighted on the published page. The empty
// id means "no language": it stores `language: null`, which serializes to a plain ``` fence,
// preserving the pre-existing behaviour. The dropdown also covers ids the ` ```lang ` typing
// rule can't produce — it only captures `[a-z]+`, so `cpp` (C++) and `csharp` (C#) are
// reachable only here.
const CODE_LANGUAGES: readonly { id: string; label: string }[] = [
  { id: '', label: 'Plain Text' },
  { id: 'bash', label: 'Bash' },
  { id: 'shell', label: 'Shell' },
  { id: 'js', label: 'JavaScript' },
  { id: 'ts', label: 'TypeScript' },
  { id: 'jsx', label: 'JSX' },
  { id: 'tsx', label: 'TSX' },
  { id: 'json', label: 'JSON' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
  { id: 'scss', label: 'SCSS' },
  { id: 'python', label: 'Python' },
  { id: 'go', label: 'Go' },
  { id: 'rust', label: 'Rust' },
  { id: 'java', label: 'Java' },
  { id: 'kotlin', label: 'Kotlin' },
  { id: 'swift', label: 'Swift' },
  { id: 'c', label: 'C' },
  { id: 'cpp', label: 'C++' },
  { id: 'csharp', label: 'C#' },
  { id: 'php', label: 'PHP' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'sql', label: 'SQL' },
  { id: 'yaml', label: 'YAML' },
  { id: 'toml', label: 'TOML' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'dockerfile', label: 'Dockerfile' },
  { id: 'graphql', label: 'GraphQL' },
];

// Normalize a string-or-null attribute to a plain string ('' when absent).
function stringAttr(value: string | null | undefined): string {
  return typeof value === 'string' ? value : '';
}

// The filename ends up in the ```lang:filename fence's info string, and only `[^\s`]+` survives
// a round trip through it — the same class the input rules above capture, but the NodeView's text
// field enforced nothing, so both failures were reachable by typing:
//   - whitespace truncated the name at the next *load*, not at the edit. markdown-it folds only
//     the info string's first token into the language class (```ts:a b arrives as
//     `language-ts:a`), so updateCodeBlockDOM read the filename back as `a` and " b" was gone.
//   - a backtick is illegal in a backtick fence's info string, so the fence stopped parsing as a
//     fence at all: the code spilled out as literal paragraph text and an empty block was left
//     behind.
// Both looked correct until the post was reopened, which is what made them worth closing at the
// field rather than at the serializer.
//
// Dropping those characters rather than truncating at the first one keeps the part that carries
// the meaning — `my file.ts` becomes `myfile.ts`, not `my`. Callers write the result back into
// the field so the correction is visible: a silent repair here would be the same
// looks-right-until-reload shape as the bug.
function sanitizeFilename(value: string): string {
  return value.replace(/[\s`]+/g, '');
}

// A form id that intentionally matches no <form> element, used to orphan the NodeView's
// header controls from PostEditor's form (see the NodeView for why).
const DETACHED_FORM_ID = 'code-block-detached-controls';

// The fence text a just-fired code block input rule consumed, tracked so Backspace can
// restore it. TipTap has this natively (undoInputRule), but its bookkeeping is wiped by any
// appended transaction that changes the doc — and StarterKit's TrailingNode appends exactly
// such a transaction whenever the block is created at the end of the document (the common
// case: typing a fence at the bottom of the post). The plugin in addProseMirrorPlugins keeps
// this record alive while — and only while — the caret still sits inside the still-empty
// code block the rule just created, which TrailingNode's paragraph append doesn't disturb.
type FenceUndo = { pos: number; text: string };

const fenceUndoKey = new PluginKey<FenceUndo | null>('codeBlockFenceUndo');

// Mirrors the public render pipeline's diff rules on any code block with `diff: true`
// (independent of `language`, which is now just the underlying Shiki grammar). There's no
// per-line node to decorate (a code block's lines are just \n characters inside one text node),
// so this wraps each line's text — not the trailing \n — in an inline decoration; the class's
// styling then covers exactly the line's own characters (see the CSS in app/globals.css for why
// that reads as a full row in practice). The two rules, each matched separately against Shiki's
// actual output on the public page:
// 1. Text color (diff-text-*): only for blocks with NO real language, where the public page
//    highlights with Shiki's own `diff` grammar and its markup.inserted/deleted scopes color
//    every +/- led line — including +++/--- file headers. With a real language (```diff_ts),
//    the public page tokenizes with that grammar instead, so green/red text here would show
//    something publishing never does.
// 2. Row background (diff-line-*, lib/shiki-diff-line-transformer.ts — added because Shiki
//    only colors the text): +/- content lines of every diff block, language or not; the
//    transformer excludes +++/--- there too.
const diffHighlightKey = new PluginKey<DecorationSet>('codeBlockDiffHighlight');

function diffLineDecorations(doc: PMNode, codeType: NodeType): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type !== codeType || !node.attrs.diff) return;
    const hasLanguage = stringAttr(node.attrs.language) !== '';
    const contentStart = pos + 1;
    let offset = 0;
    for (const line of node.textContent.split('\n')) {
      if (line.length > 0 && (line.startsWith('+') || line.startsWith('-'))) {
        const sign = line.startsWith('+') ? 'add' : 'remove';
        const isHeader = line.startsWith(line[0].repeat(3));
        const classes: string[] = [];
        if (!hasLanguage) classes.push(`diff-text-${sign}`);
        if (!isHeader) classes.push(`diff-line-${sign}`);
        if (classes.length > 0) {
          const from = contentStart + offset;
          decorations.push(
            Decoration.inline(from, from + line.length, { class: classes.join(' ') }),
          );
        }
      }
      offset += line.length + 1;
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

// Wrap a fence input rule so the transaction it applies also stamps the matched fence text
// for the fenceUndo plugin. An Enter trigger's trailing "\n" is stripped (it can't live in
// the restored text node); a space trigger stays, matching what the native undo restores.
function undoableFenceRule(config: Parameters<typeof textblockTypeInputRule>[0]): InputRule {
  const rule = textblockTypeInputRule(config);
  const applyRule = rule.handler;
  rule.handler = (props) => {
    const result = applyRule(props);
    if (result !== null) {
      props.state.tr.setMeta(fenceUndoKey, { text: props.match[0].replace(/\n$/, '') });
    }
    return result;
  };
  return rule;
}

// Deleting a code block's final character is normally left to the browser (ProseMirror
// keymaps don't handle mid-text deletes) — but Chrome, after emptying the <code>, folds the
// now-empty <pre> into the contenteditable=false header above and removes pre and code from
// the NodeView entirely. That's a structural change outside the content hole, which
// ignoreMutation used to hide, leaving the view desynced from the model until a reload.
// Handle exactly the emptying deletion in ProseMirror instead, so the DOM never goes empty
// mid-native-edit. (A word/line delete that empties a longer block still hits the native
// path; the NodeView's ignoreMutation lets ProseMirror see and repair that destruction.)
function deleteSoleCodeChar(
  codeType: NodeType,
  dir: -1 | 1,
  { state, dispatch }: CommandProps,
): boolean {
  const { empty, $from } = state.selection;
  const text = $from.parent.textContent;
  // Spread by code points so a sole surrogate-pair character (e.g. an emoji) still counts
  // as "one character" and is deleted whole rather than natively.
  if (!empty || $from.parent.type !== codeType || [...text].length !== 1) return false;
  if ($from.parentOffset !== (dir === -1 ? text.length : 0)) return false;
  if (dispatch) {
    dispatch(state.tr.delete($from.start(), $from.end()).scrollIntoView());
  }
  return true;
}

// Restore the fence text recorded by fenceUndoKey: swap the still-empty code block for a
// paragraph holding the literal fence, caret at its end. False when no live record exists,
// letting Backspace fall through to the inherited behaviour.
function undoFenceTyping(codeType: NodeType, { state, dispatch }: CommandProps): boolean {
  const stored = fenceUndoKey.getState(state);
  if (!stored) return false;
  const node = state.doc.nodeAt(stored.pos);
  if (!node || node.type !== codeType || node.content.size > 0) return false;
  if (dispatch) {
    const paragraph = state.schema.nodes.paragraph.createChecked(
      null,
      stored.text === '' ? undefined : state.schema.text(stored.text),
    );
    const tr = state.tr.replaceWith(stored.pos, stored.pos + node.nodeSize, paragraph);
    tr.setSelection(TextSelection.create(tr.doc, stored.pos + 1 + stored.text.length));
    dispatch(tr.scrollIntoView());
  }
  return true;
}

// Serialize a code block as a Zenn/Qiita-style fence: `language` plus, when set, `:filename`
// (e.g. ```ts:index.ts). Mirrors prosemirror-markdown's default code_block serializer,
// including the dynamic fence length so backtick runs inside the code can't close it early.
// A `diff: true` block writes `diff` (or `diff_<language>`, when a language is also set) as
// the fence's language segment instead of the bare language — the inverse of the `diff`/
// `diff_<lang>` prefix updateCodeBlockDOM strips back out below.
//
// One deliberate departure from the default: the content's *trailing* newline is dropped before
// it is written. A block loaded from markdown always has one — markdown-it's fence content is
// terminated by a newline, so `- 項目 / ```ts / const a = 1 / ``` ` parses to the text
// "const a = 1\n" (a block typed in the editor has no such newline). prosemirror-markdown's
// `text()` splits on \n, so that terminator becomes a final *empty line*, and `write()` prefixes
// every line it emits with the current delimiter — `if (this.delim && this.atBlank())`. At the
// top level the delimiter is "" and nothing shows, which is why this went unnoticed; inside a
// list item, a quote, or a callout it emitted a delimiter-only line ("  " / "> ") between the
// code and the closing fence, and re-parsing read that line back as a blank line of *content*.
// The block therefore grew one blank line per open→save cycle, indefinitely (measured across
// list / quote / callout / nested list; only the top level was stable).
//
// `ensureNewLine()` below writes the terminator back, so dropping it here changes nothing about
// the fence's shape — it only stops the empty line from being routed through `write()`. The one
// visible consequence is that blank lines at the very *end* of a code block are trimmed over the
// next couple of saves rather than preserved; that converges, which the growth did not.
function serializeCodeBlock(state: MarkdownSerializerState, node: PMNode): void {
  const language = stringAttr(node.attrs.language);
  const filename = stringAttr(node.attrs.filename);
  const backticks = node.textContent.match(/`{3,}/g);
  const fence = backticks ? backticks.sort().slice(-1)[0] + '`' : '```';
  const langSegment = node.attrs.diff ? 'diff' + (language ? `_${language}` : '') : language;
  const params = langSegment + (filename ? `:${filename}` : '');
  state.write(fence + params + '\n');
  state.text(node.textContent.replace(/\n$/, ''), false);
  state.ensureNewLine();
  state.write(fence);
  state.closeBlock(node);
}

// Parse hook (runs on markdown-it's HTML before ProseMirror parses it). markdown-it folds
// the whole no-whitespace info string into the language class, so ```ts:index.ts arrives as
// `<code class="language-ts:index.ts">`. Split it: restore the real `language-ts` class (so
// the base `language` attr parses right) and stash the filename on the <pre> as `data-title`
// for the `filename` attr below. A plain ```ts fence has no colon and is left untouched.
//
// Also recognizes a `diff`/`diff_<language>` prefix on the language segment itself (before the
// `:filename` colon, same convention) — e.g. ```diff_ts:index.ts arrives as
// `language-diff_ts:index.ts`. Strips the prefix down to the real language (or no class at all,
// for bare ```diff/```diff_), and stashes a `data-diff` marker on the <pre> for the `diff`
// attr's parseHTML below. This also covers old posts' bare ```diff fences (no colon, no `_lang`),
// which is exactly what lets them load as `language: null, diff: true` with no migration step.
function updateCodeBlockDOM(element: HTMLElement): void {
  element.querySelectorAll('pre > code').forEach((code) => {
    const languageClass = Array.from(code.classList).find((c) => c.startsWith('language-'));
    if (!languageClass) return;
    const value = languageClass.slice('language-'.length);
    const colon = value.indexOf(':');
    let langPart = colon === -1 ? value : value.slice(0, colon);
    const filename = colon === -1 ? '' : value.slice(colon + 1);

    const isDiff = langPart === 'diff' || langPart.startsWith('diff_');
    if (isDiff) langPart = langPart === 'diff' ? '' : langPart.slice('diff_'.length);

    if (!isDiff && colon === -1) return;
    code.classList.remove(languageClass);
    if (langPart) code.classList.add(`language-${langPart}`);
    if (filename) code.parentElement?.setAttribute('data-title', filename);
    if (isDiff) code.parentElement?.setAttribute('data-diff', '');
  });
}

// The `language-*` class value on a <pre>'s first child <code> — what base CodeBlock's
// `language` parseHTML reads ('' when absent). Re-read by both attribute overrides below:
// directly pasted HTML never goes through updateCodeBlockDOM (a markdown-parse-only hook), so
// a `<pre><code class="language-diff">` from an external page (Prism/highlight.js emit exactly
// this) must be folded into `language: null, diff: true` — the same state a ```diff fence
// loads as. Left unfolded, `language: 'diff'` would be a shadow state: undecorated in the
// editor and shown as a stray select entry, yet serialized as a bare ```diff fence that flips
// to diff-on at the next load.
function domLanguage(element: HTMLElement): string {
  const code = element.firstElementChild;
  const languageClass = code
    ? Array.from(code.classList).find((c) => c.startsWith('language-'))
    : undefined;
  return languageClass ? languageClass.slice('language-'.length) : '';
}

// Base CodeBlock ships a paste handler (`codeBlockVSCodeHandler`) that turns *any* clipboard
// carrying VS Code's `vscode-editor-data` flavour into a code block (docs/link-requirements.md
// §2.5, where this was found and measured — a link investigation walked into it). Its whole test
// is "is there
// text, and does the flavour name a language" — it never looks at what was pasted. So copying a
// URL, a word or a sentence out of an editor window produced a code block, and because it runs
// `replaceSelectionWith`, it did so by destroying whatever was selected.
//
// It is replaced rather than dropped: a multi-line paste out of a code editor really is a code
// block, and that flavour is the only place its language can come from. The added condition is
// that the text actually span more than one line — a single line is ambiguous enough that the
// ``` fence and the `/` menu are the better ways to ask for code.
//
// Only reached when the link extension's own paste handler declines, which it does unless the
// selection is non-empty and the pasted text is exactly one URL: `Link` sets `priority: 1000`, and
// ExtensionManager sorts by priority *after* reversing the extension list, so it is asked first
// regardless of array position (see PostEditor's note on ordering, which holds only among equal
// priorities).
const VSCODE_HANDLER_KEY = 'codeBlockVSCodeHandler';

// A PluginKey's name, for identifying someone else's plugin in a list. prosemirror-state stores it
// (suffixed, e.g. 'codeBlockVSCodeHandler$') on the key object but leaves it out of its type
// declarations, so it is read through this narrow shape rather than an `any` cast.
function pluginKeyName(plugin: Plugin): string {
  const key = plugin.spec.key as { key?: string } | undefined;
  return key?.key ?? '';
}

// Whether the pasted text has content on more than one line. A trailing newline is stripped first
// because VS Code's Ctrl+C with nothing selected copies the caret's whole line *including* its
// newline — that is still one line of content, and treating it as multi-line would put the common
// "copy this one line" case straight back into a code block.
function spansMultipleLines(text: string): boolean {
  return text.replace(/\r\n?/g, '\n').trimEnd().includes('\n');
}

// The replacement for the handler described above. Mirrors base CodeBlock's version — same
// language source, same `paste` meta, same post-insert caret fix — with the multi-line condition
// added and the unguarded `JSON.parse` made total (a malformed flavour must fall through to the
// normal paste, not throw inside a DOM event handler).
function vscodeMultilinePastePlugin(type: NodeType, editor: Editor): Plugin {
  return new Plugin({
    key: new PluginKey('codeBlockVSCodeMultilineHandler'),
    props: {
      handlePaste: (view, event) => {
        if (!event.clipboardData) return false;
        if (editor.isActive(type.name)) return false;

        const text = event.clipboardData.getData('text/plain');
        const flavour = event.clipboardData.getData('vscode-editor-data');
        if (!text || !flavour || !spansMultipleLines(text)) return false;

        let language: unknown;
        try {
          language = (JSON.parse(flavour) as { mode?: unknown }).mode;
        } catch {
          return false;
        }
        if (typeof language !== 'string' || !language) return false;

        const { tr, schema } = view.state;
        tr.replaceSelectionWith(
          type.create({ language }, schema.text(text.replace(/\r\n?/g, '\n'))),
        );
        if (tr.selection.$from.parent.type !== type) {
          tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(0, tr.selection.from - 2))));
        }
        tr.setMeta('paste', true);
        view.dispatch(tr);
        return true;
      },
    },
  });
}

// StarterKit's plain CodeBlock, extended so the editor surfaces (and can edit) the block's
// language and filename. The base node (input rule, whitespace handling, etc.) is inherited;
// we add a `filename` attribute, a NodeView with a language <select> + filename field, and a
// markdown round-trip that reads/writes the ```lang:filename fence. Register it in place of
// StarterKit's built-in codeBlock (`StarterKit.configure({ codeBlock: false })`); the node
// name stays `codeBlock`.
export const CodeBlockWithLanguage = CodeBlock.extend({
  // Treat the code block's edges as hard boundaries (like the callout). Without this, Backspace at
  // the start of the block below merges that block's text *into* the code — turning prose into code
  // (and corrupting the stored fence). `isolating` blocks that join; the Backspace shortcut below
  // then steps the caret into the code block's end instead of ProseMirror's node-selection default.
  isolating: true,

  // Keep CodeBlock's own shortcuts (empty → clear on Backspace, exit-on-arrow-down, Mod-Alt-c, …)
  // and only augment Backspace, trying in order:
  // 1. undoInputRule. Extension keymaps run before the core Keymap extension (ExtensionManager
  //    reverses the extension list), so the inherited "empty → clear" handler would consume the
  //    Backspace typed right after a ``` fence conversion (the new block is empty) and the core
  //    escape hatch that restores the literal ```lang:filename text could never fire. Trying it
  //    here first restores that heading/list-like undo; the command only succeeds while the
  //    input rule is the latest transaction, so normal Backspace behaviour is untouched.
  // 2. undoFenceTyping — covers the case native undo can't: a fence typed at the end of the
  //    document, where TrailingNode's appended transaction has already wiped the native record
  //    (see fenceUndoKey).
  // 3. deleteSoleCodeChar — keeps the emptying deletion away from the browser (see its comment);
  //    also bound to Delete and the word-delete chords, where it guards the same case.
  // 4. The inherited handler. 5. The shared isolating-boundary step-in.
  //
  // Delete gets the mirror treatment at the block's *end*: after deleteSoleCodeChar, fall back to
  // stepIntoNextIsolating, which only acts when the following top-level block is empty (deletes
  // it) — a non-empty one is already a safe no-op via `isolating` (see that function's comment),
  // so nothing else is needed here.
  // One entry point for "give me a code block here", because the two that existed disagreed. The
  // `/` menu asks `can().setCodeBlock()` and so offered nothing inside a list item, while the
  // inherited Mod-Alt-c ran `toggleCodeBlock` ungated: it lifted the item out of the list and made
  // its text the code. Neither was a decision about lists — `setCodeBlock` converts the caret's
  // paragraph, and a list item's first child must stay a paragraph, so every route that could only
  // convert was refused there by the schema. Nothing forbade the block itself: `listItem` is
  // `paragraph block*`, and `- 項目\n\n  ```ts …` already loads and round-trips.
  //
  // So convert where converting is legal, and otherwise place the block as the item's next child —
  // which is what the callout and table buttons have always done there. Where the caret sits inside
  // the item decides which branch runs: on its first paragraph there is nothing to convert, so the
  // block is added after it; on a second paragraph `setCodeBlock` converts in place, as anywhere
  // else. The ` ```lang ` input rule is untouched and still only converts, so it stays inert on a
  // first paragraph.
  addCommands() {
    return {
      ...this.parent?.(),
      insertCodeBlock:
        () =>
        ({ can, chain, commands, state }: CommandProps) => {
          if (can().setCodeBlock()) return commands.setCodeBlock();
          if (!canPlaceAfterCaret(state, this.type)) return false;
          const at = state.selection.$from.after(state.selection.$from.depth);
          // insertContentAt rather than insertContent: the latter inserts *at the selection*, which
          // splits the paragraph when the caret is mid-text. `at` is past the whole textblock, so
          // the item keeps one paragraph and gains one block after it.
          return chain()
            .insertContentAt(at, { type: this.name })
            .setTextSelection(at + 1)
            .run();
        },
    };
  },

  addKeyboardShortcuts() {
    const parentShortcuts = this.parent?.();
    const codeType = this.type;
    const deleteSole =
      (dir: -1 | 1) =>
      ({ editor }: { editor: Editor }) =>
        editor.commands.command((props) => deleteSoleCodeChar(codeType, dir, props));
    return {
      ...parentShortcuts,
      // The inherited binding is `toggleCodeBlock`, and inside a fence that is the only keyboard
      // way back out to a paragraph — so keep it for that case and only route the *creating*
      // direction through insertCodeBlock. The `/` menu needs no such split: it is already gated on
      // `!editor.isActive('codeBlock')`.
      'Mod-Alt-c': ({ editor }) =>
        editor.isActive(this.name)
          ? (parentShortcuts?.['Mod-Alt-c']?.({ editor }) ?? false)
          : editor.commands.insertCodeBlock(),
      Backspace: ({ editor }) =>
        editor.commands.undoInputRule() ||
        editor.commands.command((props) => undoFenceTyping(codeType, props)) ||
        deleteSole(-1)({ editor }) ||
        (parentShortcuts?.Backspace?.({ editor }) ?? false) ||
        editor.commands.command((props) => stepIntoPreviousIsolating(codeType, props)),
      Delete: ({ editor }) =>
        deleteSole(1)({ editor }) ||
        editor.commands.command((props) => stepIntoNextIsolating(codeType, props)),
      'Mod-Backspace': deleteSole(-1),
      'Mod-Delete': deleteSole(1),
      'Alt-Backspace': deleteSole(-1),
      'Alt-Delete': deleteSole(1),
    };
  },

  // The base ``` / ~~~ rules, recreated (not inherited) so every fence rule stamps the
  // fence-undo meta, plus a Zenn/Qiita-style ` ```lang:filename ` variant (e.g. ```ts:index.ts)
  // that sets both attrs — the plain backtick rule matches only `[a-z]+`, so a colon made the
  // whole fence fail and left it as literal text. The language is optional (```:memo.txt): the
  // serializer/parser already round-trip that form. The filename must be a single token without
  // backticks — whitespace splits the fence info string and CommonMark forbids backticks in
  // it — matching the NodeView field's trim-to-one-token rule.
  addInputRules() {
    const language = (match: RegExpMatchArray) => ({ language: match[1] });
    // Bare `diff` and `diff_<lang>` both set `diff: true`; the captured letters (if any)
    // become the real `language` — empty/absent means "no language, just diff coloring".
    const diffLanguage = (match: RegExpMatchArray) => ({
      language: match[1] ? match[1] : null,
      diff: true,
    });
    return [
      // Diff-specific rules must come first: a bare ```diff also matches the generic
      // `[a-z]+` rule below (diff reads as a plain "language" to that regex), so these need
      // to win the race for that literal prefix. `diff_<lang>` (contains `_`) never matches
      // the generic rule at all, but it's kept alongside bare `diff` here for one shared
      // `diffLanguage` mapping.
      undoableFenceRule({
        find: /^```diff(?:_([a-z]*))?[\s\n]$/,
        type: this.type,
        getAttributes: diffLanguage,
      }),
      undoableFenceRule({
        find: /^~~~diff(?:_([a-z]*))?[\s\n]$/,
        type: this.type,
        getAttributes: diffLanguage,
      }),
      undoableFenceRule({
        find: /^```diff(?:_([a-z]*))?:([^\s`]+)[\s\n]$/,
        type: this.type,
        getAttributes: (match) => ({
          language: match[1] ? match[1] : null,
          diff: true,
          filename: match[2],
        }),
      }),
      undoableFenceRule({ find: /^```([a-z]+)?[\s\n]$/, type: this.type, getAttributes: language }),
      undoableFenceRule({ find: /^~~~([a-z]+)?[\s\n]$/, type: this.type, getAttributes: language }),
      undoableFenceRule({
        find: /^```([a-z]+)?:([^\s`]+)[\s\n]$/,
        type: this.type,
        getAttributes: (match) => ({ language: match[1], filename: match[2] }),
      }),
    ];
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      // Base CodeBlock's `language`, re-read via domLanguage so 'diff' folds into the `diff`
      // attr below instead of surviving as a literal language (see domLanguage's comment).
      language: {
        default: null,
        rendered: false,
        parseHTML: (element) => {
          const language = domLanguage(element);
          return language === '' || language === 'diff' ? null : language;
        },
      },
      // Round-trips through the `data-title` attribute on the <pre>: updateCodeBlockDOM
      // stashes it when parsing markdown, and renderHTML writes it back out. The write-out
      // matters for in-editor copy/paste — ProseMirror serializes a copied block to clipboard
      // HTML via the schema's renderHTML (never the NodeView DOM), so without it a pasted
      // copy would silently lose the filename. Storage is unaffected (markdown, via
      // serializeCodeBlock's `:filename` suffix).
      filename: {
        default: null,
        // Sanitized here too, not just at the field: markdown-parsed HTML can't carry a bad
        // filename (updateCodeBlockDOM splits it out of a class the fence already tokenized),
        // but *pasted* HTML reaches this hook directly, and an external `<pre data-title="a b">`
        // would otherwise store a name that breaks on the next save.
        parseHTML: (element) => {
          const filename = sanitizeFilename(stringAttr(element.getAttribute('data-title')));
          return filename === '' ? null : filename;
        },
        renderHTML: (attributes: { filename?: string | null }) => {
          const filename = stringAttr(attributes.filename);
          return filename === '' ? {} : { 'data-title': filename };
        },
      },
      // Independent of `language`: whether this block is a manually-authored diff (+/- lines
      // get row/text coloring — see diffLineDecorations). Round-trips through the `data-diff`
      // marker on the <pre> (stashed by updateCodeBlockDOM, written back by renderHTML for
      // the same clipboard reason as `filename`) — or, for pasted external HTML that never
      // met that hook, through a literal language-diff class (see domLanguage); serialized as
      // the `diff`/`diff_<lang>` fence prefix instead of the bare language (see
      // serializeCodeBlock).
      diff: {
        default: false,
        parseHTML: (element) =>
          element.hasAttribute('data-diff') || domLanguage(element) === 'diff',
        renderHTML: (attributes: { diff?: boolean }) =>
          attributes.diff ? { 'data-diff': '' } : {},
      },
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize: serializeCodeBlock,
        parse: { updateDOM: updateCodeBlockDOM },
      },
    };
  },

  // The fence-undo record (see fenceUndoKey). Stored when a fence rule's transaction carries
  // the meta; kept afterwards only while the caret still sits inside the same still-empty
  // code block. TrailingNode's appended paragraph-insert passes that test (it touches nothing
  // before the doc end), while typing in the block, deleting it, or moving the caret out all
  // invalidate the record — so a stale fence can never resurface later.
  addProseMirrorPlugins() {
    const codeType = this.type;
    const parentPlugins = this.parent?.() ?? [];
    // Base CodeBlock's VS Code paste handler, swapped for the multi-line-only one above. Filtered
    // by key rather than by dropping the parent's plugins wholesale, which would also lose
    // anything else the base extension contributes now or later. PluginKey suffixes its name
    // ('codeBlockVSCodeHandler$'), hence the prefix test.
    const withoutVSCodeHandler = parentPlugins.filter(
      (plugin) => !pluginKeyName(plugin).startsWith(VSCODE_HANDLER_KEY),
    );
    if (withoutVSCodeHandler.length === parentPlugins.length) {
      // The key belongs to upstream, so a rename there makes this filter a no-op — and then the
      // base handler is still in the list *and* ours is appended after it, so the unconditional
      // behaviour comes back in full (handlePaste is first-wins and the base plugin comes first).
      // This warning is a breadcrumb, not a guard: e2e/editor-vscode-paste.spec.ts's single-line
      // cases are what actually catch the revert.
      console.warn(
        `[code-block] base CodeBlock plugin '${VSCODE_HANDLER_KEY}' not found — its unconditional "VS Code paste becomes a code block" behaviour is back`,
      );
    }
    return [
      ...withoutVSCodeHandler,
      vscodeMultilinePastePlugin(codeType, this.editor),
      new Plugin({
        key: diffHighlightKey,
        state: {
          init: (_, state: EditorState) => diffLineDecorations(state.doc, codeType),
          apply: (tr, prev) => (tr.docChanged ? diffLineDecorations(tr.doc, codeType) : prev),
        },
        props: {
          decorations: (state) => diffHighlightKey.getState(state),
        },
      }),
      new Plugin({
        key: fenceUndoKey,
        state: {
          init: () => null,
          apply: (tr, prev, _oldState, newState): FenceUndo | null => {
            const meta = tr.getMeta(fenceUndoKey) as { text: string } | undefined;
            const text = meta ? meta.text : prev?.text;
            if (text === undefined) return null;
            const { $from, empty } = newState.selection;
            if (
              !empty ||
              $from.depth === 0 ||
              $from.parent.type !== codeType ||
              $from.parent.content.size > 0
            ) {
              return null;
            }
            const pos = $from.before();
            // On a plain carry-over, the caret must still be in the block recorded (mapped
            // through this transaction) — not in some other empty code block.
            if (!meta && prev && tr.mapping.map(prev.pos) !== pos) return null;
            return { pos, text };
          },
        },
      }),
    ];
  },

  // Vanilla-DOM NodeView (mirrors the Callout node): a contenteditable=false chrome header
  // (filename input + language <select>) sits alongside the editable <code> content hole.
  // The wrapper lives only in the editor view — storage is markdown and the public page
  // renders from that, so this DOM never leaks outside the editor.
  addNodeView() {
    const name = this.name;
    return ({ editor, node, getPos }) => {
      let currentNode = node;

      const dom = document.createElement('div');
      dom.className = 'code-block';

      const header = document.createElement('div');
      header.className = 'code-block-header';
      header.setAttribute('contenteditable', 'false');

      const filenameInput = document.createElement('input');
      filenameInput.type = 'text';
      filenameInput.className = 'code-block-filename';
      // The filename renders as a borderless caption, so the placeholder copy (not a background)
      // is what signals the empty field is an add-a-filename control.
      filenameInput.placeholder = 'ファイル名を追加';
      filenameInput.setAttribute('aria-label', 'コードブロックのファイル名');
      // Filenames aren't dictionary words, so opt this field out of the browser's native
      // spellcheck too (matching the code body <code>) — otherwise `useState.tsx` and the
      // like get red squiggles. The <select> is a picker, so it needs no such opt-out.
      filenameInput.setAttribute('spellcheck', 'false');
      // These chrome controls sit inside PostEditor's single <form>. A server-action submit
      // (投稿/更新) makes React auto-reset that form, which would blank an associated
      // <input>/<select> — the node's attrs survive, but the *displayed* value clears (no
      // ProseMirror transaction fires, so the NodeView never re-syncs). Point their `form` at
      // a non-existent id so they have no form owner: immune to the reset, never submitted.
      filenameInput.setAttribute('form', DETACHED_FORM_ID);

      const select = document.createElement('select');
      select.className = 'code-block-lang';
      select.setAttribute('aria-label', 'コードブロックの言語');
      select.setAttribute('form', DETACHED_FORM_ID);
      for (const { id, label } of CODE_LANGUAGES) {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = label;
        select.appendChild(option);
      }

      // Keep an unknown stored language (e.g. an old post's ```perl) selectable rather
      // than silently snapping it to the first option and losing it on the next edit.
      const ensureOption = (value: string) => {
        if (value === '' || Array.from(select.options).some((o) => o.value === value)) return;
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
      };

      // Diff-display toggle: independent of the language <select>, sits at the header's
      // right edge (after it) as the outermost "control" — matching the header's existing
      // title-fills-left/controls-cluster-right layout. Icon-only; the tip span below is a
      // hover-revealed tooltip built the same way as ToolbarButton's (CSS opacity transition,
      // not the native `title` attribute, which renders with a browser-controlled delay).
      const diffToggle = document.createElement('button');
      diffToggle.type = 'button';
      diffToggle.className = 'code-block-diff-toggle';
      diffToggle.setAttribute('role', 'switch');
      diffToggle.setAttribute('aria-label', '差分表示切り替え');
      const diffToggleTrack = document.createElement('span');
      diffToggleTrack.className = 'code-block-diff-toggle-track';
      diffToggleTrack.appendChild(document.createElement('span')).className =
        'code-block-diff-toggle-thumb';
      diffToggle.appendChild(diffToggleTrack);
      const diffToggleTip = document.createElement('span');
      diffToggleTip.className = 'code-block-diff-toggle-tip';
      diffToggleTip.setAttribute('aria-hidden', 'true');
      diffToggleTip.textContent = '差分表示';
      diffToggle.appendChild(diffToggleTip);

      const sync = () => {
        const language = stringAttr(currentNode.attrs.language);
        ensureOption(language);
        if (select.value !== language) select.value = language;
        // Don't clobber the field mid-edit; only mirror the model when it isn't focused.
        if (document.activeElement !== filenameInput) {
          filenameInput.value = stringAttr(currentNode.attrs.filename);
        }
        diffToggle.setAttribute('aria-checked', String(Boolean(currentNode.attrs.diff)));
      };
      sync();

      // Both writes go through setNodeMarkup at this node's position (getPos), the same
      // way the Callout NodeView commits its type change.
      const setAttr = (attrs: Record<string, string | boolean | null>) => {
        const pos = getPos();
        if (typeof pos !== 'number') return;
        const { state, dispatch } = editor.view;
        dispatch(state.tr.setNodeMarkup(pos, undefined, { ...currentNode.attrs, ...attrs }));
      };

      select.addEventListener('change', () => {
        setAttr({ language: select.value === '' ? null : select.value });
        editor.view.focus();
      });

      // Commit on `change` (blur/Enter), not per keystroke, so filename edits are one
      // transaction. The typed value is normalized to what the fence can actually carry (see
      // sanitizeFilename — the same limitation Zenn/Qiita have) and written back into the field:
      // `sync()` below only mirrors the model while the input is *unfocused*, and Enter fires
      // `change` with focus still here, so without this the field would go on showing a name the
      // document no longer holds.
      filenameInput.addEventListener('change', () => {
        const filename = sanitizeFilename(filenameInput.value);
        if (filenameInput.value !== filename) filenameInput.value = filename;
        setAttr({ filename: filename === '' ? null : filename });
      });

      // Unlike the <select> (one commit per pick, so it hands focus back to the editor), a
      // switch invites repeated activation: keep focus on the button, or a keyboard user's
      // second Space would type a space into the document instead of flipping it back.
      diffToggle.addEventListener('click', () => {
        setAttr({ diff: !currentNode.attrs.diff });
      });

      // Content dragged out of this document must not land in the header's controls. The filename
      // <input> is a natively droppable text control, and `stopEvent` below keeps ProseMirror out
      // of every event over the header — so `eventBelongsToView` stops short of the view and a
      // drop here misses ProseMirror's own drop path entirely: no `handleDrop` prop is consulted
      // (the callout and table guards among them), the dragged range is never removed by a
      // transaction, and Chrome is left to run its default action — which, for a move out of a
      // contenteditable, deletes the source nodes behind ProseMirror's back. A selection spanning
      // the code body and the prose around it meets all of that at once.
      //
      // Cancelling dragover takes the drop away from the input's native handling, `dropEffect =
      // 'none'` marks it refused (which is what shows the no-drop cursor — the only feedback the
      // gesture gets, the same role hiding the drop indicator plays for the callout guard), and
      // `drop` is cancelled as well. All three together; the refusal was verified end to end rather
      // than attributed to one of them.
      //
      // Gated on `view.dragging`, which prosemirror-view sets only while content from this
      // document is being dragged. A file dragged in from the OS (useImageUpload's overlay), text
      // from another application, and a drag within the field itself all leave it null and go on
      // working normally.
      const refuseEditorDrag = (event: DragEvent) => {
        if (!editor.view.dragging) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
      };
      header.addEventListener('dragenter', refuseEditorDrag);
      header.addEventListener('dragover', refuseEditorDrag);
      header.addEventListener('drop', refuseEditorDrag);

      header.appendChild(filenameInput);
      header.appendChild(select);
      header.appendChild(diffToggle);

      // Turn off the browser's native spellcheck for the code body: variable/function names
      // aren't dictionary words, so it paints most of the code with red squiggles. Prose
      // outside the code block keeps spellcheck (the editor sets no spellcheck attr globally).
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.setAttribute('spellcheck', 'false');
      pre.appendChild(code);

      dom.appendChild(header);
      dom.appendChild(pre);

      return {
        dom,
        contentDOM: code,
        update: (updated: PMNode) => {
          if (updated.type.name !== name) return false;
          currentNode = updated;
          sync();
          return true;
        },
        // The header is chrome: keep its clicks/keys away from ProseMirror (so editing the
        // filename or opening the dropdown never moves the editor selection or types into
        // the code), and ignore any DOM mutation outside the <code> content hole.
        stopEvent: (event: Event) => header.contains(event.target as globalThis.Node),
        ignoreMutation: (
          mutation: MutationRecord | { type: 'selection'; target: globalThis.Node },
        ) => {
          if (mutation.type === 'selection') return false;
          // If a native edit destroyed the content hole itself (Chrome folds an emptied
          // <pre> into the ce=false header — see deleteSoleCodeChar), report the mutation
          // so ProseMirror redraws the NodeView instead of silently diverging.
          if (!code.isConnected) return false;
          return !code.contains(mutation.target);
        },
      };
    };
  },
});
