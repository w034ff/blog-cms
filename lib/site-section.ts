export type SiteSection = 'articles' | 'scribbles';

// Determine which site section the given pathname belongs to (docs/site-header-requirements.md §3.1).
// Paths without a slash boundary (e.g. /postsx, /tagsfoo) do not match.
export function getSiteSection(pathname: string): SiteSection | null {
  if (pathname === '/' || pathname === '') {
    return 'articles';
  }

  if (pathname === '/scribbles' || pathname.startsWith('/scribbles/')) {
    return 'scribbles';
  }

  if (
    pathname === '/posts' ||
    pathname.startsWith('/posts/') ||
    pathname === '/tags' ||
    pathname.startsWith('/tags/') ||
    pathname === '/categories' ||
    pathname.startsWith('/categories/') ||
    pathname === '/search' ||
    pathname.startsWith('/search/')
  ) {
    return 'articles';
  }

  return null;
}

// Extract the first unicode character (code point) as an uppercase letter for the account button.
// Uses Array.from to avoid splitting UTF-16 surrogate pairs (docs/site-header-requirements.md §3.3).
export function getInitialLetter(username: string): string {
  if (!username) return '';
  const [firstChar] = Array.from(username);
  return firstChar ? firstChar.toUpperCase() : '';
}
