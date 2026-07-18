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
// (e.g. ```ts:index.ts), and the editor (components/editor/code-block-extension.ts) writes a
// diff-flagged block's fence as `diff`/`diff_<lang>` in place of the bare language (e.g.
// ```diff_ts, or bare ```diff for "no language, just diff coloring" — including old posts
// written before this attribute existed, which need no migration since this runs fresh on
// every render). markdown/remark-rehype fold the whole no-whitespace info string into the
// `language-...` class, which survives rehype-sanitize intact. This step — which MUST run
// after sanitize (so the meta it sets isn't stripped) and before rehype-pretty-code — splits
// that class: strips any `diff`/`diff_` prefix down to the real language and the `:filename`
// suffix, restoring a clean `language-<lang>` class so Shiki highlights the real language —
// or, when no real language was given (bare ```diff/```diff_), keeps `language-diff` so Shiki
// still applies its own `diff` grammar (see the `isDiff` branch below for why that matters).
// The filename moves into `data.meta` as `title="…"` (rendered by pretty-code as a
// <figcaption data-rehype-pretty-code-title>) alongside a bare `diff` word that
// lib/shiki-diff-line-transformer.ts's transformer reads back via `this.options.meta.__raw` to
// decide whether to paint +/- rows — independent of the real Shiki language now. A plain
// ```ts fence (no colon, no diff prefix) is left untouched.
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
        // No real language (bare ```diff/```diff_): keep Shiki's own `diff` grammar rather than
        // falling back to plaintext. Its markup.inserted/deleted scopes are what give +/- lines
        // their token *foreground* color (the github-dark/light themes' green/red — the same
        // values components/editor/code-block-extension.ts's CSS hardcodes for the editor's own
        // decoration, since ProseMirror can't reuse Shiki's theme). diffLineHighlight only adds
        // the *background* those scopes don't surface — losing the `diff` grammar here would
        // lose that foreground coloring entirely, not just the background.
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
