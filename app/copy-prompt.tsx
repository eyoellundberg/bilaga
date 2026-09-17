'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function CopyPrompt({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button type="button" className="copy-prompt" onClick={copy} aria-label="Copy the message for your agent">
      <span>{text}</span>
      {copied ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );
}
