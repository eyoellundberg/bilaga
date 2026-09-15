/* oxlint-disable next/no-html-link-for-pages */
import { Brand } from '../brand';
export const metadata = { title: 'Privacy policy — Bilaga' };
const sections = [
  [
    'Draft notice',
    'Updated 12 September 2026. Operator: Lorem ipsum. Contact: Lorem ipsum. Business address: Lorem ipsum. These are placeholders; operator details and provider arrangements must be confirmed before this notice is published as final.',
  ],
  [
    'What we collect',
    'We store your email address, account creation time, agent token names and hashes, session and login-link hashes, and transfer metadata: filename, size, optional sender label, lifecycle times, and download-request counts. We store the file bytes you upload. Requests expose network information to Cloudflare; the app hashes IP addresses and email addresses for login rate limits. Login emails are handled by Cloudflare Email Service and your email provider.',
  ],
  [
    'Why we use it',
    'We use account and transfer information to provide sign-in, agent access, storage, download links, and account controls, as necessary to provide the service you request. We use security and rate-limit data for our legitimate interest in preventing abuse and protecting the service. Required account information is necessary to create and use an account. We do not use advertising analytics or sell uploaded files or account data.',
  ],
  [
    'Who can access files',
    'Anyone with a valid download link can access the filename, size, sender label when supplied, expiry, and file bytes. Keep links private when files are private. Cloudflare operates the hosting, database, object storage, and login email infrastructure. Bilaga does not send recipient delivery messages. Files are not end-to-end encrypted; do not use this preview for secrets or highly sensitive data. We do not scan files for malware or use uploaded files to train models.',
  ],
  [
    'Cookies and browser storage',
    'Essential HttpOnly cookies bind your login request to this browser for 15 minutes and keep you signed in for up to 30 days. Signing out revokes that browser session. The application does not set advertising or analytics cookies. Your agent should keep API tokens in its own secure settings; we store only hashes.',
  ],
  [
    'Retention and deletion',
    'Login links expire after 15 minutes; sessions after 30 days. Cleanup removes expired login links and sessions. Unfinished uploads expire after 24 hours. Completed transfers expire after 30 days; older files retain their original expiry. Expiry stops new downloads. A scheduled job runs every 15 minutes and purges up to 25 eligible transfers; failures and backlogs can delay physical deletion. Transfer metadata normally remains for status after file purge. Account deletion immediately revokes credentials, pending login links, and file links and redacts personal fields; stored files are queued for removal. Redacted tombstones remain at least one day and until storage purge succeeds. Recipient copies and downloads already underway cannot be recalled. Hashed rate-limit entries become eligible for bounded cleanup after their window expires; cleanup backlogs may delay removal.',
  ],
  [
    'Your rights',
    'Where applicable, you may request access, correction, erasure, restriction, portability, or object to processing based on legitimate interests. Delete your account through /account. Contact details for other requests are Lorem ipsum pending confirmation. You may complain to your local data protection authority, including IMY in Sweden. We do not make automated decisions with legal or similarly significant effects about you.',
  ],
  [
    'International processing and outstanding details',
    'Cloudflare may process requests and data across its global infrastructure. Before public enrollment, we must confirm the applicable processor agreements, locations, international-transfer safeguards, provider email/log/backup retention, the role of Bilaga for customer-uploaded personal data, and any required data processing agreement. We do not claim EU-only storage or a verified backup-erasure deadline. These unresolved details prevent this draft from serving as a final public notice.',
  ],
  [
    'Changes',
    'We will date policy updates and communicate material changes where appropriate. Balances are operator-granted credits recorded in an account ledger; card payment data is not collected, and payment-data disclosures will be added before card top-ups launch.',
  ],
];
export default function Policy() {
  return (
    <main className="shell">
      <header className="site-header">
        <Brand />
        <nav>
          <a href="/">Send a file</a>
          <a href="/account">Account</a>
          <a href="/docs">For agents</a>
        </nav>
      </header>
      <article className="docs-content">
        <p className="eyebrow">DRAFT</p>
        <h1>Privacy policy</h1>
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
