import matter from 'gray-matter';
import type { Post } from '@/lib/types';

// A post's live (public) columns as a markdown file, in the frontmatter shape of
// `content/posts/*.mdx`, so scripts/migrate-content.mts can read the file back. The body goes out
// as stored: it is already the site's markdown, and the custom blocks (callouts, link cards,
// footnotes) and `/uploads/…` paths are left for whoever reads it to interpret.
//
// Empty fields are left out rather than written as '' — a draft has no date or category yet.
export function postToMarkdown(post: Post): string {
  const data: Record<string, unknown> = { title: post.title };
  if (post.date) data.date = post.date;
  if (post.tags.length > 0) data.tags = post.tags;
  if (post.category) data.category = post.category;
  if (post.thumbnail) data.thumbnail = post.thumbnail;
  if (post.draft) data.draft = true;
  // Only when it is not the default, as `draft`: a file that says nothing is a post.
  if (post.kind !== 'post') data.kind = post.kind;
  return matter.stringify(post.body, data);
}

// Characters a filename cannot carry on Windows or macOS, plus controls.
const UNSAFE_FILENAME = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
const FILENAME_MAX_CHARS = 100;

// The download's name: the title, made safe for a filesystem, or `post-<id>` when nothing is left.
export function markdownFilename(post: Pick<Post, 'id' | 'title'>): string {
  const base = post.title.replace(UNSAFE_FILENAME, '_').trim().slice(0, FILENAME_MAX_CHARS);
  return `${base || `post-${post.id}`}.md`;
}
