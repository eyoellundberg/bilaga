/* oxlint-disable next/no-html-link-for-pages */
import { Brand } from '../brand';
import { OPERATOR, contactLine, legalIsDraft } from '@/lib/legal';
export const metadata = { title: 'Privacy — Bilaga' };
const sections = [
  [
    'Who we are',
    `Bilaga is operated by ${OPERATOR.name}, ${OPERATOR.country}. ${contactLine()} Updated ${OPERATOR.updated}.`,
  ],
  [
    'What we store',
    'Your email address, hashed agent tokens and sessions, and for each transfer: the filename, size, optional sender label, timestamps, and download counts. We store the files you upload, unchanged, for up to 30 days. For rate limiting we keep hashed IP addresses for a short time. If you pay, Stripe handles your card; we never see the card number, only that a payment succeeded.',
  ],
  [
    'Why',
    'To sign you in, run your transfers, stop abuse, and keep your balance right. Nothing else. No advertising, no analytics trackers, no selling data, and no training models on your files.',
  ],
  [
    'Who can see your files',
    'Anyone who has the download link. Keep links private if the file is private. Files are not scanned and not end-to-end encrypted. Cloudflare hosts the service and stores the files; Stripe processes payments; Google sees only that you signed in if you use Google sign-in.',
  ],
  [
    'Cookies',
    'One essential cookie keeps you signed in for up to 30 days, and one remembers which sign-in method you used last. No others.',
  ],
  [
    'Deleting',
    'Files are deleted 30 days after upload, or sooner if you delete them. Deleting your account revokes all tokens and links immediately and erases your email and filenames; stored files are removed shortly after. Copies already downloaded cannot be recalled. Receipts stay, with personal details redacted.',
  ],
  [
    'Your rights',
    'You can ask to see, correct, or erase your data, or object to how we use it. The quickest way to erase everything is to delete your account. You can also complain to your data protection authority; in Sweden that is IMY.',
  ],
];
export default function Privacy() {
  return (
    <main className="shell">
      <header className="site-header">
        <Brand />
        <nav>
          <a href="/">Send a file</a>
          <a href="/account">Account</a>
          <a href="/docs">For agents</a>
          <a href="/terms">Terms</a>
        </nav>
      </header>
      <article className="docs-content">
        <p className="eyebrow">{legalIsDraft() ? 'DRAFT' : 'PRIVACY'}</p>
        <h1>Privacy</h1>
        {sections.map(([heading, text]) => (
          <section key={heading}>
            <h2>{heading}</h2>
            <p>{text}</p>
          </section>
        ))}
      </article>
    </main>
  );
}
