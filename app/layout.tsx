import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans_JP } from 'next/font/google';
import { siteIndexable, siteOrigin } from '@/lib/site';
import { getSiteIdentity } from '@/lib/site-settings';
import { sharedOpenGraph, titleTemplate } from './shared-metadata';
import './globals.css';

// One family for Japanese and Latin, so a heading like 「Next.js のキャッシュ」 is one weight and
// one height; the OS's Japanese face is no longer what a reader sees. Not a variable font, so the
// weights are listed: the ones Tailwind's `font-*` utilities in use ask for.
//
// `preload: false`: Google serves this family as ~90 numbered unicode-range slices per weight with
// no `latin` label, so `subsets` cannot narrow the preload and every slice got a <link
// rel=preload> — 368 fonts on each page, which held hydration back past the X embed's one
// `resize` (docs/embed-requirements.md §10.5). Unpreloaded, a page fetches only the slices its
// text uses.
const plexSans = IBM_Plex_Sans_JP({
  variable: '--font-plex-sans',
  weight: ['400', '500', '600', '700'],
  preload: false,
});

const plexMono = IBM_Plex_Mono({
  variable: '--font-plex-mono',
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
});

// A function, since the name and description are an admin's setting (lib/site-settings.ts).
export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteIdentity();
  return {
    // og:url and og:image are written as paths and made absolute here, so moving the site is a
    // change of SITE_ORIGIN (lib/site.ts) and nothing else.
    metadataBase: siteOrigin,
    // Off unless this is the published address (lib/site.ts). app/robots.ts refuses crawlers on the
    // same signal; this covers one that found the URL elsewhere.
    ...(siteIndexable ? {} : { robots: { index: false, follow: false } }),
    title: {
      default: site.name,
      template: titleTemplate(site.name),
    },
    description: site.description,
    // Emits <link rel="alternate" type="application/rss+xml">; app/rss.xml/route.ts serves it.
    alternates: { types: { 'application/rss+xml': '/rss.xml' } },
    openGraph: {
      ...sharedOpenGraph(site),
      title: site.name,
      description: site.description,
      url: '/',
    },
    // Inherited by every page that doesn't set `twitter`; X falls back to the og: tags for the rest.
    twitter: { card: 'summary_large_image' },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // No scroll-behavior here: on <html> it would reach the editor, where it degrades typing
    // (app/globals.css scopes it to the post page and says why).
    <html lang='ja' className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}>
      <body className='min-h-full flex flex-col'>
        {/* No chrome here: a nested layout cannot take a parent's chrome back off, so the reader's
            shell (app/(site)/layout.tsx) and /admin's bring their own. Both put a `flex-1` main in
            this flex column. */}
        {children}
      </body>
    </html>
  );
}
