import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMonitorState, processOneTick } from '../src/monitor.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { writeSnapshot } from '../src/snapshot.js';

const IDLE = '⏺ Done.\n\n' + '─'.repeat(80) + '\n❯ \n' + '─'.repeat(80) + '\n';
const WORKING = '⏺ Reading files\n\n✻ Cogitating… (esc to interrupt)\n' + '─'.repeat(80) + '\n❯ \n';

const tmux = (content) => ({
  content,
  capturePane: async function () { return this.content; },
  getPaneCommand: async () => 'node',
  sendKeys: async () => {},
  sendKey: async () => {},
  isClaudeForeground: async () => true,
});
const tick = (s, t, config = DEFAULT_CONFIG) =>
  processOneTick(s, t, '%0', config, () => true, Math.random, () => null);
// Shift the idle episode's start back by `minutes`, as if that long had passed.
const age = (s, minutes) => { s._idleSince -= minutes * 60_000; };

describe('idle snapshot', () => {
  it('saves the screen once after sitting idle for idleSnapshotMinutes', async () => {
    const s = createMonitorState();
    const t = tmux(IDLE);
    assert.equal(await tick(s, t), 'monitoring');
    age(s, DEFAULT_CONFIG.idleSnapshotMinutes);
    assert.equal(await tick(s, t), 'idle-snapshot');
    assert.equal(s._idleSnapshot, IDLE);
    assert.equal(await tick(s, t), 'monitoring', 'one snapshot per idle episode');
  });

  it('starts a new episode once Claude works again', async () => {
    const s = createMonitorState();
    const t = tmux(IDLE);
    await tick(s, t);
    age(s, DEFAULT_CONFIG.idleSnapshotMinutes);
    await tick(s, t);
    t.content = WORKING;
    await tick(s, t);
    t.content = IDLE;
    assert.equal(await tick(s, t), 'monitoring');
    age(s, DEFAULT_CONFIG.idleSnapshotMinutes);
    assert.equal(await tick(s, t), 'idle-snapshot');
  });

  it('never snapshots a working session', async () => {
    const s = createMonitorState();
    const t = tmux(WORKING);
    await tick(s, t);
    age(s, DEFAULT_CONFIG.idleSnapshotMinutes * 10);
    assert.equal(await tick(s, t), 'monitoring');
  });

  it('restarts the clock after time spent outside the monitoring path', async () => {
    const s = createMonitorState();
    const t = tmux(IDLE);
    await tick(s, t);
    age(s, DEFAULT_CONFIG.idleSnapshotMinutes);
    s._idleSeenAt -= 60_000;   // e.g. a usage wait in between
    assert.equal(await tick(s, t), 'monitoring');
  });

  it('is off at idleSnapshotMinutes 0', async () => {
    const config = { ...DEFAULT_CONFIG, idleSnapshotMinutes: 0 };
    const s = createMonitorState();
    const t = tmux(IDLE);
    await tick(s, t, config);
    assert.equal(s._idleSince, undefined);
    assert.equal(await tick(s, t, config), 'monitoring');
  });
});

describe('writeSnapshot', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'car-snap-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes the screen to a pane-keyed file', async () => {
    const file = await writeSnapshot('%120', 'screen', dir);
    assert.match(file, /_120-\d{4}-\d\d-\d\dT.*\.txt$/);
    assert.equal(readFileSync(file, 'utf8'), 'screen');
  });

  it('keeps only the newest snapshots', async () => {
    for (let i = 0; i < 5; i++) await writeSnapshot(`%${i}`, String(i), dir, 3);
    const kept = readdirSync(dir).map((n) => readFileSync(join(dir, n), 'utf8')).sort();
    assert.deepEqual(kept, ['2', '3', '4']);
  });
});
