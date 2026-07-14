import { textblockTypeInputRule } from '@tiptap/core';
import type { CommandProps, Editor, InputRule } from '@tiptap/core';
import { CodeBlock } from '@tiptap/extension-code-block';
import type { Node as PMNode, NodeType } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { stepIntoPreviousIsolating } from './isolating-boundary';
import type { MarkdownSerializerState } from './markdown-serializer-state';

// Curated language menu for the in-editor code block. The ids are Shiki language ids
// (the public render pipeline highlights via rehype-pretty-code → Shiki, lib/render.ts),
// so what you pick here is exactly what gets highlighted on the published page. The empty
// id means "no language": it stores `language: null`, which serializes to a plain ``` fence,
// preserving the pre-existing behaviour. The dropdown also covers ids the ` ```lang ` typing
// rule can't produce — it only captures `[a-z]+`, so `cpp` (C++) and `csharp` (C#) are
// reachable only here.
export const CODE_LANGUAGES: readonly { id: string; label: string }[] = [
  { id: '', label: 'なし' },
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
  { id: 'diff', label: 'Diff' },
  { id: 'dockerfile', label: 'Dockerfile' },
  { id: 'graphql', label: 'GraphQL' },
];

// Normalize a string-or-null attribute to a plain string ('' when absent).
function stringAttr(value: string | null | undefined): string {
  return typeof value === 'string' ? value : '';
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
function serializeCodeBlock(state: MarkdownSerializerState, node: PMNode): void {
  const language = stringAttr(node.attrs.language);
  const filename = stringAttr(node.attrs.filename);
  const backticks = node.textContent.match(/`{3,}/g);
  const fence = backticks ? backticks.sort().slice(-1)[0] + '`' : '```';
  const params = language + (filename ? `:${filename}` : '');
  state.write(fence + params + '\n');
  state.text(node.textContent, false);
  state.ensureNewLine();
  state.write(fence);
  state.closeBlock(node);
}

// Parse hook (runs on markdown-it's HTML before ProseMirror parses it). markdown-it folds
// the whole no-whitespace info string into the language class, so ```ts:index.ts arrives as
// `<code class="language-ts:index.ts">`. Split it: restore the real `language-ts` class (so
// the base `language` attr parses right) and stash the filename on the <pre> as `data-title`
// for the `filename` attr below. A plain ```ts fence has no colon and is left untouched.
function updateCodeBlockDOM(element: HTMLElement): void {
  element.querySelectorAll('pre > code').forEach((code) => {
    const languageClass = Array.from(code.classList).find((c) => c.startsWith('language-'));
    if (!languageClass) return;
    const value = languageClass.slice('language-'.length);
    const colon = value.indexOf(':');
    if (colon === -1) return;
    const language = value.slice(0, colon);
    const filename = value.slice(colon + 1);
    code.classList.remove(languageClass);
    if (language) code.classList.add(`language-${language}`);
    if (filename) code.parentElement?.setAttribute('data-title', filename);
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
  addKeyboardShortcuts() {
    const parentShortcuts = this.parent?.();
    const codeType = this.type;
    const deleteSole =
      (dir: -1 | 1) =>
      ({ editor }: { editor: Editor }) =>
        editor.commands.command((props) => deleteSoleCodeChar(codeType, dir, props));
    return {
      ...parentShortcuts,
      Backspace: ({ editor }) =>
        editor.commands.undoInputRule() ||
        editor.commands.command((props) => undoFenceTyping(codeType, props)) ||
        deleteSole(-1)({ editor }) ||
        (parentShortcuts?.Backspace?.({ editor }) ?? false) ||
        editor.commands.command((props) => stepIntoPreviousIsolating(codeType, props)),
      Delete: deleteSole(1),
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
    return [
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
      // Round-trips through the `data-title` attribute that updateCodeBlockDOM stashes on
      // the <pre>; serialized as the `:filename` fence suffix, so it needs no HTML rendering.
      filename: {
        default: null,
        rendered: false,
        parseHTML: (element) => element.getAttribute('data-title'),
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
    return [
      ...(this.parent?.() ?? []),
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

      const sync = () => {
        const language = stringAttr(currentNode.attrs.language);
        ensureOption(language);
        if (select.value !== language) select.value = language;
        // Don't clobber the field mid-edit; only mirror the model when it isn't focused.
        if (document.activeElement !== filenameInput) {
          filenameInput.value = stringAttr(currentNode.attrs.filename);
        }
      };
      sync();

      // Both writes go through setNodeMarkup at this node's position (getPos), the same
      // way the Callout NodeView commits its type change.
      const setAttr = (attrs: Record<string, string | null>) => {
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
      // transaction. Whitespace breaks the ```lang:filename fence (markdown-it splits the
      // info string on it), so trim to a single token — same limitation Zenn/Qiita have.
      filenameInput.addEventListener('change', () => {
        const trimmed = filenameInput.value.trim();
        setAttr({ filename: trimmed === '' ? null : trimmed });
      });

      header.appendChild(filenameInput);
      header.appendChild(select);

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
