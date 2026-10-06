// The signed-in Claude account, as Claude Code records it in .claude.json (`oauthAccount`).
// Account switchers (claude-swap's `cswap auto`, a manual /login) rewrite it, and a running
// Claude Code picks the new credential up on its next request. A usage-limit wait that sees
// the account change can therefore retry at once: the limit belonged to the old account.
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function claudeConfigPath(env = process.env) {
  return join(env.CLAUDE_CONFIG_DIR || homedir(), '.claude.json');
}

// Returns a reader for "<accountUuid>/<organizationUuid>", or null when there is no
// readable signed-in account. The file holds per-project history and grows large, and the
// monitor asks every poll, so it is re-parsed only when its mtime or size changes.
export function createAccountReader(path = claudeConfigPath()) {
  let stamp = null, account = null;
  return () => {
    let st;
    try { st = statSync(path); } catch { stamp = null; return (account = null); }
    const now = `${st.mtimeMs}:${st.size}`;
    if (now === stamp) return account;
    stamp = now;
    try {
      const { accountUuid, organizationUuid } = JSON.parse(readFileSync(path, 'utf8')).oauthAccount || {};
      account = accountUuid ? `${accountUuid}/${organizationUuid || ''}` : null;
    } catch {
      account = null;
    }
    return account;
  };
}
