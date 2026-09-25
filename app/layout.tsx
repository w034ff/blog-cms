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
  // og:url and og:image are written as paths and made absolute here, so moving the site is a
  // change of SITE_ORIGIN (lib/site.ts) and nothing else.
  metadataBase: siteOrigin,
  // Off unless this is the published address (lib/site.ts). app/robots.ts refuses crawlers on the
  // same signal; this covers one that found the URL elsewhere.
  ...(siteIndexable ? {} : { robots: { index: false, follow: false } }),
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  // Emits <link rel="alternate" type="application/rss+xml">; app/rss.xml/route.ts serves it.
  alternates: { types: { 'application/rss+xml': '/rss.xml' } },
  openGraph: {
    ...sharedOpenGraph,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: '/',
  },
  // Inherited by every page that doesn't set `twitter`; X falls back to the og: tags for the rest.
  twitter: { card: 'summary_large_image' },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // No scroll-behavior here: on <html> it would reach the editor, where it degrades typing
    // (app/globals.css scopes it to the post page and says why).
    <html lang='ja' className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className='min-h-full flex flex-col'>
        {/* No chrome here: a nested layout cannot take a parent's chrome back off, so the reader's
            shell (app/(site)/layout.tsx) and /admin's bring their own. Both put a `flex-1` main in
            this flex column. */}
        {children}
      </body>
    </html>
  );
}
