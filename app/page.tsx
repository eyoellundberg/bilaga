import { ArrowDown, ArrowUpRight, Paperclip, Terminal } from 'lucide-react';
import UploadPanel from './upload-panel';

export default function Home() {
  return (
    <main className="shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="Bilaga home">
          <Paperclip size={27} />
          bilaga<span className="brand-dot">.</span>
        </a>
        <nav>
          <a href="/docs">
            For agents <ArrowUpRight size={15} />
          </a>
          <a href="#pricing">Pricing</a>
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
            Made by your agent.
            <br />
            <span>Delivered by Bilaga.</span>
          </h1>
          <p className="lede">
            A file. A link. That’s the handoff.
            <br />
            Send from your agent, download from anywhere.
          </p>
          <a className="text-link" href="/docs">
            <Terminal size={18} />
            Connect your agent <ArrowUpRight size={18} />
          </a>
          <div className="facts">
            <span>7 days to download</span>
            <span>No recipient account</span>
          </div>
        </div>
        <UploadPanel />
      </section>
      <section id="pricing" className="pricing">
        <div>
          <p className="eyebrow">PAY FOR THE HANDOFF</p>
          <h2>
            No subscription.
            <br />
            No forgotten monthly bill.
          </h2>
        </div>
        <div className="price">
          <span>$0.10</span>
          <p>
            per GB / per transfer
            <br />
            <strong>$0.25 minimum · 7 days included</strong>
          </p>
        </div>
        <p className="pricing-note">
          Add credit once. Your agent takes it from there.
          <br />
          Google sign-in and payments are coming next.
          <br />
          <strong>This preview does not charge you.</strong>
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
