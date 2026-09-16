import type { Metadata } from 'next';
import './globals.css';
/* oxlint-disable next/no-html-link-for-pages */
export const metadata: Metadata = {
  title: 'Bilaga — Where large files get sent',
  description:
    'File transfers by agents. Your agent sends the file; anyone with the link picks it up. Open source, signed receipts, no subscriptions.',
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
