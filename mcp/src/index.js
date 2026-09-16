#!/usr/bin/env node
// Bilaga MCP server (stdio). Exposes Bilaga file transfers as MCP tools.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { BilagaClient, BilagaError } from './client.js';
import { loadToken, runSetup, tokenPath } from './setup.js';

export function createServer(client) {
  const server = new McpServer(
    { name: 'bilaga', version: '0.2.0' },
    {
      instructions: [
        'Bilaga sends large files (up to 50 GB) and returns a share link valid for 30 days.',
        'Use send_file to upload a local file and get a share_url. Share only share_url, never the private transfer id.',
        'Bilaga does not deliver links; hand the share_url to the recipient through your own channel, then call mark_sent.',
        'Transfers outside the free allowance are charged from the account balance; read charged_usd on the result. On 402 insufficient_balance, stop and tell the user to add credit at https://bilaga.link/account.',
        'Addressed transfers (to=email) appear in the recipient agent\'s inbox; the recipient calls download_file or acknowledge_received.',
        'Poll get_transfer no faster than every 15 seconds; prefer list_events.',
      ].join(' '),
    },
  );

  const ok = (value) => ({
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined,
  });
  const fail = (err) => ({
    isError: true,
    content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
    structuredContent: err instanceof BilagaError ? { status: err.status, code: err.code, error: err.body?.error } : undefined,
  });
  const tool = (name, description, schema, handler) =>
    server.registerTool(name, { description, inputSchema: schema }, async (args) => {
      try {
        return ok(await handler(args ?? {}));
      } catch (err) {
        return fail(err);
      }
    });

  // Sending
  tool(
    'send_file',
    'Upload a local file to Bilaga and return a share_url valid for 30 days. Uploads in 8 MiB parts with retries; for files of many GB this can take a long time. Optional `to` addresses the transfer to another agent\'s inbox by email; `in_reply_to` makes it a reply to a transfer addressed to you. If an upload was interrupted, call again with `resume` set to the transfer id from the error/log and the same unchanged file.',
    {
      path: z.string().describe('Absolute or relative path to the local file to send.'),
      to: z.string().email().optional().describe('Recipient email; the transfer appears in that account\'s inbox.'),
      in_reply_to: z.string().optional().describe('Public id of a transfer addressed to you that this file replies to.'),
      sender: z.string().optional().describe('Sender label shown on the download page and receipt.'),
      price_cents: z.number().int().min(0).max(1_000_000).optional().describe('Experimental: charge the recipient this amount before download. Requires `to`.'),
      resume: z.string().optional().describe('Private transfer id of an unfinished upload to resume.'),
    },
    async ({ path, to, in_reply_to, sender, price_cents, resume }) =>
      client.sendFile({ path, to, inReplyTo: in_reply_to, sender, priceCents: price_cents, resume }),
  );
  tool('get_transfer', 'Get the status of one of your transfers by private id, including parts uploaded, share_url, download_requests, and received_at.', { id: z.string() }, ({ id }) =>
    client.api(`transfers/${encodeURIComponent(id)}`),
  );
  tool('list_transfers', 'List your latest 50 transfers. Use to recover a transfer id after a lost response.', {}, () => client.api('transfers'));
  tool('mark_sent', 'Record that you delivered the share link to the recipient. Bilaga does not send links itself.', { id: z.string() }, ({ id }) =>
    client.api(`transfers/${encodeURIComponent(id)}/sent`, { method: 'POST', retry: true }),
  );
  tool('delete_transfer', 'Revoke a share link and delete the stored bytes. Irreversible. Safe to retry.', { id: z.string() }, ({ id }) =>
    client.api(`transfers/${encodeURIComponent(id)}`, { method: 'DELETE', retry: true }),
  );

  // Receiving
  tool('list_inbox', 'List transfers other agents addressed to this account\'s email. Entries have public_id, from_account, download_url, and receipt_url.', {}, () =>
    client.api('inbox'),
  );
  tool(
    'download_file',
    'Download a transfer addressed to you by public id to a local path, and record receipt for the sender. Returns the saved path, size, and sha256. Refuses to overwrite unless overwrite=true.',
    {
      public_id: z.string(),
      out_path: z.string().optional().describe('Where to save. Defaults to the original filename in the current directory.'),
      overwrite: z.boolean().optional(),
    },
    ({ public_id, out_path, overwrite }) => client.downloadFile({ publicId: public_id, outPath: out_path, overwrite }),
  );
  tool('acknowledge_received', 'Record receipt of an addressed transfer without downloading it. Sets received_at on the sender\'s transfer.', { public_id: z.string() }, ({ public_id }) =>
    client.api(`inbox/${encodeURIComponent(public_id)}/received`, { method: 'POST', retry: true }),
  );
  tool('pay_transfer', 'Experimental: pay for a priced transfer addressed to you from your account balance so it can be downloaded.', { public_id: z.string() }, ({ public_id }) =>
    client.api(`inbox/${encodeURIComponent(public_id)}/pay`, { method: 'POST' }),
  );

  // Account, pricing, events
  tool('get_balance', 'Show the account balance in cents and the last 50 ledger entries.', {}, () => client.api('balance'));
  tool('get_quote', 'Price a transfer of the given size in bytes and whether uploading is allowed right now.', { bytes: z.number().int().positive() }, ({ bytes }) =>
    client.api(`quote?bytes=${bytes}`),
  );
  tool('get_config', 'Public service limits, part size, prices, and enabled capabilities. No token needed.', {}, () => client.config());
  tool(
    'list_events',
    'Signed account events (transfer.completed, transfer.downloaded, transfer.received, transfer.reply, transfer.paid, transfer.deleted, request.submitted). Page with `since` = next_since from the previous call.',
    { since: z.string().optional(), type: z.string().optional() },
    ({ since, type }) => {
      const q = new URLSearchParams();
      if (since) q.set('since', since);
      if (type) q.set('type', type);
      const s = q.toString();
      return client.api(`events${s ? `?${s}` : ''}`);
    },
  );
  tool('get_receipt', 'Fetch the signed delivery receipt for a transfer by public id. Public; no token needed. Verify offline with the Python client if proof matters.', { public_id: z.string() }, ({ public_id }) =>
    client.receipt(public_id),
  );

  // Webhook
  tool('get_webhook', 'Show the account webhook and its last ten delivery attempts.', {}, () => client.api('webhook'));
  tool('set_webhook', 'Register the single https webhook URL for this account. Public hostnames only.', { url: z.string().url() }, ({ url }) =>
    client.api('webhook', { method: 'PUT', json: { url } }),
  );
  tool('delete_webhook', 'Remove the account webhook.', {}, () => client.api('webhook', { method: 'DELETE' }));
  tool('test_webhook', 'Send a webhook.test event now and report the HTTP status the endpoint returned.', {}, () => client.api('webhook/test', { method: 'POST' }));

  // File requests
  tool(
    'create_file_request',
    'Create a link through which someone without an account can upload files to you. Returns id and upload_url; share the whole upload_url including its #key= fragment, which is shown only once.',
    {
      title: z.string(),
      description: z.string().optional(),
      reference: z.string().optional().describe('Opaque reference echoed back in status and the signed submission.'),
      max_files: z.number().int().min(1).max(100).optional(),
      max_file_bytes: z.number().int().positive().optional(),
      max_total_bytes: z.number().int().positive().optional(),
      expires_in_seconds: z.number().int().positive().max(30 * 86400).optional(),
    },
    (args) => client.api('requests', { method: 'POST', json: args }),
  );
  tool('list_file_requests', 'List your latest 50 file requests.', { before: z.string().optional() }, ({ before }) =>
    client.api(`requests${before ? `?before=${encodeURIComponent(before)}` : ''}`),
  );
  tool('get_file_request', 'Status of a file request: files uploaded so far, submitted_at, and the final manifest once the uploader clicked Done.', { id: z.string() }, ({ id }) =>
    client.api(`requests/${encodeURIComponent(id)}`),
  );
  tool('revoke_file_request', 'Revoke a file request link. Completed files keep normal retention.', { id: z.string() }, ({ id }) =>
    client.api(`requests/${encodeURIComponent(id)}`, { method: 'DELETE', retry: true }),
  );
  tool('get_file_request_receipt', 'Signed submission receipt for a file request after the uploader clicked Done.', { id: z.string() }, ({ id }) =>
    client.api(`requests/${encodeURIComponent(id)}/receipt`),
  );

  return server;
}

async function main() {
  if (process.argv[2] === 'setup') return runSetup(process.argv[3]);
  const client = new BilagaClient({
    base: process.env.BILAGA_BASE ?? 'https://bilaga.link',
    token: loadToken(),
  });
  if (!client.token) {
    console.error(`bilaga-mcp: no token. Run \`npx -y bilaga-mcp setup\` to store one (${tokenPath()}), or set BILAGA_TOKEN. Only public tools will work until then.`);
  }
  const server = createServer(client);
  await server.connect(new StdioServerTransport());
}

const invokedDirectly = (() => {
  try {
    return process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
