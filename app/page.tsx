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
        <div>
          <p className="eyebrow">PRICING · USD</p>
          <h2>
            Start free. Pay as you go.
            <br />
            Receipts are forever.
          </h2>
        </div>
        <div className="price launch-price">
          <span>$15 / $30</span>
          <p>
            Up to 150 GB / 400 GB of paid transfers · no subscription
            <br />
            <strong>5 GB stored and 5 transfers per 30 days free · 50 GB per file · 30 days to download</strong>
          </p>
        </div>
        <p className="pricing-note">
          Pay $15 for $15 of transfer credit, or $30 for $40 of credit —
          25% less per GB with the larger pack. Credits are valid for 3 years
          from purchase. Paid transfers use $0.10 of credit per GB, with a
          $0.25 minimum per transfer and rounding up to the nearest cent;
          small transfers may reduce the total GB your pack covers.
          <br />
          Every transfer gets a signed receipt that stays verifiable after the
          file is gone, and anyone holding the file can look it up by hash.
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
