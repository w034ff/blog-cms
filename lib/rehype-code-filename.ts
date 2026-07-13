import type { Root, Element } from 'hast';
import { visit } from 'unist-util-visit';

// rehype-pretty-code reads a code block's title from the code element's `data.meta`
// (`title="…"`). Augment hast's element data so setting it below type-checks.
declare module 'hast' {
  interface ElementData {
    meta?: string;
  }
}

// Zenn/Qiita write a code block's filename in the fence info string as `lang:filename`
// (e.g. ```ts:index.ts). markdown/remark-rehype fold the whole no-whitespace info string
// into the `language-ts:index.ts` class, which survives rehype-sanitize intact. This step —
// which MUST run after sanitize (so the meta it sets isn't stripped) and before
// rehype-pretty-code — splits that class: restore a clean `language-ts` class so Shiki
// highlights, and move the filename into `data.meta` as `title="…"` for pretty-code to render
// as a <figcaption data-rehype-pretty-code-title>. A plain ```ts fence has no colon and is
// left untouched.
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
      if (colon === -1) return;

      const language = value.slice(0, colon);
      // Drop stray double quotes so the title="…" meta can't be broken out of. The filename
      // never contains whitespace (markdown parsing would have split the info string).
      const filename = value.slice(colon + 1).replace(/"/g, '');

      if (language) {
        className[langIndex] = `language-${language}`;
      } else {
        className.splice(langIndex, 1);
      }
      if (filename) {
        node.data = { ...node.data, meta: `title="${filename}"` };
      }
    });
  };
}
