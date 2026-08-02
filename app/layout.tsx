import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
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
  openGraph: {
    ...sharedOpenGraph,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: '/',
  },
  // No image yet, so `summary` rather than `summary_large_image`: the wide card
  // reserves space for a picture and looks broken without one. Inherited by every
  // page that doesn't set `twitter` itself, and Twitter/X falls back to the og:
  // tags for the title and description.
  twitter: { card: 'summary' },
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
        <SiteHeader />
        {/* No max-width here (moved into each page's own root element): the post page needs to
            go wider than the rest of the site for its table-of-contents rail, and a shared
            constraint here would clip that per-page choice. */}
        <main className='flex-1 w-full px-4 py-8'>{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
