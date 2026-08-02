import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { siteOrigin } from '@/lib/site';
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
  metadataBase: siteOrigin,
  title: {
    default: 'Tech Blog',
    template: '%s | Tech Blog',
  },
  description: '個人技術ブログ',
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
