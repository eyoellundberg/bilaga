// `bilaga-mcp setup`: prompt for the agent token once and store it in the user's config directory.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

export function configDir() {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'bilaga');
}
export function tokenPath() {
  return join(configDir(), 'token');
}

/** Token from BILAGA_TOKEN, else from the stored file, else undefined. */
export function loadToken() {
  if (process.env.BILAGA_TOKEN) return process.env.BILAGA_TOKEN;
  try {
    const t = readFileSync(tokenPath(), 'utf8').trim();
    return t || undefined;
  } catch {
    return undefined;
  }
}

export async function runSetup(argToken) {
  const out = process.stderr;
  out.write('Bilaga MCP setup\n\n');
  let token = (argToken ?? '').trim();
  if (!token) {
    out.write('1. Open https://bilaga.link/account and create an agent token.\n');
    out.write('2. Paste it below. It is stored only in ' + tokenPath() + '\n\n');
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
      token = (await rl.question('Token: ')).trim();
    } finally {
      rl.close();
    }
  }
  if (!token) {
    out.write('No token entered. Nothing saved.\n');
    process.exit(1);
  }
  const base = process.env.BILAGA_BASE ?? 'https://bilaga.link';
  const res = await fetch(`${base}/api/transfers`, {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Bilaga-MCP/0.1', Accept: 'application/json' },
  });
  if (res.status === 401) {
    out.write('\nBilaga rejected that token (401). Check it and run setup again.\n');
    process.exit(1);
  }
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  writeFileSync(tokenPath(), token + '\n', { mode: 0o600 });
  out.write(`\nSaved. Token check against ${base}: ${res.ok ? 'ok' : `HTTP ${res.status}`}.\n\n`);
  out.write('Now add the server to your client. Claude Code:\n\n');
  out.write('  claude mcp add bilaga -- npx -y bilaga-mcp\n\n');
  out.write('Claude Desktop, Cursor and other JSON configs:\n\n');
  out.write('  { "mcpServers": { "bilaga": { "command": "npx", "args": ["-y", "bilaga-mcp"] } } }\n\n');
  out.write('To change the token later, run `npx -y bilaga-mcp setup` again' + '.\n');
}
