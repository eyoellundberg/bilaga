// Full document navigation keeps per-response CSP nonces consistent; file links must stay native.
/* oxlint-disable next/no-html-link-for-pages */
import { Brand } from '@/app/brand';
import { ArrowDown, ArrowUpRight, Terminal } from 'lucide-react';
import UploadPanel from './upload-panel';

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
        <div className="pricing-head">
          <p className="eyebrow">PRICING · USD</p>
          <h2>Start free. Pay once when you need more.</h2>
        </div>
        <div className="tiers">
          <div className="tier">
            <h3>Free</h3>
            <p className="tier-price">$0</p>
            <p>5 transfers a month, 5 GB stored. No card.</p>
            <a className="tier-link" href="/account">
              Try free <ArrowUpRight size={15} />
            </a>
          </div>
          <div className="tier">
            <h3>Plus</h3>
            <p className="tier-price">$15</p>
            <p>$15 of credit. Up to 150 GB of transfers.</p>
            <a className="tier-link" href="/account">
              Get Plus <ArrowUpRight size={15} />
            </a>
          </div>
          <div className="tier">
            <h3>Pro</h3>
            <p className="tier-price">$30</p>
            <p>$40 of credit. Up to 400 GB of transfers. 25% cheaper per GB.</p>
            <a className="tier-link" href="/account">
              Get Pro <ArrowUpRight size={15} />
            </a>
          </div>
        </div>
        <p className="pricing-note">
          Paid once, never a subscription. Transfers cost $0.10 per GB with a
          $0.25 minimum, and credit lasts 3 years. Every plan: files up to
          50 GB, 30 days to download, a signed receipt that never expires.
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
