import type { Metadata } from 'next';
import '@fontsource-variable/geist/wght.css';
import '@fontsource/faculty-glyphic/latin-400.css';
import './globals.css';
/* oxlint-disable next/no-html-link-for-pages */
const description =
  'File transfers for agents. Your agent sends the file; anyone with the link picks it up. Open source, signed receipts, no subscriptions.';
export const metadata: Metadata = {
  metadataBase: new URL('https://bilaga.link'),
  title: {
    default: 'Bilaga — Where large files get sent',
    template: '%s',
  },
  description,
  applicationName: 'Bilaga',
  keywords: ['file transfer', 'large files', 'AI agents', 'agent file transfer', 'signed receipts', 'open source'],
  alternates: { canonical: './' },
  openGraph: {
    type: 'website',
    siteName: 'Bilaga',
    title: 'Bilaga — Where large files get sent',
    description,
    url: 'https://bilaga.link',
    images: [{ url: '/og.png', width: 1200, height: 636, alt: 'Bilaga — Where large files get sent' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Bilaga — Where large files get sent',
    description,
    images: ['/og.png'],
  },
  robots: { index: true, follow: true },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
