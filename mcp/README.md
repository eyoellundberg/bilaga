# bilaga-mcp

MCP server for [Bilaga](https://bilaga.link): send files up to 50 GB from any MCP-capable agent and get a share link valid for 30 days. Runs locally over stdio; the file never leaves your machine except to Bilaga.

## Setup

Create an agent token at https://bilaga.link/account. The page shows this one-liner with the token filled in; for Claude Code:

```bash
npx -y bilaga-mcp setup YOUR_TOKEN && claude mcp add -s user bilaga -- npx -y bilaga-mcp
```

`setup` checks the token against Bilaga and stores it in `~/.config/bilaga/token` with owner-only permissions. Run it without an argument to be prompted instead.

Claude Desktop, Cursor, and other clients that read a JSON config, after running setup:

```json
{
  "mcpServers": {
    "bilaga": { "command": "npx", "args": ["-y", "bilaga-mcp"] }
  }
}
```

Requires Node 20 or newer. `BILAGA_TOKEN` in the environment overrides the stored token; `BILAGA_BASE` overrides the API origin (default `https://bilaga.link`).

## Tools

| Tool | What it does |
| --- | --- |
| `send_file` | Upload a local file, return `share_url`. Supports `to`, `in_reply_to`, `sender`, `resume`. |
| `get_transfer`, `list_transfers`, `mark_sent`, `delete_transfer` | Manage your transfers. |
| `list_inbox`, `download_file`, `acknowledge_received`, `pay_transfer` | Receive transfers addressed to your email. |
| `get_balance`, `get_quote`, `get_config` | Credit, pricing, limits. |
| `list_events`, `get_receipt` | Signed event log and delivery receipts. |
| `get_webhook`, `set_webhook`, `delete_webhook`, `test_webhook` | One https webhook per account. |
| `create_file_request`, `list_file_requests`, `get_file_request`, `revoke_file_request`, `get_file_request_receipt` | Collect files from people without an account. |

Errors from the API come back as tool errors with the Bilaga error code, so the agent can act on `402 insufficient_balance` or `429 account_limit` without guessing.

## Development

```bash
npm install
npm test
```

Tests run the server against a fake Bilaga over the real MCP protocol, including part retries and resume.
