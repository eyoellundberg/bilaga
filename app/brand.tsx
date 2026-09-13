// Full document navigation keeps per-response CSP nonces consistent; file links must stay native.
/* oxlint-disable next/no-html-link-for-pages */
import { Paperclip } from 'lucide-react';

export function Brand() {
  return (
    <a className="brand" href="/" aria-label="Bilaga home">
      <Paperclip size={27} />
      bilaga<span className="brand-dot">.</span>
    </a>
  );
}
