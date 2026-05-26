import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMonitorState, processOneTick } from '../src/monitor.js';
import { DEFAULT_CONFIG } from '../src/config.js';

function mockTmux(paneContent = '', paneCommand = 'node', claudeForeground = true) {
  const t = {
    _sent: [],
    _enters: 0,
    _literals: [],
    capturePane: async () => paneContent,
    getPaneCommand: async () => paneCommand,
    sendKeys: async (_p, text) => { t._sent.push(text); },
    sendEnter: async (_p) => { t._enters++; },
    sendLiteral: async (_p, text) => { t._literals.push(text); },
    isClaudeForeground: async () => claudeForeground,
  };
  return t;
}

describe('processOneTick', () => {
  it('returns monitoring when no rate limit', async () => {
    const t = mockTmux('Normal output');
    const s = createMonitorState();
    assert.equal(await processOneTick(s, t, '%0', DEFAULT_CONFIG, () => true), 'monitoring');
    assert.equal(t._sent.length, 0);
  });
  it('enters waiting on rate limit', async () => {
    const t = mockTmux('Please try again in 5 hours');
    const s = createMonitorState();
    assert.equal(await processOneTick(s, t, '%0', DEFAULT_CONFIG, () => true), 'waiting');
    assert.ok(s.waitUntil > Date.now());
  });
  it('exits when PID dead', async () => {
    const t = mockTmux('5-hour limit reached - resets 3pm (UTC)');
    const s = createMonitorState();
    s.waitUntil = Date.now() - 1000; s.status = 'waiting';
    assert.equal(await processOneTick(s, t, '%0', DEFAULT_CONFIG, () => false), 'exit');
  });
  it('sends retry when wait expired and rate limit visible', async () => {
    const t = mockTmux('5-hour limit reached - resets 3pm (UTC)');
    const s = createMonitorState();
    s.waitUntil = Date.now() - 1000; s.status = 'waiting';
    assert.equal(await processOneTick(s, t, '%0', DEFAULT_CONFIG, () => true), 'retried');
    assert.equal(t._sent.length, 1);
    assert.equal(s.attempts, 1);
    // Should stay in 'waiting' with a cooldown to let Claude process
    assert.equal(s.status, 'waiting');
    assert.ok(s.waitUntil > Date.now());
  });
  it('detects multi-line TUI rate limit', async () => {
    const t = mockTmux('⚠ You\'ve hit your limit\n· try again in 2 hours');
    const s = createMonitorState();
    assert.equal(await processOneTick(s, t, '%0', DEFAULT_CONFIG, () => true), 'waiting');
    assert.ok(s.waitUntil > Date.now());
  });
  it('retries when Claude process is in foreground (fixes macOS zsh issue)', async () => {
    const t = mockTmux('5-hour limit reached - resets 3pm (UTC)', 'zsh', true);
    const s = createMonitorState();
    s.waitUntil = Date.now() - 1000; s.status = 'waiting';
    assert.equal(await processOneTick(s, t, '%0', DEFAULT_CONFIG, () => true), 'retried');
    assert.equal(t._sent.length, 1);
  });
  it('falls back to pane_current_command when process state is false', async () => {
    const t = mockTmux('5-hour limit reached - resets 3pm (UTC)', 'vim', false);
    const s = createMonitorState();
    s.waitUntil = Date.now() - 1000; s.status = 'waiting';
    assert.equal(await processOneTick(s, t, '%0', DEFAULT_CONFIG, () => true), 'skipped-not-claude');
    assert.equal(t._sent.length, 0);
    assert.equal(s._lastForeground, 'vim');
  });
  it('falls back to pane_current_command when process state is null', async () => {
    const t = mockTmux('5-hour limit reached - resets 3pm (UTC)', 'vim', null);
    const s = createMonitorState();
    s.waitUntil = Date.now() - 1000; s.status = 'waiting';
    assert.equal(await processOneTick(s, t, '%0', DEFAULT_CONFIG, () => true), 'skipped-not-claude');
    assert.equal(t._sent.length, 0);
    assert.equal(s._lastForeground, 'vim');
  });
  it('accepts custom foregroundCommands in fallback path', async () => {
    const t = mockTmux('5-hour limit reached - resets 3pm (UTC)', 'my-claude-wrapper', null);
    const s = createMonitorState();
    s.waitUntil = Date.now() - 1000; s.status = 'waiting';
    const config = { ...DEFAULT_CONFIG, foregroundCommands: ['my-claude-wrapper'] };
    assert.equal(await processOneTick(s, t, '%0', config, () => true), 'retried');
    assert.equal(t._sent.length, 1);
  });
  it('matches npx in fallback path', async () => {
    const t = mockTmux('5-hour limit reached - resets 3pm (UTC)', 'npx', null);
    const s = createMonitorState();
    s.waitUntil = Date.now() - 1000; s.status = 'waiting';
    assert.equal(await processOneTick(s, t, '%0', DEFAULT_CONFIG, () => true), 'retried');
  });
  it('resets counter when rate limit disappears', async () => {
    const t = mockTmux('Claude is working normally');
    const s = createMonitorState();
    s.waitUntil = Date.now() - 1000; s.status = 'waiting'; s.attempts = 2;
    assert.equal(await processOneTick(s, t, '%0', DEFAULT_CONFIG, () => true), 'user-continued');
    assert.equal(s.attempts, 0);
  });
  it('stops retrying after max attempts and stays in waiting', async () => {
    const t = mockTmux('5-hour limit reached - resets 3pm (UTC)');
    const s = createMonitorState();
    s.waitUntil = Date.now() - 1000; s.status = 'waiting'; s.attempts = 5;
    assert.equal(await processOneTick(s, t, '%0', DEFAULT_CONFIG, () => true), 'max-retries');
    // Should stay in 'waiting' to avoid re-detection loop
    assert.equal(s.status, 'waiting');
    assert.ok(s.waitUntil > Date.now());
  });
  it('resets from max-retries when rate limit clears', async () => {
    const t = mockTmux('Claude is working normally');
    const s = createMonitorState();
    s.waitUntil = Date.now() - 1000; s.status = 'waiting'; s.attempts = 10;
    // Rate limit cleared → should detect user-continued before max-retries check
    assert.equal(await processOneTick(s, t, '%0', DEFAULT_CONFIG, () => true), 'user-continued');
    assert.equal(s.attempts, 0);
  });

  it('sends Enter to dismiss rate-limit options menu before retrying', async () => {
    const menuText = [
      'Please try again in 5 hours',
      '',
      '  What do you want to do?',
      '',
      '  ❯ 1. Stop and wait for limit to reset',
      '    2. Upgrade your plan',
      '    3. Upgrade to Team plan',
      '',
      '  Enter to confirm · Esc to cancel',
    ].join('\n');
    const t = mockTmux(menuText);
    const s = createMonitorState();
    s.waitUntil = Date.now() - 1000; s.status = 'waiting';
    assert.equal(await processOneTick(s, t, '%0', DEFAULT_CONFIG, () => true), 'retried');
    assert.equal(t._enters, 1, 'should have sent Enter to dismiss menu');
    assert.equal(t._sent.length, 1, 'should have sent retry message');
  });

  it('does not send extra Enter when no options menu is showing', async () => {
    const t = mockTmux('Please try again in 5 hours');
    const s = createMonitorState();
    s.waitUntil = Date.now() - 1000; s.status = 'waiting';
    assert.equal(await processOneTick(s, t, '%0', DEFAULT_CONFIG, () => true), 'retried');
    assert.equal(t._enters, 0, 'should not have sent Enter');
    assert.equal(t._sent.length, 1, 'should have sent retry message');
  });

  it('auto-selects session resume option during monitoring', async () => {
    const menuText = [
      '  This session is 4h 22m old and 131.3k tokens.',
      '',
      '    1. Resume from summary (recommended)',
      '  ❯ 2. Resume full session as-is',
      '    3. Don\'t ask me again',
      '',
      '  Enter to confirm · Esc to cancel',
    ].join('\n');
    const t = mockTmux(menuText);
    const s = createMonitorState();
    assert.equal(await processOneTick(s, t, '%0', DEFAULT_CONFIG, () => true), 'session-resumed');
    assert.deepEqual(t._literals, ['2']);
    assert.equal(t._enters, 1);
  });

  it('auto-selects session resume option 1 when configured', async () => {
    const menuText = [
      '    1. Resume from summary (recommended)',
      '  ❯ 2. Resume full session as-is',
      '    3. Don\'t ask me again',
      '',
      '  Enter to confirm · Esc to cancel',
    ].join('\n');
    const t = mockTmux(menuText);
    const s = createMonitorState();
    const config = { ...DEFAULT_CONFIG, sessionResumeOption: 1 };
    assert.equal(await processOneTick(s, t, '%0', config, () => true), 'session-resumed');
    assert.deepEqual(t._literals, ['1']);
    assert.equal(t._enters, 1);
  });

  it('skips session resume when sessionResumeOption is null', async () => {
    const menuText = [
      '    1. Resume from summary (recommended)',
      '  ❯ 2. Resume full session as-is',
      '    3. Don\'t ask me again',
      '',
      '  Enter to confirm · Esc to cancel',
    ].join('\n');
    const t = mockTmux(menuText);
    const s = createMonitorState();
    const config = { ...DEFAULT_CONFIG, sessionResumeOption: null };
    assert.equal(await processOneTick(s, t, '%0', config, () => true), 'monitoring');
    assert.deepEqual(t._literals, []);
    assert.equal(t._enters, 0);
  });

  it('ignores stale rate-limit scrollback after user-continued via signature change', async () => {
    const rateLimitText = 'Please try again in 5 hours';
    const afterResumeText = rateLimitText + '\n\nClaude is responding now\nMore output here\nEven more';

    // 1. Enter waiting state from rate limit
    const t1 = mockTmux(rateLimitText);
    const s = createMonitorState();
    assert.equal(await processOneTick(s, t1, '%0', DEFAULT_CONFIG, () => true), 'waiting');

    // 2. Expire wait and send retry
    s.waitUntil = Date.now() - 1000;
    assert.equal(await processOneTick(s, t1, '%0', DEFAULT_CONFIG, () => true), 'retried');

    // 3. Pane changes (Claude responded) — triggers user-continued
    const t2 = mockTmux(afterResumeText);
    s.waitUntil = Date.now() - 1000;
    assert.equal(await processOneTick(s, t2, '%0', DEFAULT_CONFIG, () => true), 'user-continued');

    // 4. Next tick in monitoring — stale rate-limit text still visible but pane unchanged
    assert.equal(await processOneTick(s, t2, '%0', DEFAULT_CONFIG, () => true), 'monitoring');
  });

  it('handles fresh rate limit after stale one is ignored', async () => {
    const rateLimitText = 'Please try again in 5 hours';
    const afterResumeText = rateLimitText + '\n\nClaude responding\nMore output\nEven more';
    const freshRateLimitText = afterResumeText + '\n\nNew prompt\nPlease try again in 2 hours';

    // Set up stale tracking via the full cycle
    const t1 = mockTmux(rateLimitText);
    const s = createMonitorState();
    await processOneTick(s, t1, '%0', DEFAULT_CONFIG, () => true); // waiting
    s.waitUntil = Date.now() - 1000;
    await processOneTick(s, t1, '%0', DEFAULT_CONFIG, () => true); // retried
    const t2 = mockTmux(afterResumeText);
    s.waitUntil = Date.now() - 1000;
    await processOneTick(s, t2, '%0', DEFAULT_CONFIG, () => true); // user-continued

    // Stale text still there — should be skipped
    assert.equal(await processOneTick(s, t2, '%0', DEFAULT_CONFIG, () => true), 'monitoring');

    // Fresh rate limit with different message — should be detected
    const t3 = mockTmux(freshRateLimitText);
    assert.equal(await processOneTick(s, t3, '%0', DEFAULT_CONFIG, () => true), 'waiting');
  });

  it('handles same rate-limit message but changed pane signature as fresh', async () => {
    const rateLimitText = 'Please try again in 5 hours';
    const afterResumeText = rateLimitText + '\n\nClaude responding\nMore output\nEven more';
    // Same rate-limit message but pane bottom changed (user typed something new)
    const newPromptSameLimit = 'New user prompt here\nPlease try again in 5 hours\nSome other line\nAnother line\nBottom line';

    const t1 = mockTmux(rateLimitText);
    const s = createMonitorState();
    await processOneTick(s, t1, '%0', DEFAULT_CONFIG, () => true); // waiting
    s.waitUntil = Date.now() - 1000;
    await processOneTick(s, t1, '%0', DEFAULT_CONFIG, () => true); // retried
    const t2 = mockTmux(afterResumeText);
    s.waitUntil = Date.now() - 1000;
    await processOneTick(s, t2, '%0', DEFAULT_CONFIG, () => true); // user-continued

    // Same message but different pane bottom — should be treated as fresh
    const t3 = mockTmux(newPromptSameLimit);
    assert.equal(await processOneTick(s, t3, '%0', DEFAULT_CONFIG, () => true), 'waiting');
  });

  it('does not set stale tracking when user-continued via rate limit clearing', async () => {
    const rateLimitText = 'Please try again in 5 hours';

    const t1 = mockTmux(rateLimitText);
    const s = createMonitorState();
    await processOneTick(s, t1, '%0', DEFAULT_CONFIG, () => true); // waiting
    s.waitUntil = Date.now() - 1000;

    // Rate limit cleared (no rate-limit text in pane)
    const t2 = mockTmux('Claude is working normally');
    assert.equal(await processOneTick(s, t2, '%0', DEFAULT_CONFIG, () => true), 'user-continued');

    // New rate limit should be detected normally (no stale tracking active)
    const t3 = mockTmux('Please try again in 5 hours');
    assert.equal(await processOneTick(s, t3, '%0', DEFAULT_CONFIG, () => true), 'waiting');
  });

  it('auto-selects session resume during waiting state too', async () => {
    const menuText = [
      '  You\'ve hit your session limit · resets 9:20pm (UTC)',
      '  This session is 4h 22m old and 131.3k tokens.',
      '',
      '    1. Resume from summary (recommended)',
      '  ❯ 2. Resume full session as-is',
      '    3. Don\'t ask me again',
      '',
      '  Enter to confirm · Esc to cancel',
    ].join('\n');
    const t = mockTmux(menuText);
    const s = createMonitorState();
    s.status = 'waiting'; s.waitUntil = Date.now() + 60000;
    assert.equal(await processOneTick(s, t, '%0', DEFAULT_CONFIG, () => true), 'session-resumed');
    assert.deepEqual(t._literals, ['2']);
    assert.equal(t._enters, 1);
  });
});
