import 'server-only';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypePrettyCode from 'rehype-pretty-code';
import rehypeStringify from 'rehype-stringify';

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
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSanitize, defaultSchema)
  .use(rehypePrettyCode, {
    theme: { dark: 'github-dark', light: 'github-light' },
    keepBackground: false,
  })
  .use(rehypeStringify);

export async function renderMdxToHtml(source: string): Promise<string> {
  const file = await processor.process(source);
  return String(file);
}
