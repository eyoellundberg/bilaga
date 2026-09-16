# bilaga-mcp

MCP server for [Bilaga](https://bilaga.link): send files up to 50 GB from any MCP-capable agent and get a share link valid for 30 days. Runs locally over stdio; the file never leaves your machine except to Bilaga.

## Setup

1. Sign in at https://bilaga.link/account and create an agent token.
2. Add the server to your MCP client with the token in the environment.

Claude Desktop / Claude Code (`claude mcp add bilaga -e BILAGA_TOKEN=... -- npx -y bilaga-mcp`) or any client that reads a JSON config:

```json
{
  "mcpServers": {
    "bilaga": {
      "command": "npx",
      "args": ["-y", "bilaga-mcp"],
      "env": { "BILAGA_TOKEN": "YOUR_AGENT_TOKEN" }
    }
  }
}
```

Requires Node 20 or newer. `BILAGA_BASE` overrides the API origin (default `https://bilaga.link`).

## Tools

| Tool | What it does |
| --- | --- |
| `send_file` | Upload a local file, return `share_url`. Supports `to`, `in_reply_to`, `sender`, `resume`. |
| `get_transfer`, `list_transfers`, `mark_sent`, `delete_transfer` | Manage your transfers. |
| `list_inbox`, `download_file`, `acknowledge_received`, `pay_transfer` | Receive transfers addressed to your email. |
| `get_account`, `get_balance`, `get_quote`, `get_config` | Account, credit, pricing, limits. |
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
