import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Bilaga — File delivery for agents',
  description: 'A file. A link. That’s the handoff. Share files from your agent with a simple download link, available for seven days.',
};
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="en"><body>{children}</body></html>;
}
