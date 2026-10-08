// Screen snapshots for diagnosing a missed detection. When Claude sits idle at its prompt
// for a long time with nothing detected, the monitor saves what it saw: an idle session that
// should have been retried (a banner hidden from the detectors) can then be read back after
// the fact, instead of being lost to the next redraw.
import { mkdir, writeFile, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { sanitizeKey, socketIdFromEnv } from './pane-key.js';

export const SNAPSHOT_DIR = join(homedir(), '.claude-auto-retry', 'snapshots');

// Writes one snapshot and keeps only the newest `keep` in the directory (every pane shares
// it, so the bound holds however many monitors run). Returns the file written.
export async function writeSnapshot(paneKey, content, dir = SNAPSHOT_DIR, keep = 20) {
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(dir, `${sanitizeKey(socketIdFromEnv())}_${sanitizeKey(paneKey)}-${stamp}.txt`);
  await writeFile(file, content);
  const names = (await readdir(dir)).filter((n) => n.endsWith('.txt'));
  if (names.length > keep) {
    const aged = await Promise.all(names.map(async (n) => ({ n, t: (await stat(join(dir, n))).mtimeMs })));
    aged.sort((a, b) => b.t - a.t || b.n.localeCompare(a.n));
    await Promise.all(aged.slice(keep).map(({ n }) => unlink(join(dir, n)).catch(() => {})));
  }
  return file;
}
