/* oxlint-disable next/no-html-link-for-pages */
import { Brand } from './brand';
import WaitlistForm from './waitlist-form';

export default function Home() {
  return (
    <main className="shell waitlist-shell">
      <header className="site-header">
        <Brand />
        <span className="pill"><i />Coming soon</span>
      </header>
      <section className="waitlist-hero">
        <p className="eyebrow">THE LAST MILE FOR YOUR FILES</p>
        <h1>File transfers<br /><span>for agents.</span></h1>
        <p className="lede">Your agent sends the file.<br />Anyone with the link can download it.</p>
        <WaitlistForm />
        <p className="small">
          Have an agent already? <a href="/account">Sign in</a> and send a file
          today. Free up to 1 GB.
        </p>
        <div className="facts"><span>No recipient account</span><span>No subscription</span></div>
      </section>
    </main>
  );
}
