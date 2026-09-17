/* oxlint-disable next/no-html-link-for-pages */
import { Brand } from '../brand';
import { OPERATOR, contactLine, legalIsDraft } from '@/lib/legal';
import {
  CREDIT_VALIDITY_YEARS,
  FREE_MONTHLY_TRANSFERS,
  FREE_STORED_BYTES,
  MAX_BYTES,
  MINIMUM_CHARGE_CENTS,
  PRICE_CENTS_PER_GB,
  TOP_UP_PACKS,
  gbLabel,
  usd,
} from '@/lib/rules';
export const metadata = { title: 'Terms — Bilaga' };
const packs = TOP_UP_PACKS.map((p) => `${p.name} is ${usd(p.amount_cents)} for ${usd(p.credit_cents)} of credit`).join('; ');
const sections = [
  [
    'Who we are',
    `Bilaga is operated by ${OPERATOR.name}, ${OPERATOR.country}. ${contactLine()} Updated ${OPERATOR.updated}.`,
  ],
  [
    'What Bilaga does',
    `Your agent uploads a file and gets a public download link. Anyone with the link can download it for 30 days. Recipients need no account. Every transfer gets a signed receipt that stays verifiable after the file is gone. Files are stored as-is: not scanned, not end-to-end encrypted. Do not use Bilaga for secrets.`,
  ],
  [
    'Your account',
    'You sign in with an emailed link or Google. You create agent tokens and are responsible for what your agents send. Revoke any token you no longer trust. Agents cannot delete your account; only you can, from the account page.',
  ],
  [
    'What it costs',
    `Every account gets ${FREE_MONTHLY_TRANSFERS} transfers per rolling 30 days and ${gbLabel(FREE_STORED_BYTES)} stored, free. Beyond that, a transfer costs ${usd(PRICE_CENTS_PER_GB)} of credit per decimal GB, with a ${usd(MINIMUM_CHARGE_CENTS)} minimum, charged when the transfer is created and refunded if the upload never completes. Credit is bought once by card: ${packs}. Credit is valid for ${CREDIT_VALIDITY_YEARS} years, is not refundable or withdrawable, and is lost if you delete your account. Oldest credit is used first. Upload refunds keep the original expiry date and do not restore expired portions. We show expiry dates in your account and email a reminder 30 days before unused credit expires. Existing credit retains its previous terms. There is no subscription and nothing renews. Files up to ${gbLabel(MAX_BYTES)}.`,
  ],
  [
    'What you may not do',
    'Do not upload anything unlawful, malware, stolen data, or content you have no right to share. Do not probe other accounts or disrupt the service. We may remove files and close accounts that break these rules. Files can also be removed when the law requires it.',
  ],
  [
    'Abuse and takedowns',
    `Files are not scanned. We do not look at what you send, and we cannot tell you a file is safe; treat every download link as you would an attachment from a stranger. If a file on Bilaga is unlawful, malicious, or yours without your permission, email ${OPERATOR.contact} with the download link and what is wrong. We read reports ourselves, remove files that break these terms, close the accounts that sent them, and reply to the reporter. Removal also expires the download link; the signed receipt stays, redacted, so the record that the transfer happened is kept.`,
  ],
  [
    'No guarantees',
    'Bilaga is provided as is. We do not promise uptime, delivery, or recovery of lost files. Keep your own copy. Download counts are request counts, not proof anyone received the file. Our liability is limited to the amount you paid us in the past 12 months, except where the law does not allow that limit.',
  ],
  [
    'Changes',
    'We may change these terms. The date at the top tells you when. Continuing to use Bilaga after a change means you accept it. Swedish law applies.',
  ],
];
export default function Terms() {
  return (
    <main className="shell">
      <header className="site-header">
        <Brand />
        <input type="checkbox" id="nav-toggle" className="nav-toggle" />
        <label htmlFor="nav-toggle" className="nav-burger" aria-label="Menu">
          <span />
          <span />
          <span />
        </label>
        <nav className="nav-collapsible">
          <a href="/">Send a file</a>
          <a href="/account">Account</a>
          <a href="/docs">For agents</a>
          <a href="/privacy">Privacy</a>
        </nav>
      </header>
      <article className="docs-content">
        <p className="eyebrow">{legalIsDraft() ? 'DRAFT' : 'TERMS'}</p>
        <h1>Terms</h1>
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
