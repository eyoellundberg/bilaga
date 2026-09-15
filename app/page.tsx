// Full document navigation keeps per-response CSP nonces consistent; file links must stay native.
/* oxlint-disable next/no-html-link-for-pages */
import { Brand } from '@/app/brand';
import { ArrowDown, ArrowUpRight, Terminal } from 'lucide-react';
import UploadPanel from './upload-panel';
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

// A free account cannot store more than FREE_STORED_BYTES, so that is also its
// largest file; paid files go up to MAX_BYTES.
const tiers = [
  {
    name: 'Free',
    price: usd(0),
    blurb: `${FREE_MONTHLY_TRANSFERS} transfers a month, files up to ${gbLabel(FREE_STORED_BYTES)}. No card.`,
    cta: 'Try free',
  },
  ...TOP_UP_PACKS.map((p, i) => ({
    name: p.name,
    price: usd(p.amount_cents),
    oneTime: true,
    blurb:
      `${usd(p.credit_cents)} of credit. Up to ${p.up_to_gb} GB of transfers, files up to ${gbLabel(MAX_BYTES)}.` +
      (i > 0 ? ` ${Math.round((1 - p.amount_cents / p.credit_cents / (TOP_UP_PACKS[0].amount_cents / TOP_UP_PACKS[0].credit_cents)) * 100)}% cheaper per GB.` : ''),
    cta: 'Buy once, use anytime',
  })),
];

export default function Home() {
  return (
    <main className="shell">
      <header className="site-header">
        <Brand />
        <nav>
          <a href="/docs">
            For agents <ArrowUpRight size={15} />
          </a>
          <a href="#pricing">Pricing</a>
          <a href="/account">Account</a>
          <span className="pill">
            <i />
            Open to everyone
          </span>
        </nav>
      </header>
      <section className="workspace">
        <div className="intro">
          <p className="eyebrow">THE LAST MILE FOR YOUR FILES</p>
          <h1>
            File transfers
            <br />
            <span>for agents.</span>
          </h1>
          <p className="lede">
            Your agent sends the file.
            <br />
            Another agent picks it up, and both get a signed receipt.
          </p>
          <a className="text-link" href="/docs">
            <Terminal size={18} />
            Connect your agent <ArrowUpRight size={18} />
          </a>
          <div className="facts">
            <span>Up to 50 GB</span>
            <span>30 days to download</span>
            <span>Signed receipts</span>
          </div>
        </div>
        <UploadPanel />
      </section>
      <section id="pricing" className="pricing">
        <div>
          <p className="eyebrow">PRICING · USD</p>
          <h2>Start free. Pay per use, never a subscription.</h2>
        </div>
        <div className="tiers">
          {tiers.map((t) => (
            <div className="tier" key={t.name}>
              <h3>{t.name}</h3>
              <p className="tier-price">
                {t.price} {'oneTime' in t ? <span>one-time</span> : null}
              </p>
              <p>{t.blurb}</p>
              <a className="tier-link" href="/account">
                {t.cta} <ArrowUpRight size={15} />
              </a>
            </div>
          ))}
        </div>
        <p className="pricing-note">
          {`Nothing renews and nothing is charged until you send. Paid transfers use ${usd(PRICE_CENTS_PER_GB)} of credit per GB with a ${usd(MINIMUM_CHARGE_CENTS)} minimum, and credit lasts ${CREDIT_VALIDITY_YEARS} years. Every plan: 30 days to download and a signed receipt that never expires.`}
        </p>
      </section>
      <footer>
        <span>
          bilaga <span className="muted">/ Swedish for attachment.</span>
        </span>
        <a href="/llms.txt">
          llms.txt <ArrowDown size={14} />
        </a>
      </footer>
    </main>
  );
}
