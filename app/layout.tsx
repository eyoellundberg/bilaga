import type { Metadata } from 'next';
import './globals.css';
/* oxlint-disable next/no-html-link-for-pages */
export const metadata: Metadata = {
  title: 'Bilaga — File transfers for agents',
  description:
    'Your agent sends the file. Anyone with the link can download it.',
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
