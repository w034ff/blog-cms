import { textblockTypeInputRule } from '@tiptap/core';
import type { CommandProps, Editor, InputRule } from '@tiptap/core';
import { CodeBlock } from '@tiptap/extension-code-block';
import type { Node as PMNode, NodeType } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorState } from '@tiptap/pm/state';
import { blobSourceFromFilename } from '@/lib/github-blob';
import { unsetGithubBlob } from './github-blob-import';
import { stepIntoNextIsolating, stepIntoPreviousIsolating } from './isolating-boundary';
import { buildIcon, GITHUB_MARK_SHAPES, UNLINK_SHAPES } from './svg/icon-shapes';
import type { MarkdownSerializerState } from './markdown-serializer-state';
import { refuseChromeDrops } from './useDragContainment';
import { selectionTouches } from './selection-scan';
import { BLOCK_REFUSING_BOXES } from './summary-rules';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    codeBlockInsert: {
      // Put a code block at the caret: convert the current paragraph where that is legal, or add
      // one as the next block of its parent where it is not (a list item). See its comment.
      insertCodeBlock: () => ReturnType;
    };
  }
}

// Whether a code block may be added as the caret's textblock's *next sibling*, which
// `setCodeBlock` (convert only) never asks. For a list item (`paragraph block*`) that is from the
// second child on; a table cell refuses (`paragraph+`). Shared with the link card, which needs
// exactly these answers.
export function canPlaceAfterCaret(state: EditorState, type: NodeType): boolean {
  const { $from, empty } = state.selection;
  // Only for a caret. A paste collapses its range before asking (speakerdeck-snippet-paste.ts).
  if (!empty || $from.depth < 1) return false;
  // A まとめ section's list item is `paragraph block*` by the shared schema, but holds text only
  // (docs/summary-requirements.md §3.1).
  if (selectionTouches(state, ...BLOCK_REFUSING_BOXES)) return false;
  const parent = $from.node($from.depth - 1);
  const index = $from.index($from.depth - 1);
  return parent.canReplaceWith(index + 1, index + 1, type);
}

// Curated Shiki language ids, so the pick is what the published page highlights (lib/render.ts).
// '' stores `language: null`, a plain fence. Covers ids the ` ```lang ` rule can't type (it
// captures `[a-z]+`), such as `cpp` and `csharp`.
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

// The filename lives in the ```lang:filename info string, where only `[^\s`]+` survives: whitespace
// truncated it on the next load (markdown-it keeps only the first token), and a backtick broke
// the fence so the code spilled out as text. Both looked fine until reopening, so the field drops
// those characters (`my file.ts` → `myfile.ts`) and shows the result.
function sanitizeFilename(value: string): string {
  return value.replace(/[\s`]+/g, '');
}

// Matches no <form>, detaching the header controls from PostEditor's form (see the NodeView).
const DETACHED_FORM_ID = 'code-block-detached-controls';

// The fence text a just-fired rule consumed, so Backspace can restore it. TipTap's own record dies
// with TrailingNode's append at the end of the document (docs/editor-pitfalls.md §2.1); this one
// lives while the caret stays in the still-empty block. Predates trailing-node-extension.ts's fix
// and is deliberately kept.
type FenceUndo = { pos: number; text: string };

const fenceUndoKey = new PluginKey<FenceUndo | null>('codeBlockFenceUndo');

// Mirrors the published diff rules for `diff: true` blocks, as inline decorations over each line's
// text (a block's lines are one text node):
// 1. Text colour (diff-text-*) only without a real language, where Shiki's own `diff` grammar
//    colours every +/- line; with ```diff_ts the page uses that grammar instead.
// 2. Row background (diff-line-*, lib/shiki-diff-line-transformer.ts) for every diff block,
//    excluding +++/--- headers.
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

// Wrap a fence rule so its transaction stamps the fence text for fenceUndo. An Enter trigger's
// "\n" is stripped; a space trigger stays, as the native undo restores it.
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

// Deleting a block's last character natively let Chrome fold the emptied <pre> into the
// contenteditable=false header, desyncing the view. So that deletion is done in ProseMirror. (A
// word delete that empties a longer block still goes native; ignoreMutation lets ProseMirror repair
// it.)
function deleteSoleCodeChar(
  codeType: NodeType,
  dir: -1 | 1,
  { state, dispatch }: CommandProps,
): boolean {
  const { empty, $from } = state.selection;
  const text = $from.parent.textContent;
  // By code points, so a lone emoji counts as one character.
  if (!empty || $from.parent.type !== codeType || [...text].length !== 1) return false;
  if ($from.parentOffset !== (dir === -1 ? text.length : 0)) return false;
  if (dispatch) {
    dispatch(state.tr.delete($from.start(), $from.end()).scrollIntoView());
  }
  return true;
}

// Backspace in an *empty* code block turns it back into a paragraph, the keyboard way out once
// the fence-undo record has expired. Base CodeBlock's handler is no longer called: it used
// `clearNodes()`, which throws in this document (clear-nodes-extension.ts,
// docs/editor-pitfalls.md §8.1). Naming `paragraph` is what the conversion always wanted. Unlike
// `clearNodes`, this doesn't lift, so an emptied block in a list item stays in it.
function clearEmptyCodeBlock(codeType: NodeType, { state, tr, dispatch }: CommandProps): boolean {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type !== codeType || $from.parent.content.size > 0) return false;
  if (dispatch) {
    const pos = $from.before();
    tr.setNodeMarkup(pos, state.schema.nodes.paragraph, null);
    tr.setSelection(TextSelection.create(tr.doc, pos + 1));
    dispatch(tr.scrollIntoView());
  }
  return true;
}

// Backspace at the very start of the code selects the whole block, so a second press deletes it.
//
// First, it keeps `joinBackward` off its lift fallback: `findCutBefore` returns null for an
// isolating parent, and joinBackward then lifted the block out of a list item (taking the bullet),
// a quote or an accordion (e2e/editor-codeblock-boundary.spec.ts). Inside a callout it was already
// immune, since `liftTarget` stops at an isolating ancestor.
//
// Second, selecting rather than refusing: a refusal was worse than inconvenient, a dead key. A
// block loaded from markdown keeps a trailing newline, so `codeBlock("\n")` looks empty but is not,
// and every press was swallowed. Selecting (`selectNodeBackward`'s idiom) is visible and undone by
// any arrow key.
//
// Last in the chain, so fence undo still wins. The `empty` test keeps ranges on the normal path and
// stops the second press from re-selecting.
function selectCodeBlockBackward(
  codeType: NodeType,
  { state, tr, dispatch }: CommandProps,
): boolean {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type !== codeType || $from.parentOffset !== 0) return false;
  if (dispatch) {
    dispatch(tr.setSelection(NodeSelection.create(tr.doc, $from.before())).scrollIntoView());
  }
  return true;
}

// Restore the recorded fence as a paragraph, caret at its end; false when no live record exists.
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

// Serialize as a ```lang:filename fence, as prosemirror-markdown's default does (including the
// dynamic fence length). A `diff: true` block writes `diff`/`diff_<language>`, which
// updateCodeBlockDOM strips back out.
//
// **The trailing newline is dropped before writing** (docs/editor-pitfalls.md §9.1): markdown-it
// gives loaded blocks one, and `write()` prefixed the resulting empty line with the list or quote
// delimiter, so nested blocks grew a blank line per save. `ensureNewLine()` restores the
// terminator; trailing blank lines inside a block converge away over a save or two.
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

// Parse hook: markdown-it folds the info string into the class (```ts:index.ts →
// `language-ts:index.ts`). Split it back into `language-ts` plus `data-title` on the <pre>, and
// strip a `diff`/`diff_<lang>` prefix into a `data-diff` marker, which also loads old bare ```diff
// fences as `language: null, diff: true`.
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

// The `language-*` class on a <pre>'s <code> ('' when absent). Pasted HTML skips
// updateCodeBlockDOM, so a `<pre><code class="language-diff">` from Prism or highlight.js must be
// folded into `diff: true` here too, or it becomes a shadow state that flips on the next load.
function domLanguage(element: HTMLElement): string {
  const code = element.firstElementChild;
  const languageClass = code
    ? Array.from(code.classList).find((c) => c.startsWith('language-'))
    : undefined;
  return languageClass ? languageClass.slice('language-'.length) : '';
}

// Base CodeBlock's `codeBlockVSCodeHandler` turned *any* paste carrying VS Code's
// `vscode-editor-data` flavour into a code block, replacing the selection (docs/link-requirements.md
// §2.5). Replaced, not dropped: a multi-line paste from a code editor is code, and only that flavour
// carries the language; a single line is left to ``` and `/`. Link's paste handler (priority
// `1e3`) is asked first regardless of array position.
const VSCODE_HANDLER_KEY = 'codeBlockVSCodeHandler';

// A PluginKey's name (suffixed `$`), read through a narrow shape because prosemirror-state's types
// omit it.
function pluginKeyName(plugin: Plugin): string {
  const key = plugin.spec.key as { key?: string } | undefined;
  return key?.key ?? '';
}

// More than one line of content. A trailing newline is stripped first: VS Code's Ctrl+C with no
// selection copies one whole line including it.
function spansMultipleLines(text: string): boolean {
  return text.replace(/\r\n?/g, '\n').trimEnd().includes('\n');
}

// Base's handler plus the multi-line condition, with `JSON.parse` made total so a malformed flavour
// falls through instead of throwing.
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

// StarterKit's CodeBlock with a `filename` attribute, a NodeView (language <select>, filename
// field) and a ```lang:filename markdown round trip. Registered in place of StarterKit's; the node
// name stays `codeBlock`.
export const CodeBlockWithLanguage = CodeBlock.extend({
  // Hard edges: without this, Backspace below the block merged prose into the code.
  isolating: true,

  // Backspace tries, in order:
  // 1. undoInputRule, first because this keymap runs before the core Keymap and step 4 would
  //    otherwise swallow the Backspace right after a fence;
  // 2. undoFenceTyping, for a fence typed at the end of the document (see fenceUndoKey);
  // 3. deleteSoleCodeChar (also on Delete and the word-delete chords);
  // 4. clearEmptyCodeBlock;
  // 5. the shared isolating step-in;
  // 6. selectCodeBlockBackward.
  // Delete falls back to stepIntoNextIsolating after deleteSoleCodeChar.
  //
  // `insertCodeBlock` is the one entry point for "a code block here": convert where converting is
  // legal, and otherwise (a list item's first paragraph, which must stay a paragraph) add the block
  // as the item's next child, which is what the callout and table buttons have always done. The
  // ` ```lang ` input rule only converts, so it stays inert on a first paragraph.
  addCommands() {
    return {
      ...this.parent?.(),
      insertCodeBlock:
        () =>
        ({ can, chain, commands, state }: CommandProps) => {
          if (can().setCodeBlock()) return commands.setCodeBlock();
          if (!canPlaceAfterCaret(state, this.type)) return false;
          const at = state.selection.$from.after(state.selection.$from.depth);
          // insertContentAt past the textblock, so a mid-text caret doesn't split the paragraph.
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
      // Inside a fence the inherited `toggleCodeBlock` is the keyboard way back to a paragraph, so
      // only the creating direction goes through insertCodeBlock.
      'Mod-Alt-c': ({ editor }) =>
        editor.isActive(this.name)
          ? (parentShortcuts?.['Mod-Alt-c']?.({ editor }) ?? false)
          : editor.commands.insertCodeBlock(),
      // Base CodeBlock's Backspace is not delegated to. Its empty-block case is clearEmptyCodeBlock;
      // its `$anchor.pos === 1` case (a code block that is the document's first node) destroyed a
      // *non-empty* fence on one Backspace, while the same key anywhere else is a no-op. Dropped;
      // ArrowUp still reaches a gap cursor above the block (`needsGap()` tests `isolating`).
      Backspace: ({ editor }) =>
        editor.commands.undoInputRule() ||
        editor.commands.command((props) => undoFenceTyping(codeType, props)) ||
        deleteSole(-1)({ editor }) ||
        editor.commands.command((props) => clearEmptyCodeBlock(codeType, props)) ||
        editor.commands.command((props) => stepIntoPreviousIsolating(codeType, props)) ||
        editor.commands.command((props) => selectCodeBlockBackward(codeType, props)),
      Delete: ({ editor }) =>
        deleteSole(1)({ editor }) ||
        editor.commands.command((props) => stepIntoNextIsolating(codeType, props)),
      'Mod-Backspace': deleteSole(-1),
      'Mod-Delete': deleteSole(1),
      'Alt-Backspace': deleteSole(-1),
      'Alt-Delete': deleteSole(1),
    };
  },

  // The base ``` / ~~~ rules, recreated so each stamps the fence-undo meta, plus
  // ` ```lang:filename ` (language optional). The filename is one token without backticks, as the
  // info string requires.
  addInputRules() {
    const language = (match: RegExpMatchArray) => ({ language: match[1] });
    // `diff` and `diff_<lang>` set `diff: true`; the captured letters become `language`.
    const diffLanguage = (match: RegExpMatchArray) => ({
      language: match[1] ? match[1] : null,
      diff: true,
    });
    return [
      // Diff rules first: a bare ```diff also matches the generic `[a-z]+` rule.
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
      // Re-read via domLanguage so 'diff' folds into `diff`.
      language: {
        default: null,
        rendered: false,
        parseHTML: (element) => {
          const language = domLanguage(element);
          return language === '' || language === 'diff' ? null : language;
        },
      },
      // Via `data-title` on the <pre>. renderHTML writes it back because copy/paste serializes
      // through the schema's renderHTML, not the NodeView.
      filename: {
        default: null,
        // Sanitized here too: pasted HTML reaches this hook directly.
        parseHTML: (element) => {
          const filename = sanitizeFilename(stringAttr(element.getAttribute('data-title')));
          return filename === '' ? null : filename;
        },
        renderHTML: (attributes: { filename?: string | null }) => {
          const filename = stringAttr(attributes.filename);
          return filename === '' ? {} : { 'data-title': filename };
        },
      },
      // A manually authored diff, independent of `language`. Via `data-diff` (or a pasted
      // `language-diff` class, see domLanguage); serialized as the fence prefix.
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

  // The fence-undo record lives only while the caret stays in the same still-empty block;
  // TrailingNode's append leaves it alone, anything else invalidates it.
  addProseMirrorPlugins() {
    const codeType = this.type;
    const parentPlugins = this.parent?.() ?? [];
    // Base's VS Code handler, swapped out by key (suffixed `$`), keeping any other base plugin.
    const withoutVSCodeHandler = parentPlugins.filter(
      (plugin) => !pluginKeyName(plugin).startsWith(VSCODE_HANDLER_KEY),
    );
    if (withoutVSCodeHandler.length === parentPlugins.length) {
      // An upstream rename would silently restore the unconditional handler, which comes first.
      // A breadcrumb only; e2e/editor-vscode-paste.spec.ts's single-line cases catch it.
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
            // A carried-over record must still point at the block the caret is in.
            if (!meta && prev && tr.mapping.map(prev.pos) !== pos) return null;
            return { pos, text };
          },
        },
      }),
    ];
  },

  // Plain-DOM NodeView: a contenteditable=false header (filename, language) beside the editable
  // <code>. Editor-only; the page renders from markdown.
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
      // A borderless caption, so the placeholder is what marks the empty field.
      filenameInput.placeholder = 'ファイル名を追加';
      filenameInput.setAttribute('aria-label', 'コードブロックのファイル名');
      // No spellcheck squiggles on filenames.
      filenameInput.setAttribute('spellcheck', 'false');
      // Detached from PostEditor's <form>: React resets form controls after a server action, which
      // would blank the displayed value without any transaction to re-sync it.
      filenameInput.setAttribute('form', DETACHED_FORM_ID);

      // For a GitHub blob URL filename, a link to the file with GitHub's mark instead of the field
      // (docs/embed-requirements.md §19.4), drawn from the same string as the published header
      // (lib/rehype-code-source.ts).
      const sourceLink = document.createElement('a');
      sourceLink.className = 'code-block-source';
      sourceLink.target = '_blank';
      sourceLink.rel = 'noopener noreferrer';
      sourceLink.appendChild(buildIcon(GITHUB_MARK_SHAPES));
      const sourceRepo = document.createElement('span');
      sourceRepo.className = 'code-block-source-repo';
      const sourcePath = document.createElement('span');
      sourcePath.className = 'code-block-source-path';
      sourceLink.append(sourceRepo, sourcePath);

      // The way back out of an import (§19.4), shown only with the source link. Icon and label, one
      // showing by width as in the link card's band; the label stays as the accessible name.
      const toLink = document.createElement('button');
      toLink.type = 'button';
      toLink.className = 'code-block-to-link';
      const toLinkLabel = document.createElement('span');
      toLinkLabel.className = 'code-block-to-link-label';
      toLinkLabel.textContent = 'リンクに戻す';
      toLink.append(buildIcon(UNLINK_SHAPES), toLinkLabel);

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

      // Keep an unknown stored language selectable, not snapped to the first option.
      const ensureOption = (value: string) => {
        if (value === '' || Array.from(select.options).some((o) => o.value === value)) return;
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
      };

      // The diff toggle, icon-only, with a ToolbarButton-style CSS tooltip.
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
        const filename = stringAttr(currentNode.attrs.filename);
        if (document.activeElement !== filenameInput) {
          filenameInput.value = filename;
        }
        // One of the two, via `hidden`, so neither is rebuilt.
        const source = blobSourceFromFilename(filename);
        filenameInput.hidden = source !== null;
        sourceLink.hidden = source === null;
        toLink.hidden = source === null;
        if (source) {
          sourceLink.href = source.href;
          // The full reference, including the SHA the visible text omits.
          sourceLink.title = source.href;
          sourceRepo.textContent = source.repo;
          sourcePath.textContent = source.path;
        }
        diffToggle.setAttribute('aria-checked', String(Boolean(currentNode.attrs.diff)));
      };
      sync();

      // Through setNodeMarkup at getPos, as the callout does.
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

      // One transaction per edit, on `change`. The sanitized value is written back, since `sync()`
      // only mirrors the model while unfocused and Enter fires `change` with focus still here.
      filenameInput.addEventListener('change', () => {
        const filename = sanitizeFilename(filenameInput.value);
        if (filenameInput.value !== filename) filenameInput.value = filename;
        setAttr({ filename: filename === '' ? null : filename });
      });

      // Keep focus on the switch, or a second Space types into the document.
      diffToggle.addEventListener('click', () => {
        setAttr({ diff: !currentNode.attrs.diff });
      });

      toLink.addEventListener('click', () => {
        const pos = getPos();
        if (typeof pos === 'number') unsetGithubBlob(editor, pos);
      });

      // The header is all claimed by `stopEvent`, so a drop on the filename field would get the
      // browser's native move (docs/editor-pitfalls.md §18); refused as in useDragContainment.ts.
      refuseChromeDrops(
        header,
        (target) => header.contains(target),
        () => editor.view,
      );

      header.appendChild(filenameInput);
      header.appendChild(sourceLink);
      header.appendChild(select);
      header.appendChild(diffToggle);
      header.appendChild(toLink);

      // No spellcheck on code.
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
        // The header is chrome: its events stay away from ProseMirror, and mutations outside <code>
        // are ignored.
        stopEvent: (event: Event) => header.contains(event.target as globalThis.Node),
        ignoreMutation: (
          mutation: MutationRecord | { type: 'selection'; target: globalThis.Node },
        ) => {
          if (mutation.type === 'selection') return false;
          // If Chrome destroyed the content hole (see deleteSoleCodeChar), let ProseMirror redraw.
          if (!code.isConnected) return false;
          return !code.contains(mutation.target);
        },
      };
    };
  },
});
