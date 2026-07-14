import { CodeBlock } from '@tiptap/extension-code-block';
import type { Node as PMNode } from '@tiptap/pm/model';
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
  // and only augment Backspace: try the inherited handler first, then the shared boundary step-in.
  addKeyboardShortcuts() {
    const parentShortcuts = this.parent?.();
    const codeType = this.type;
    return {
      ...parentShortcuts,
      Backspace: ({ editor }) =>
        (parentShortcuts?.Backspace?.({ editor }) ?? false) ||
        editor.commands.command((props) => stepIntoPreviousIsolating(codeType, props)),
    };
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
          return !code.contains(mutation.target);
        },
      };
    };
  },
});
