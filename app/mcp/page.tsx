// Full document navigation keeps per-response CSP nonces consistent; file links must stay native.
/* oxlint-disable next/no-html-link-for-pages */
import { Brand } from '@/app/brand';
import { ArrowUpRight } from 'lucide-react';
export const metadata = {
  title: 'Bilaga MCP server',
  description: 'Send and receive files up to 50 GB from any MCP-capable agent with npx bilaga-mcp.',
};
const tools: [string, string][] = [
  ['send_file', 'Upload a local file and return a share_url valid for 30 days. Optional to, in_reply_to, sender, and resume.'],
  ['get_transfer, list_transfers, mark_sent, delete_transfer', 'Inspect, record delivery of, and revoke your transfers.'],
  ['list_inbox, download_file, acknowledge_received, pay_transfer', 'Receive transfers addressed to your account’s email.'],
  ['get_account, get_balance, get_quote, get_config', 'Handle, credit, prices, and limits.'],
  ['list_events, get_receipt', 'Signed event log and delivery receipts.'],
  ['get_webhook, set_webhook, delete_webhook, test_webhook', 'One https webhook per account.'],
  ['create_file_request, list_file_requests, get_file_request, revoke_file_request, get_file_request_receipt', 'Collect files from people who have no account.'],
];
export default function Mcp() {
  return (
    <main className="shell">
      <header className="site-header">
        <Brand />
        <nav>
          <a href="/docs">
            For agents <ArrowUpRight size={15} />
          </a>
        </nav>
      </header>
      <article className="docs-content">
        <p className="eyebrow">MCP</p>
        <h1>Bilaga as an MCP server.</h1>
        <p>
          <code>bilaga-mcp</code> is a local Model Context Protocol server over
          stdio. It exposes the Bilaga API as tools so that Claude, Cursor, or
          any MCP client can send a file up to 50 GB and hand back a share
          link, without the agent ever seeing the chunked upload protocol.
          The file goes straight from your machine to Bilaga. Source is
          MIT-licensed and published on{' '}
          <a className="text-link" href="https://www.npmjs.com/package/bilaga-mcp">npm</a>.
        </p>
        <h2>1. Get a token</h2>
        <p>
          Sign in at <a className="text-link" href="/account">/account</a> and
          create an agent token. It is shown once. Keep it in your MCP client’s
          environment, never in a prompt or a shared URL.
        </p>
        <h2>2. Add the server</h2>
        <p>Claude Code:</p>
        <pre>{`claude mcp add bilaga -e BILAGA_TOKEN=YOUR_AGENT_TOKEN -- npx -y bilaga-mcp`}</pre>
        <p>Claude Desktop, Cursor, and other clients that read a JSON config:</p>
        <pre>{`{
  "mcpServers": {
    "bilaga": {
      "command": "npx",
      "args": ["-y", "bilaga-mcp"],
      "env": { "BILAGA_TOKEN": "YOUR_AGENT_TOKEN" }
    }
  }
}`}</pre>
        <p>
          Node 20 or newer is required. Then ask the agent to send a file: it
          calls <code>send_file</code> with the path and reports the link.
        </p>
        <h2>3. Tools</h2>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Tool</th><th>What it does</th></tr></thead>
            <tbody>{tools.map(([k, v]) => <tr key={k}><td><code>{k}</code></td><td>{v}</td></tr>)}</tbody>
          </table>
        </div>
        <p>
          API errors are returned as tool errors carrying the Bilaga error
          code, so an agent can stop on <code>402 insufficient_balance</code>{' '}
          or <code>429 account_limit</code> instead of retrying blindly. The
          tool descriptions repeat the rules from{' '}
          <a className="text-link" href="/llms.txt">llms.txt</a>: share only the
          public link, deliver it yourself and call <code>mark_sent</code>,
          and read <code>charged_usd</code> before claiming a payment was
          taken.
        </p>
        <h2>4. Without MCP</h2>
        <p>
          Everything the server does is plain HTTP. The{' '}
          <a className="text-link" href="/docs">API guide</a> and the{' '}
          <a className="text-link" href="/bilaga.py">Python client</a> cover
          the same operations for agents that call the API directly.
        </p>
        <h2>5. Remote MCP</h2>
        <p>
          There is no hosted MCP endpoint yet. A remote server needs OAuth and
          a way to get the file to Bilaga from somewhere other than your disk;
          both are planned but not built. Use the local server for now.
        </p>
      </article>
      <footer>
        <span>bilaga / File delivery for agents.</span>
        <a href="/docs">
          Connect your agent <ArrowUpRight size={14} />
        </a>
      </footer>
    </main>
  );
}
