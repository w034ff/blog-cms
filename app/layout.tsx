import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { siteIndexable, siteOrigin } from '@/lib/site';
import { SITE_DESCRIPTION, SITE_NAME, sharedOpenGraph } from './shared-metadata';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  // The base every relative metadata URL resolves against (og:image, canonical).
  // Nothing sets one of those yet, so this changes no output today — it is here so
  // that when they land, the host they point at comes from SITE_ORIGIN (lib/site.ts)
  // instead of being written into the source. Without it, Next fails the build on
  // the first relative metadata URL rather than guessing.
  // The base every relative metadata URL resolves against — og:url below is
  // written as a path and becomes absolute through this, so moving the site is a
  // change of SITE_ORIGIN (lib/site.ts) and nothing else.
  metadataBase: siteOrigin,
  // Off unless the environment says this is the published address (lib/site.ts).
  // app/robots.ts refuses crawlers on the same signal; this covers the page a
  // crawler reaches anyway, having found the URL somewhere other than robots.txt.
  ...(siteIndexable ? {} : { robots: { index: false, follow: false } }),
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  // Rendered as <link rel="alternate" type="application/rss+xml" href="/rss.xml">
  // — Next's Metadata API owns the tag; app/rss.xml/route.ts serves the feed.
  alternates: { types: { 'application/rss+xml': '/rss.xml' } },
  openGraph: {
    ...sharedOpenGraph,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: '/',
  },
  // The wide card, now that there is an image to fill it. Inherited by every page
  // that doesn't set `twitter` itself, and Twitter/X falls back to the og: tags
  // for the title, description and image.
  twitter: { card: 'summary_large_image' },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // No scroll-behavior here: it belongs to the scrolling element, so a `smooth` set on <html>
    // would reach every route — including the editor, where it degrades typing (app/globals.css
    // scopes it to the post page instead, with the reason spelled out there).
    <html lang='ja' className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className='min-h-full flex flex-col'>
        {/* No chrome here — only <html>/<body>. The site's header and footer belong to the
            reader's shell (app/(site)/layout.tsx) and /admin brings its own, because a nested
            layout cannot take a parent's chrome back off. The flex column stays: both shells
            put a `flex-1` main inside it. */}
        {children}
      </body>
    </html>
  );
}
