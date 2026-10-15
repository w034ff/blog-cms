import type { Root, RootContent } from 'mdast';
import {
  excerptFromBody,
  normalize as normalizeExcerptText,
  parser,
  phrasingText,
} from '@/lib/excerpt';
import type { Post } from '@/lib/types';

// Named constants for search constraints and snippet sizing (docs/search-requirements.md §3.3, §4).
export const SEARCH_MAX_TERMS = 5;
export const SEARCH_MAX_CHARS = 100;
export const SEARCH_SNIPPET_CHARS = 120;
export const SEARCH_SNIPPET_PRE_CHARS = 30;

export type NormalizedString = {
  norm: string;
  origStartMap: number[];
  origEndMap: number[];
};

export type MarkSegment = {
  text: string;
  isMark: boolean;
};

export type SearchResult = {
  post: Post;
  titleSegments: MarkSegment[];
  snippetSegments: MarkSegment[];
};

// Fast code-point by code-point NFKC and lowercase normalization without offset tracking.
export function normalizeString(orig: string): string {
  let norm = '';
  for (const ch of orig) {
    norm += ch.normalize('NFKC').toLowerCase();
  }
  return norm;
}

// Normalize a string code-point by code-point using Unicode NFKC and lowercase (docs/search-requirements.md §3.3).
// Tracks character offsets so highlights (<mark>) map back to original character positions.
export function normalizeWithMap(orig: string): NormalizedString {
  let norm = '';
  const origStartMap: number[] = [];
  const origEndMap: number[] = [];

  let origIndex = 0;
  for (const ch of orig) {
    const chLen = ch.length;
    const start = origIndex;
    const end = origIndex + chLen;
    const normCh = ch.normalize('NFKC').toLowerCase();

    for (let i = 0; i < normCh.length; i++) {
      origStartMap.push(start);
      origEndMap.push(end);
    }
    norm += normCh;
    origIndex = end;
  }

  return { norm, origStartMap, origEndMap };
}

// Parse search input into normalized query terms (docs/search-requirements.md §3.3).
// Limits total characters to SEARCH_MAX_CHARS and term count to SEARCH_MAX_TERMS.
export function parseSearchTerms(query: string): string[] {
  if (!query) return [];
  const chars = Array.from(query.trim());
  if (chars.length === 0) return [];

  const truncated = chars.slice(0, SEARCH_MAX_CHARS).join('');
  const rawTerms = truncated.split(/[\s\u3000]+/);

  const terms: string[] = [];
  for (const rawTerm of rawTerms) {
    let normTerm = '';
    for (const ch of rawTerm) {
      normTerm += ch.normalize('NFKC').toLowerCase();
    }
    if (normTerm !== '' && !terms.includes(normTerm)) {
      terms.push(normTerm);
    }
  }

  return terms.slice(0, SEARCH_MAX_TERMS);
}

// Extract reader-visible plain text from post body markdown (docs/search-requirements.md §3.2).
// Includes paragraphs, headings, lists, quotes, tables, links, inline code, code blocks, footnotes.
// Excludes markdown markup, URLs, image alt texts, raw HTML, and footnote reference marks.
function extractNodeBlocks(node: Root | RootContent): string[] {
  switch (node.type) {
    case 'root':
    case 'blockquote':
    case 'listItem':
    case 'footnoteDefinition':
      return node.children.flatMap(extractNodeBlocks);
    case 'list':
      return node.children.flatMap(extractNodeBlocks);
    case 'paragraph':
    case 'heading': {
      const text = phrasingText(node.children).trim();
      return text ? [text] : [];
    }
    case 'code': {
      const text = node.value.trim();
      return text ? [text] : [];
    }
    case 'table': {
      const lines: string[] = [];
      for (const row of node.children) {
        const cells: string[] = [];
        for (const cell of row.children) {
          const t = phrasingText(cell.children).trim();
          if (t) cells.push(t);
        }
        if (cells.length > 0) {
          lines.push(cells.join(' '));
        }
      }
      return lines;
    }
    default:
      return [];
  }
}

export function extractVisibleText(body: string): string {
  const tree = parser.parse(body) as Root;
  const blocks = extractNodeBlocks(tree);
  return blocks.join('\n');
}

export type VisibleTextEntry = {
  visibleText: string;
  visibleTextNorm: string;
};

export type CacheEntry = {
  body: string;
  visibleText: string;
  visibleTextNorm: string;
};

// Module-level in-memory cache for extracted visible texts and normalized strings (docs/search-requirements.md §3.1).
const visibleTextCache = new Map<number, CacheEntry>();

export function clearVisibleTextCache(): void {
  visibleTextCache.clear();
}

// Retrieve or extract visible text for the given posts, caching both plain and normalized text.
export function getVisibleTexts(
  posts: readonly { id: number; body: string }[],
  options?: {
    extractor?: (body: string) => string;
    normalizer?: (text: string) => string;
    cache?: Map<number, CacheEntry>;
  },
): Map<number, VisibleTextEntry> {
  const cache = options?.cache ?? visibleTextCache;
  const extractor = options?.extractor ?? extractVisibleText;
  const normalizer = options?.normalizer ?? normalizeString;

  // Evict posts that no longer exist in the active set
  const currentIds = new Set(posts.map((p) => p.id));
  for (const id of cache.keys()) {
    if (!currentIds.has(id)) {
      cache.delete(id);
    }
  }

  const result = new Map<number, VisibleTextEntry>();
  for (const post of posts) {
    const cached = cache.get(post.id);
    if (cached && cached.body === post.body) {
      result.set(post.id, {
        visibleText: cached.visibleText,
        visibleTextNorm: cached.visibleTextNorm,
      });
    } else {
      const visibleText = extractor(post.body);
      const visibleTextNorm = normalizer(visibleText);
      cache.set(post.id, { body: post.body, visibleText, visibleTextNorm });
      result.set(post.id, { visibleText, visibleTextNorm });
    }
  }

  return result;
}

// Split text into marked and unmarked spans matching any of the query terms (docs/search-requirements.md §4).
// Renders without dangerouslySetInnerHTML to guarantee safety against HTML injection.
export function splitMarks(text: string, terms: readonly string[]): MarkSegment[] {
  if (!text) return [];
  if (terms.length === 0) return [{ text, isMark: false }];

  const { norm, origStartMap, origEndMap } = normalizeWithMap(text);
  if (!norm) return [{ text, isMark: false }];

  type Span = { start: number; end: number };
  const spans: Span[] = [];

  for (const term of terms) {
    if (!term) continue;
    let pos = 0;
    while (pos <= norm.length - term.length) {
      const idx = norm.indexOf(term, pos);
      if (idx === -1) break;
      const origStart = origStartMap[idx];
      const origEnd = origEndMap[idx + term.length - 1];
      if (origStart !== undefined && origEnd !== undefined && origStart < origEnd) {
        spans.push({ start: origStart, end: origEnd });
      }
      pos = idx + 1;
    }
  }

  if (spans.length === 0) {
    return [{ text, isMark: false }];
  }

  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: Span[] = [spans[0]];
  for (let i = 1; i < spans.length; i++) {
    const last = merged[merged.length - 1];
    const curr = spans[i];
    if (curr.start <= last.end) {
      last.end = Math.max(last.end, curr.end);
    } else {
      merged.push(curr);
    }
  }

  const segments: MarkSegment[] = [];
  let cursor = 0;
  for (const span of merged) {
    if (span.start > cursor) {
      segments.push({ text: text.slice(cursor, span.start), isMark: false });
    }
    segments.push({ text: text.slice(span.start, span.end), isMark: true });
    cursor = span.end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), isMark: false });
  }

  return segments;
}

// Build a snippet around the first matching term, or fallback to excerptFromBody (docs/search-requirements.md §4).
// Collapses line breaks inside snippet text according to joinLine rules (docs/cms-features.md「説明文の自動抽出」).
export function buildSnippet(
  visibleBody: string,
  terms: readonly string[],
  fallbackBody: string,
): string {
  if (terms.length === 0) {
    return excerptFromBody(fallbackBody);
  }

  const { norm, origStartMap } = normalizeWithMap(visibleBody);
  let earliestNormIdx = -1;
  for (const term of terms) {
    if (!term) continue;
    const idx = norm.indexOf(term);
    if (idx !== -1) {
      if (earliestNormIdx === -1 || idx < earliestNormIdx) {
        earliestNormIdx = idx;
      }
    }
  }

  if (earliestNormIdx === -1) {
    return excerptFromBody(fallbackBody);
  }

  const origMatchStart = origStartMap[earliestNormIdx] ?? 0;
  const chars = Array.from(visibleBody);

  let matchCp = 0;
  let utf16 = 0;
  for (let i = 0; i < chars.length; i++) {
    if (utf16 >= origMatchStart) {
      matchCp = i;
      break;
    }
    utf16 += chars[i].length;
  }

  const startCp = Math.max(0, matchCp - SEARCH_SNIPPET_PRE_CHARS);
  const endCp = Math.min(chars.length, startCp + SEARCH_SNIPPET_CHARS);

  const hasLeftCut = startCp > 0;
  const hasRightCut = endCp < chars.length;

  const snippetCore = chars.slice(startCp, endCp).join('');
  const normalizedCore = normalizeExcerptText(snippetCore);
  return (hasLeftCut ? '…' : '') + normalizedCore + (hasRightCut ? '…' : '');
}

// Filter, score, and format matching posts (docs/search-requirements.md §3.3, §3.4).
export function searchPosts(
  posts: readonly Post[],
  query: string,
  options?: {
    extractor?: (body: string) => string;
    normalizer?: (text: string) => string;
    cache?: Map<number, CacheEntry>;
  },
): SearchResult[] {
  const terms = parseSearchTerms(query);
  if (terms.length === 0) {
    return [];
  }

  const visibleTexts = getVisibleTexts(posts, options);

  type MatchItem = {
    post: Post;
    visibleBody: string;
    titleMatchesAll: boolean;
  };

  const matches: MatchItem[] = [];

  for (const post of posts) {
    const titleNorm = normalizeString(post.title);
    const entry = visibleTexts.get(post.id);
    const visibleBody = entry?.visibleText ?? '';
    const visibleBodyNorm = entry?.visibleTextNorm ?? '';

    let allMatch = true;
    let titleMatchesAll = true;

    for (const term of terms) {
      const inTitle = titleNorm.includes(term);
      const inBody = visibleBodyNorm.includes(term);
      if (!inTitle && !inBody) {
        allMatch = false;
        break;
      }
      if (!inTitle) {
        titleMatchesAll = false;
      }
    }

    if (allMatch) {
      matches.push({
        post,
        visibleBody,
        titleMatchesAll,
      });
    }
  }

  // Sort: title contains all terms first, then date desc, then id desc
  matches.sort((a, b) => {
    if (a.titleMatchesAll !== b.titleMatchesAll) {
      return a.titleMatchesAll ? -1 : 1;
    }
    const dateCmp = b.post.date.localeCompare(a.post.date);
    if (dateCmp !== 0) return dateCmp;
    return b.post.id - a.post.id;
  });

  return matches.map(({ post, visibleBody }) => {
    const snippet = buildSnippet(visibleBody, terms, post.body);
    const titleSegments = splitMarks(post.title, terms);
    const snippetSegments = splitMarks(snippet, terms);
    return {
      post,
      titleSegments,
      snippetSegments,
    };
  });
}
