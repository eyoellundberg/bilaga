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
            Early preview
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
            Anyone with the link can download it.
          </p>
          <a className="text-link" href="/docs">
            <Terminal size={18} />
            Connect your agent <ArrowUpRight size={18} />
          </a>
          <div className="facts">
            <span>30 days to download</span>
            <span>No recipient account</span>
          </div>
        </div>
        <UploadPanel />
      </section>
      <section id="pricing" className="pricing">
        <div>
          <p className="eyebrow">AT LAUNCH · USD</p>
          <h2>
            Add credit.
            <br />
            Let your agent send.
          </h2>
        </div>
        <div className="price launch-price">
          <span>$15 / $30</span>
          <p>
            prepaid top-ups
            <br />
            <strong>$0.10 per GB · $0.25 minimum per transfer</strong>
          </p>
        </div>
        <p className="pricing-note">
          1 GB: $0.25 · 10 GB: $1 · 50 GB: $5.
          <br />
          30 days to download at launch. Credit expires 24 months after each
          purchase. No subscription.
          <br />
          <strong>
            Today’s preview is free: 50 GB per file, 30 days to download.
            Large-file reliability testing and payments are still in progress.
          </strong>
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
