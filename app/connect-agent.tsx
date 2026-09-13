'use client';

import { useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ConnectAgent() {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  const instructions =
    'Connect to Bilaga for file transfers. Read https://bilaga.link/llms.txt and use https://bilaga.link as the API address. Help me save my Bilaga API token in your secure credential storage, never in a URL or chat. Then upload files when I ask and return their download links. If you cannot store credentials securely, tell me what setup is needed.';

  async function copy() {
    try {
      await navigator.clipboard.writeText(instructions);
      setCopied(true);
      setError('');
    } catch {
      field.current?.focus();
      field.current?.select();
      setError('Select and copy the instructions below.');
    }
  }

  return (
    <section className="agent-connect" aria-labelledby="agent-connect-title">
      <h2 id="agent-connect-title">Give your agent the connection details</h2>
      <p>
        Paste this once so your agent knows where Bilaga is and how to use it.
        This does not sign you in or grant access to your account.
      </p>
      <textarea
        ref={field}
        className="agent-instructions"
        aria-label="Agent connection instructions"
        readOnly
        value={instructions}
        rows={6}
      />
      <Button type="button" className="action" onClick={copy}>
        {copied ? <Check size={16} /> : <Copy size={16} />}
        {copied ? 'Copied' : 'Copy connection details'}
      </Button>
      <output aria-live="polite">
        {error ||
          (copied
            ? 'Ready to paste into your agent.'
            : 'Use your private token only in secure credential setup, not in the chat message.')}
      </output>
    </section>
  );
}
