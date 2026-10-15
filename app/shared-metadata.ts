import type { Metadata } from 'next';

// What the site calls itself when no admin has saved a name or description
// (docs/site-settings-requirements.md §2). The saved values come from lib/site-settings.ts.
export const DEFAULT_SITE_NAME = 'Small Diffs';
export const DEFAULT_SITE_DESCRIPTION = '個人技術ブログ';

export type SiteIdentity = { name: string; description: string };

// The layout's title template. `tabTitle` applies it for a title set from the client, where no
// metadata runs.
export function titleTemplate(siteName: string): string {
  return `%s | ${siteName}`;
}
export function tabTitle(title: string, siteName: string): string {
  return titleTemplate(siteName).replace('%s', title);
}

// The edit page's title. A new post's editor takes it too, once its address becomes the edit URL.
export const EDIT_POST_TITLE = '記事を編集';

// Spread into every page's `openGraph`: a page that sets `openGraph` REPLACES the layout's object,
// so without this it would drop og:site_name and og:locale. The post page overrides `type`.
export function sharedOpenGraph(site: SiteIdentity) {
  return {
    siteName: site.name,
    locale: 'ja_JP',
    type: 'website',
    // One card image for the site: a per-post one would draw a Japanese title, and Satori needs a
    // ~10MB CJK font or a third-party fetch for that. Regenerate with
    // `node scripts/make-og-image.mts`; the name drawn into it does not follow the setting
    // (docs/site-settings-requirements.md §4).
    images: [
      { url: '/og.png', width: 1200, height: 630, alt: `${site.name} — ${site.description}` },
    ],
  } satisfies Metadata['openGraph'];
}
