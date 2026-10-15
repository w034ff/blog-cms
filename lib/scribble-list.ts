import type { Metadata } from 'next';
import { sharedOpenGraph } from '@/app/shared-metadata';
import { excerptFromBody } from '@/lib/excerpt';
import type { Post } from '@/lib/types';

export const SCRIBBLES_PER_PAGE = 20;

// Parses the `?page=` query parameter into a 1-based integer.
// Missing, non-numeric, less than 1, or fractional values default to 1
// (docs/scribble-requirements.md §5).
export function parsePageNumber(value: unknown): number {
  if (Array.isArray(value)) {
    return parsePageNumber(value[0]);
  }
  if (typeof value !== 'string') {
    return 1;
  }
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    return 1;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return parsed;
}

// Calculates the last page number from total item count and page size.
// Returns at least 1 even when totalCount is 0, so page 1 is valid when empty.
export function calculateTotalPages(
  totalCount: number,
  perPage: number = SCRIBBLES_PER_PAGE,
): number {
  if (perPage <= 0) return 1;
  return Math.max(1, Math.ceil(Math.max(0, totalCount) / perPage));
}

// Metadata for the scribble list (/scribbles). Always includes `robots: { index: false }`
// regardless of siteIndexable (docs/scribble-requirements.md §2, §5).
export function scribbleListMetadata(page = 1): Metadata {
  return {
    title: page > 1 ? `走り書き (${page} ページ目)` : '走り書き',
    robots: { index: false },
    openGraph: {
      ...sharedOpenGraph,
      title: '走り書き',
      url: page > 1 ? `/scribbles?page=${page}` : '/scribbles',
    },
  };
}

// Metadata for each scribble page (/scribbles/<slug>). Always includes `robots: { index: false }`
// regardless of siteIndexable (docs/scribble-requirements.md §2, §5).
export function scribbleDetailMetadata(post: Post, preview: boolean): Metadata {
  if (preview) {
    return {
      title: `[下書き] ${post.title}`,
      robots: { index: false, follow: false },
    };
  }
  const description = excerptFromBody(post.body) || undefined;
  return {
    title: post.title,
    description,
    robots: { index: false },
    openGraph: {
      ...sharedOpenGraph,
      type: 'article',
      title: post.title,
      description,
      url: `/scribbles/${post.slug}`,
      publishedTime: post.date,
    },
  };
}
