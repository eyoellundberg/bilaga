/* oxlint-disable next/no-html-link-for-pages */
import { Brand } from '../brand';
export const metadata = { title: 'Terms of service — Bilaga' };
const sections = [
  [
    'Draft terms',
    'Updated 12 September 2026. Service operator: Lorem ipsum. Contact: Lorem ipsum. Business address: Lorem ipsum. These placeholders must be replaced before final publication. These terms describe the free private preview; paid terms are not yet available.',
  ],
  [
    'The service',
    'Bilaga lets authorized agents upload files, obtain public download links, address files to other accounts, and put a price on a file. Recipient accounts are not required to download an unpriced link. Every account can create and revoke agent tokens and send immediately. Sending is free. Balances are denominated in US cents, are granted by the operator, and cannot yet be purchased or withdrawn.',
  ],
  [
    'Your account and agent',
    'Protect your email account, API tokens, and download links. You are responsible for the agents you authorize and for their transfers. Revoke tokens you no longer trust. Tokens remain valid until revoked or account deletion. Agents cannot delete your account or manage website account controls. Sign-in links work once, expire after 15 minutes, and require the requesting browser.',
  ],
  [
    'Limits, chunks, and recovery',
    'Accepted files are nonempty and no larger than 50 decimal GB. Upload sequential chunks of 8 MiB, except the shorter final chunk. Matching retries are safe; changing bytes in an existing part is rejected. Save the private transfer ID and keep the original file unchanged. The Python client supports --resume; the browser does not provide durable resume after page closure. Unfinished uploads expire after 24 hours. Per-owner limits include three unfinished uploads, 100 transfers/day, 100 GB reserved storage, and 300 API requests/minute. Links allow 120 download requests/minute. A 50 GB accepted limit is not a guarantee of throughput or production reliability.',
  ],
  [
    'Availability and deletion',
    'Completed files are available for 30 days from completion, unless deleted earlier; older transfers retain their original expiry. Anyone with the link can download. Expired or deleted links cannot start new downloads, but downloads already underway may finish. Deletion queues permanent storage removal; scheduled cleanup may be delayed by failures or backlogs. Account deletion disables tokens, sessions, pending sign-in links, and download links immediately. Keep your own backups; Bilaga is a temporary transfer service.',
  ],
  [
    'Your files and permitted use',
    'You retain your rights in your files and authorize the processing necessary to store, deliver, and delete them. Upload only content you have the right to share. Do not upload unlawful content, malware, stolen credentials, or content that infringes others’ rights; do not evade limits, probe other accounts, or disrupt the service. Files are not malware-scanned. Recipients should assess files before opening them. Password-protected files receive no safety guarantee.',
  ],
  [
    'Abuse and service changes',
    'We may restrict access or disable transfers to address abuse, security risks, legal requirements, or preview operations. An abuse-reporting address and response process are still being established: Lorem ipsum. The preview may change or become unavailable. Download-request counts are not proof of completed downloads, unique recipients, or reading. “Sent” records an agent report of delivery.',
  ],
  [
    'Planned pricing',
    'When a recipient pays for a priced file, Bilaga transfers the price from the payer balance to the seller balance and retains a 5% fee; the settlement is recorded in the signed receipt. Storage is not charged separately. Paid uploads consume USD 0.10 of transfer credit per decimal GB, rounded up to a cent, with a USD 0.25 minimum per transfer. A one-time USD 15 purchase adds USD 15 credit (up to 150 GB); USD 30 adds USD 40 credit (up to 400 GB). Small transfers may reduce the total GB covered. Purchased credits are valid for three years from purchase; file downloads remain available for 30 days. Withdrawals, refunds, taxes, and the effect of account deletion on balances must be settled and disclosed before live payments launch.',
  ],
  [
    'Responsibility and applicable rights',
    'The service carries no promised uptime or recovery commitment. Nothing in these draft terms excludes mandatory consumer rights or liability that cannot lawfully be excluded. Operator jurisdiction, dispute provisions, and any enforceable liability terms remain to be confirmed before final publication.',
  ],
  [
    'Privacy and updates',
    'The privacy policy describes account information, essential cookies, file storage, link access, and deletion. Material changes will be communicated where appropriate. Final operator details and final terms must be available before public enrollment.',
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
        <h1>Terms of service</h1>
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
