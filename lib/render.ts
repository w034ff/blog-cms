import 'server-only';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import rehypePrettyCode from 'rehype-pretty-code';
import rehypeStringify from 'rehype-stringify';
import { remarkGithubAlerts } from './remark-github-alerts';
import { rehypeCodeFilename } from './rehype-code-filename';
import { diffLineHighlight } from './shiki-diff-line-transformer';
import { rehypeCollectToc, type TocEntry } from './rehype-collect-toc';
import { rehypeClobberFragmentLinks } from './rehype-clobber-fragment-links';
import { rehypeLinkCard, type CardTarget, type ResolveCard } from './rehype-link-card';
import {
  CALLOUT_DIV_CLASSES,
  CALLOUT_TITLE_CLASS,
  CALLOUT_TITLE_LABEL_CLASS,
} from './callout-types';

export type { TocEntry, CardTarget, ResolveCard };

// defaultSchema (GitHub's allowlist) plus the class names this site's own block constructs
// round-trip as. The nested `['className', …]` form is a value allowlist: only these exact class
// names pass on div/p/span — no arbitrary classes, no `style`, so the untrusted-author guard is
// unweakened. The `['className', …values]` value-allowlist form is a tuple, so type it as one.
//
// One tuple per (tag, attribute) — a second `['className', …]` on the same tag would be dead
// rather than additive (see the <span> note below), so `link-card` joins the alert names here
// instead of getting a list of its own.
//   - markdown-alert-*: the GitHub-alert transform's container/title/content. Spread from
//     lib/callout-types.ts rather than listed, because this is the one place where a missing
//     name fails *silently* — an unlisted class is stripped from the published HTML, so a new
//     tier would author, save and reload correctly and simply render with no colour. Deriving
//     it means adding a tier there is enough.
//   - link-card: the stored form of a link card (docs/link-card-requirements.md §4.2), an empty
//     `<div class="link-card" data-href="/posts/…">` that rehypeLinkCard resolves further down
//     this pipeline. Without this the class is stripped and the card silently becomes an empty div.
const divClasses: [string, ...string[]] = ['className', ...CALLOUT_DIV_CLASSES, 'link-card'];
const titleClass: [string, ...string[]] = ['className', CALLOUT_TITLE_CLASS];
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
  CALLOUT_TITLE_LABEL_CLASS,
  'accent-emphasis',
];
const schema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    // `dataHref` is a bare property name, not a value allowlist, so allowing it lets ANY value
    // through on any div — including one an author hand-wrote. That is deliberate and is why
    // rehype-link-card validates the reference itself instead of trusting this schema; see
    // docs/link-card-requirements.md §4.4, and CARD_HREF in lib/rehype-link-card.ts.
    div: [...(defaultSchema.attributes?.div ?? []), divClasses, 'dataHref'],
    p: [...(defaultSchema.attributes?.p ?? []), titleClass],
    span: [...(defaultSchema.attributes?.span ?? []), spanClasses],
  },
};

// What sanitize will actually rename an `id` to, read back off the schema rather than
// restated, so the fragment-link rewrite below can't drift out of step with it. Mirrors
// hast-util-sanitize's own condition: a schema that blanks the prefix or drops `id` from
// `clobber` renames nothing, and then neither should the links.
const idClobberPrefix = schema.clobber?.includes('id') ? (schema.clobberPrefix ?? '') : '';

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
  // `clobberPrefix: ''` leaves GFM footnote ids/hrefs bare (`fn-1`), so sanitize below is the
  // only step that prefixes them — exactly like every other id. With to-hast's own
  // `user-content-` left on, sanitize would prefix the id a second time and the href not at
  // all, which pointed both the reference and the ↩ backref at names that don't exist.
  .use(remarkRehype, { allowDangerousHtml: true, clobberPrefix: '' })
  .use(rehypeRaw)
  // Assigns each h2/h3 an id. Runs before sanitize (not after) so an author's own hand-written
  // `id` on a raw-HTML heading — which rehypeSlug leaves untouched — still goes through the
  // schema's `clobberPrefix` below like any other id, instead of bypassing that defense.
  .use(rehypeSlug)
  .use(rehypeSanitize, schema)
  // Re-points every in-page link at the id sanitize just renamed (headings, footnotes). Must
  // run after sanitize for the same reason the toc collection below does.
  .use(rehypeClobberFragmentLinks, { prefix: idClobberPrefix })
  // Reads ids back off the tree AFTER sanitize: the schema's `clobberPrefix` (GitHub's
  // DOM-clobbering defense) rewrites every id to `user-content-<id>`, so collecting any earlier
  // would hand the post page's table of contents a set of ids that don't match what actually
  // renders.
  .use(rehypeCollectToc)
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
  // Turns each stored `<div class="link-card" data-href>` into a card, a plain link, or nothing
  // (docs/link-card-requirements.md §6.1). Last, and after sanitize for the same reason
  // pretty-code is: everything it builds is this pipeline's own markup, so none of it has to be
  // allow-listed. Nothing above it reads cards — rehypeCollectToc only looks at headings and
  // rehypeClobberFragmentLinks only at `#…` hrefs — but the position is pinned by a test in
  // lib/render.test.ts rather than by this argument, since a card does emit an `<a href>`.
  .use(rehypeLinkCard)
  .use(rehypeStringify);

// `resolveCard` is injected rather than imported so this module stays pure and `server-only`
// without depending on the DB (docs/link-card-requirements.md §6): the post page hands over a
// closure around getPostBySlug, and a test hands over a literal. It travels as VFile data because
// `processor` is built once at module load — per-call options must not mean rebuilding it.
// Omitting it renders every card as a plain link rather than failing.
export async function renderMdxToHtml(
  source: string,
  options: { resolveCard?: ResolveCard } = {},
): Promise<{ html: string; toc: TocEntry[] }> {
  const file = await processor.process({
    value: source,
    data: { resolveCard: options.resolveCard },
  });
  return { html: String(file), toc: file.data.toc ?? [] };
}
