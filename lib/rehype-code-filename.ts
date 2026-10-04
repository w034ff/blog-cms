import type { Root, Element } from 'hast';
import { visit } from 'unist-util-visit';

// rehype-pretty-code reads a code block's title from the code element's `data.meta`
// (`title="…"`). Augment hast's element data so setting it below type-checks.
//
// **It must match `mdast-util-to-hast`'s own augmentation character for character**
// (`meta?: string | null | undefined`), or TS2717 breaks the whole build. Kept so this module states
// the field it writes rather than inheriting it.
declare module 'hast' {
  interface ElementData {
    meta?: string | null | undefined;
  }
}

// Splits the fence info string, which remark-rehype folds whole into the `language-…` class
// (surviving sanitize): ```ts:index.ts (Zenn/Qiita's filename form) and the editor's
// `diff`/`diff_<lang>` prefix (components/editor/code-block-extension.ts; old bare ```diff posts
// need no migration). **After sanitize** (which would strip the meta) and before pretty-code. The
// class becomes the real `language-<lang>`, or stays `language-diff` without one (see `isDiff`); the
// filename goes into `data.meta` as `title="…"` beside a bare `diff` word that
// lib/shiki-diff-line-transformer.ts reads from `meta.__raw`. A plain ```ts is untouched.
export function rehypeCodeFilename() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'code') return;
      const className = node.properties?.className;
      if (!Array.isArray(className)) return;

      const langIndex = className.findIndex(
        (c) => typeof c === 'string' && c.startsWith('language-'),
      );
      if (langIndex === -1) return;

      const value = String(className[langIndex]).slice('language-'.length);
      const colon = value.indexOf(':');
      let language = colon === -1 ? value : value.slice(0, colon);
      // Drop stray double quotes so the title="…" meta can't be broken out of. The filename
      // never contains whitespace (markdown parsing would have split the info string).
      const filename = colon === -1 ? '' : value.slice(colon + 1).replace(/"/g, '');

      const isDiff = language === 'diff' || language.startsWith('diff_');
      if (isDiff) language = language === 'diff' ? '' : language.slice('diff_'.length);

      // Nothing to rewrite: a plain ```lang fence with no filename and no diff prefix.
      if (!isDiff && colon === -1) return;

      if (language) {
        className[langIndex] = `language-${language}`;
      } else if (isDiff) {
        // No real language: keep Shiki's `diff` grammar, whose inserted/deleted scopes give +/- lines
        // their foreground colour; diffLineHighlight only adds the background.
        className[langIndex] = 'language-diff';
      } else {
        className.splice(langIndex, 1);
      }

      const metaParts: string[] = [];
      if (isDiff) metaParts.push('diff');
      if (filename) metaParts.push(`title="${filename}"`);
      if (metaParts.length > 0) {
        node.data = { ...node.data, meta: metaParts.join(' ') };
      }
    });
  };
}
