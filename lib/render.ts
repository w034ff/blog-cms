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
import { rehypeCodeSource } from './rehype-code-source';
import { diffLineHighlight } from './shiki-diff-line-transformer';
import { rehypeCollectToc, type TocEntry } from './rehype-collect-toc';
import { rehypeClobberFragmentLinks } from './rehype-clobber-fragment-links';
import { rehypeImageCaption } from './rehype-image-caption';
import { rehypeLinkCard, type CardTarget, type ResolveCard } from './rehype-link-card';
import { rehypeEmbed } from './rehype-embed';
import { rehypeSummary } from './rehype-summary';
import { rehypeNewTabLinks } from './rehype-new-tab-links';
import {
  CALLOUT_DIV_CLASSES,
  CALLOUT_TITLE_CLASS,
  CALLOUT_TITLE_LABEL_CLASS,
} from './callout-types';
import { SUMMARY_DIV_CLASSES } from './summary-types';

export type { TocEntry, CardTarget, ResolveCard };

// defaultSchema (GitHub's allowlist) plus the class names this site's own block constructs round-trip
// as, as a value allowlist: only these exact names pass on div/p/span, never `style`, so the
// untrusted-author guard is unweakened. One tuple per (tag, attribute), since a second would be dead
// (see the <span> note below):
//   - markdown-alert-*: spread from lib/callout-types.ts, because an unlisted class is stripped
//     *silently* and a new tier would render with no colour.
//   - link-card (docs/link-card-requirements.md §4.2) and embed (docs/embed-requirements.md §4.1):
//     stored forms that would silently become empty divs. One word for every embed provider.
//   - the まとめ / TL;DR containers (docs/summary-requirements.md §3.3), from lib/summary-types.ts.
const divClasses: [string, ...string[]] = [
  'className',
  ...CALLOUT_DIV_CLASSES,
  'link-card',
  'embed',
  ...SUMMARY_DIV_CLASSES,
];
const titleClass: [string, ...string[]] = ['className', CALLOUT_TITLE_CLASS];
// Both <span> classes in one tuple: hast-util-sanitize's `findDefinition` returns on the first entry
// whose name matches, so a second `['className', …]` for the same tag would be dead.
//   - markdown-alert-title-label: the alert's sr-only type word;
//   - accent-emphasis: the 強調 mark (components/editor/accent-emphasis-extension.ts), raw HTML
//     because it has no markdown syntax.
// An author's own `<span class="…">` is still stripped.
const spanClasses: [string, ...string[]] = [
  'className',
  CALLOUT_TITLE_LABEL_CLASS,
  'accent-emphasis',
];
const schema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    // A bare property name lets ANY value through on any div, deliberately: rehype-link-card
    // validates the reference itself (docs/link-card-requirements.md §4.4).
    div: [...(defaultSchema.attributes?.div ?? []), divClasses, 'dataHref'],
    p: [...(defaultSchema.attributes?.p ?? []), titleClass],
    span: [...(defaultSchema.attributes?.span ?? []), spanClasses],
  },
};

// The prefix sanitize actually renames ids with, read off the schema (as hast-util-sanitize decides
// it), so the fragment-link rewrite can't drift from it.
const idClobberPrefix = schema.clobber?.includes('id') ? (schema.clobberPrefix ?? '') : '';

// The published side's pipeline, called by `app/(site)/posts/[slug]/page.tsx` and the public scribble pages;
// the editor agrees with it through the stored markdown, not by sharing this module.
//
// Now that non-admin users can author posts, raw HTML (e.g. <script>, <iframe>, onerror=…) is not
// trusted and is filtered by rehype-sanitize. **Order matters:** sanitize runs after rehype-raw (so
// raw HTML is parsed, then filtered) and before rehype-pretty-code, whose trusted spans and styles
// are added afterwards and need no allow-listing.
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  // GitHub alerts (`> [!NOTE]` …) run on the mdast, before it becomes hast.
  .use(remarkGithubAlerts)
  // `clobberPrefix: ''` leaves footnote ids bare so sanitize prefixes them once, like every id;
  // otherwise the id was prefixed twice and the href not at all.
  .use(remarkRehype, { allowDangerousHtml: true, clobberPrefix: '' })
  .use(rehypeRaw)
  // Before sanitize, so an author's own raw-HTML heading id still gets the `clobberPrefix`.
  .use(rehypeSlug)
  .use(rehypeSanitize, schema)
  // Re-points in-page links at the renamed ids; after sanitize, as the toc collection is.
  .use(rehypeClobberFragmentLinks, { prefix: idClobberPrefix })
  // After sanitize, whose `clobberPrefix` renames every id to `user-content-<id>`.
  .use(rehypeCollectToc)
  // Splits ```lang:filename into a language and a title meta: after sanitize (which would strip the
  // meta) and before pretty-code, which reads it.
  .use(rehypeCodeFilename)
  .use(rehypePrettyCode, {
    theme: { dark: 'github-dark', light: 'github-light' },
    keepBackground: false,
    // A default language so pretty-code (which skips an empty lang) still gives plain fences its
    // card and copy button. The object form leaves inline code alone.
    defaultLang: { block: 'plaintext' },
    transformers: [diffLineHighlight()],
  })
  // A code block imported from a GitHub file wears a link to it in place of its filename
  // (docs/embed-requirements.md §19.4). After pretty-code, which builds the caption this rewrites,
  // and before rehypeNewTabLinks, which is what decides the anchor opens in a new tab.
  .use(rehypeCodeSource)
  // Image + emphasis-only paragraph → figure with caption (docs/cms-features.md「画像キャプション」).
  // After sanitize, since `figure`/`figcaption` are not in the schema.
  .use(rehypeImageCaption)
  // Link cards (docs/link-card-requirements.md §6.1), after sanitize so their markup needs no
  // allow-listing. Position pinned by lib/render.test.ts, since a card emits an `<a href>`.
  .use(rehypeLinkCard)
  // Embeds (docs/embed-requirements.md §6): `<iframe>` must never enter the schema, so it is built
  // after sanitize. Beside rehypeLinkCard only for grouping; they read disjoint classes.
  .use(rehypeEmbed)
  // The まとめ / TL;DR titles (docs/summary-requirements.md §8), after sanitize so the chrome needs no
  // allow-listing. <p>, not headings, so its place against rehypeCollectToc does not matter.
  .use(rehypeSummary)
  // New-tab links (docs/link-requirements.md §7.2). Last, since it must see the anchors the card
  // and embed stages build.
  .use(rehypeNewTabLinks)
  .use(rehypeStringify);

// `resolveCard` is injected so this module stays pure without the DB (docs/link-card-requirements.md
// §6), travelling as VFile data because `processor` is built once. Omitted, every card renders as a
// plain link. `embedsAsLinks` (lib/rehype-embed.ts) and `fragmentBase`
// (lib/rehype-clobber-fragment-links.ts) travel the same way.
export async function renderMdxToHtml(
  source: string,
  options: { resolveCard?: ResolveCard; embedsAsLinks?: boolean; fragmentBase?: string } = {},
): Promise<{ html: string; toc: TocEntry[] }> {
  const file = await processor.process({
    value: source,
    data: {
      resolveCard: options.resolveCard,
      embedsAsLinks: options.embedsAsLinks,
      fragmentBase: options.fragmentBase,
    },
  });
  return { html: String(file), toc: file.data.toc ?? [] };
}
