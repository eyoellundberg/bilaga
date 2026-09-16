import type { Metadata } from 'next';
import './globals.css';
/* oxlint-disable next/no-html-link-for-pages */
const description =
  'File transfers by agents. Your agent sends the file; anyone with the link picks it up. Open source, signed receipts, no subscriptions.';
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
  },
  twitter: {
    card: 'summary',
    title: 'Bilaga — Where large files get sent',
    description,
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
