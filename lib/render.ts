import 'server-only';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize';
import rehypePrettyCode from 'rehype-pretty-code';
import rehypeStringify from 'rehype-stringify';
import { remarkGithubAlerts } from './remark-github-alerts';
import { rehypeCodeFilename } from './rehype-code-filename';
import { diffLineHighlight } from './shiki-diff-line-transformer';

// defaultSchema (GitHub's allowlist) minus className, so the alert transform's
// container/title/content classes survive sanitization. The nested `['className', …]`
// form is a value allowlist: only these exact class names pass on div/p/span — no
// arbitrary classes, no `style`, so the untrusted-author guard is unweakened.
// The `['className', …values]` value-allowlist form is a tuple, so type it as one.
const alertClasses: [string, ...string[]] = [
  'className',
  'markdown-alert',
  'markdown-alert-note',
  'markdown-alert-warning',
  'markdown-alert-caution',
  'markdown-alert-content',
];
const titleClass: [string, ...string[]] = ['className', 'markdown-alert-title'];
// Both allowed <span> classes, merged into one value-allowlist tuple: a schema attribute list
// holds at most one usable tuple per attribute name — hast-util-sanitize's findDefinition
// returns on the first entry whose name matches, so appending a second `['className', …]` for
// the same tag would leave it dead rather than widen what the first one allows.
//   - markdown-alert-title-label: the sr-only <span> the alert transform wraps the type word
//     in (announced to screen readers; hidden visually) — pretty-code's post-sanitize
//     highlight spans are unaffected.
//   - accent-emphasis: the "強調" inline mark (components/editor/accent-emphasis-extension.ts),
//     which round-trips as raw `<span class="accent-emphasis">` since bold+color has no
//     native markdown syntax.
// Only these exact class names pass on <span>; an author's own `<span class="…">` is
// still stripped.
const spanClasses: [string, ...string[]] = [
  'className',
  'markdown-alert-title-label',
  'accent-emphasis',
];
const schema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    div: [...(defaultSchema.attributes?.div ?? []), alertClasses],
    p: [...(defaultSchema.attributes?.p ?? []), titleClass],
    span: [...(defaultSchema.attributes?.span ?? []), spanClasses],
  },
};

// Shared pipeline used by both the public post page and the editor preview,
// so what an author previews matches exactly what gets published.
// Mirrors the rehype-pretty-code options that used to live in next.config.ts.
//
// Now that non-admin users can author posts, raw HTML in MDX (e.g. <script>,
// <iframe>, onerror=…) is no longer trusted and is filtered by rehype-sanitize.
// Order matters: sanitize runs AFTER rehype-raw (so embedded raw HTML is parsed
// into the tree, then filtered) but BEFORE rehype-pretty-code, so the syntax
// highlighter's own trusted spans/inline styles are added post-sanitization and
// don't need allow-listing. defaultSchema is GitHub's safe allowlist; fenced
// code keeps its `language-*` class, so pretty-code still highlights.
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  // GitHub alerts (`> [!NOTE]` …) run on the mdast, before it becomes hast.
  .use(remarkGithubAlerts)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSanitize, schema)
  // Split a Zenn-style ```lang:filename fence (the whole info string survives sanitize as
  // the `language-…` class) into a real language + a title="…" meta for pretty-code. MUST sit
  // after sanitize (which would otherwise strip the meta) and before pretty-code, which reads
  // the title from the code element's data.meta.
  .use(rehypeCodeFilename)
  .use(rehypePrettyCode, {
    theme: { dark: 'github-dark', light: 'github-light' },
    keepBackground: false,
    // Give a language-less ```` ``` ```` fence a default so pretty-code still wraps it in a
    // [data-rehype-pretty-code-figure] card (it early-returns on an empty lang otherwise), so
    // "no language" blocks get the same card/filename/copy-button chrome as highlighted ones —
    // just no token colors. Object form scopes this to block code, leaving inline code untouched.
    defaultLang: { block: 'plaintext' },
    transformers: [diffLineHighlight()],
  })
  .use(rehypeStringify);

export async function renderMdxToHtml(source: string): Promise<string> {
  const file = await processor.process(source);
  return String(file);
}
