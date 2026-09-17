// Full document navigation keeps per-response CSP nonces consistent; file links must stay native.
/* oxlint-disable next/no-html-link-for-pages */
import { Brand } from '@/app/brand';
import { ArrowDown, ArrowUpRight, Terminal } from 'lucide-react';
import UploadPanel from './upload-panel';
import { CopyPrompt } from './copy-prompt';
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

// Structured data for search engines and LLM crawlers. A data block is not
// executed, so it needs no CSP nonce.
const jsonLd = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Bilaga',
  url: 'https://bilaga.link',
  applicationCategory: 'UtilitiesApplication',
  operatingSystem: 'Any',
  description:
    'File transfers for agents. Your agent sends a file up to 50 GB; anyone with the link picks it up within 30 days. Every transfer gets a signed receipt. Open source under MIT, no subscriptions.',
  license: 'https://opensource.org/licenses/MIT',
  codeRepository: 'https://github.com/eyoellundberg/bilaga',
  offers: [
    { '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'USD' },
    ...TOP_UP_PACKS.map((p) => ({
      '@type': 'Offer',
      name: p.name,
      price: (p.amount_cents / 100).toFixed(2),
      priceCurrency: 'USD',
    })),
  ],
});

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
        <input type="checkbox" id="nav-toggle" className="nav-toggle" />
        <label htmlFor="nav-toggle" className="nav-burger" aria-label="Menu">
          <span />
          <span />
          <span />
        </label>
        <nav className="nav-collapsible">
          <a href="/docs">
            For agents <ArrowUpRight size={15} />
          </a>
          <a href="#how">How it works</a>
          <a href="#pricing">Pricing</a>
          <a href="/account">Account</a>
          <span className="pill">
            <i />
            Open to everyone
          </span>
        </nav>
      </header>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <section className="workspace">
        <div className="intro">
          <p className="eyebrow">THE LAST MILE FOR YOUR FILES</p>
          <h1>
            File transfers
            <br />
            <span>for agents.</span>
          </h1>
          <p className="lede">
            Ask your AI agent to send a file. It hands back a link.
            <br />
            Anyone can open it, no account needed. Every transfer gets a signed receipt.
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
          <a
            className="product-hunt-badge"
            href="https://www.producthunt.com/products/bilaga?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-bilaga"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Find Bilaga on Product Hunt"
          >
            {/* Product Hunt serves this live SVG; the site's image proxy is disabled. */}
            {/* oxlint-disable-next-line next/no-img-element */}
            <img
              src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1253070&theme=light&t=1789629066925"
              alt="Bilaga — File transfers for agents on Product Hunt"
              width="250"
              height="54"
            />
          </a>
        </div>
        <UploadPanel />
      </section>
      <section id="how" className="pricing">
        <div>
          <p className="eyebrow">HOW IT WORKS</p>
          <h2>Two steps. Then it is just something your agent can do.</h2>
        </div>
        <div className="tiers">
          <div className="tier">
            <h3>1 · Create a free account</h3>
            <p>Sign in with email or Google. No card, no subscription.</p>
            <a className="tier-link" href="/account">
              Create account <ArrowUpRight size={15} />
            </a>
          </div>
          <div className="tier">
            <h3>2 · Connect your agent</h3>
            <p>
              Press &ldquo;Connect an agent&rdquo; on your account page and paste the one line it gives you into Codex
              or Claude Code. Any other agent: send it this.
            </p>
            <CopyPrompt text="Connect to bilaga.link so you can send files for me. Setup is at https://bilaga.link/llms.txt" />
          </div>
          <div className="tier">
            <h3>That&apos;s it</h3>
            <p>
              Now say &ldquo;send the render to Maya&rdquo; and go do something else. Your agent uploads the file and
              passes on the link.
            </p>
            <a className="tier-link" href="/docs">
              Full setup guide <ArrowUpRight size={15} />
            </a>
          </div>
        </div>
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
        <a href="https://x.com/bilagalink" target="_blank" rel="noopener noreferrer">
          @bilagalink <ArrowUpRight size={14} />
        </a>
        <a href="/llms.txt">
          llms.txt <ArrowDown size={14} />
        </a>
      </footer>
    </main>
  );
}
