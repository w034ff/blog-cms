import type { Node as PMNode } from '@tiptap/pm/model';

// Minimal view of tiptap-markdown's serializer state, shared by the editor's custom
// markdown serializers (table, callout, code block). It extends prosemirror-markdown's
// MarkdownSerializerState but tiptap-markdown exports no types for it, so the members
// those serializers call are declared here.
export interface MarkdownSerializerState {
  inTable: boolean;
  write(content: string): void;
  // Emits text with markdown escaping unless `escape` is false (code content).
  text(text: string, escape?: boolean): void;
  ensureNewLine(): void;
  // Backslash-escapes markdown syntax characters in plain text.
  esc(str: string, startOfLine?: boolean): string;
  closeBlock(node: PMNode): void;
  wrapBlock(delim: string, firstDelim: string | null, node: PMNode, f: () => void): void;
  renderInline(node: PMNode): void;
  renderContent(node: PMNode): void;
}
