import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stripAnsi, isRateLimited, findRateLimitMessage, hasRateLimitOptionsMenu, hasSessionResumeMenu, parseSessionResumeCurrentOption } from '../src/patterns.js';

describe('stripAnsi', () => {
  it('removes bold codes', () => {
    assert.equal(stripAnsi('\x1b[1mlimit\x1b[0m'), 'limit');
  });
  it('removes color codes', () => {
    assert.equal(stripAnsi('\x1b[31mred\x1b[0m'), 'red');
  });
  it('removes cursor positioning', () => {
    assert.equal(stripAnsi('\x1b[2Jhello\x1b[H'), 'hello');
  });
  it('leaves plain text unchanged', () => {
    assert.equal(stripAnsi('plain text'), 'plain text');
  });
  it('handles mixed content', () => {
    assert.equal(
      stripAnsi('5-hour \x1b[1mlimit\x1b[0m reached - resets 3pm'),
      '5-hour limit reached - resets 3pm'
    );
  });
});

describe('isRateLimited', () => {
  it('detects "5-hour limit reached"', () => {
    assert.equal(isRateLimited('5-hour limit reached - resets 3pm'), true);
  });
  it('detects "usage limit" with reset', () => {
    assert.equal(isRateLimited('Claude usage limit reached. Resets at 2pm'), true);
  });
  it('detects "out of extra usage"', () => {
    assert.equal(isRateLimited("You're out of extra usage · resets 3pm"), true);
  });
  it('detects "try again in 5 hours"', () => {
    assert.equal(isRateLimited('Please try again in 5 hours'), true);
  });
  it('detects "rate limit resets"', () => {
    assert.equal(isRateLimited('Rate limit hit. Resets at 4pm'), true);
  });
  it('returns false for normal output', () => {
    assert.equal(isRateLimited('I can help you with that code'), false);
  });
  it('returns false for empty string', () => {
    assert.equal(isRateLimited(''), false);
  });
  it('detects rate limit with ANSI codes embedded', () => {
    assert.equal(isRateLimited('5-hour \x1b[1mlimit\x1b[0m reached - resets 3pm'), true);
  });
  it('matches custom patterns', () => {
    assert.equal(isRateLimited('custom error xyz', [/custom error/i]), true);
  });
  it('detects "You\'ve hit your limit" (real Claude Code message)', () => {
    assert.equal(isRateLimited("You've hit your limit · resets 3pm (Asia/Tbilisi)"), true);
  });
  it('detects "hit the limit resets"', () => {
    assert.equal(isRateLimited('You hit the limit. Resets at 5pm'), true);
  });
  it('detects "usage limit · resets in: 3 hours"', () => {
    assert.equal(isRateLimited('usage limit · resets in: 3 hours'), true);
  });
  it('detects "hit your session limit" (real Claude Code message)', () => {
    assert.equal(isRateLimited("You've hit your session limit · resets in: 3 hours"), true);
  });
});

describe('stripAnsi (private-mode sequences)', () => {
  it('strips cursor hide sequence', () => {
    assert.equal(stripAnsi('\x1b[?25lhello\x1b[?25h'), 'hello');
  });
  it('strips bracketed paste mode', () => {
    assert.equal(stripAnsi('\x1b[?2004htext\x1b[?2004l'), 'text');
  });
});

describe('findRateLimitMessage', () => {
  it('returns the matching line from multiline input', () => {
    const text = 'Some output\n5-hour limit reached - resets 3pm (Europe/Dublin)\nMore output';
    assert.equal(findRateLimitMessage(text), '5-hour limit reached - resets 3pm (Europe/Dublin)');
  });
  it('returns null when no match', () => {
    assert.equal(findRateLimitMessage('normal output\nmore output'), null);
  });
  it('returns the resets line from multi-line TUI render', () => {
    const text = '⚠ You\'ve hit your limit\n· resets 3pm (UTC)';
    assert.equal(findRateLimitMessage(text), '· resets 3pm (UTC)');
  });
  it('returns Resets line when limit and resets on different lines', () => {
    const text = '5-hour limit reached\nResets at 3pm (UTC)';
    assert.ok(findRateLimitMessage(text).includes('3pm'));
  });
  it('returns the LAST reset line when multiple resets exist', () => {
    // When rate limit persists across polls, each poll captures a new reset time
    // The most recent (last) reset time is most accurate for wait calculation
    const text = [
      '5-hour limit reached - Your usage will reset in 1h 25m',
      'try again in 48 minutes',
      'try again in 45 minutes',
      'try again in 39 minutes',
    ].join('\n');
    const result = findRateLimitMessage(text);
    assert.ok(result.includes('39 minutes'), `Expected last reset time, got: ${result}`);
  });
  it('prefers reset lines over limit-only lines', () => {
    const text = '5-hour limit reached - resets 3pm\ntry again in 5 minutes';
    assert.ok(findRateLimitMessage(text).includes('5 minutes'));
  });
});

describe('isRateLimited (multi-line TUI renders)', () => {
  it('detects limit + resets on separate lines', () => {
    assert.ok(isRateLimited('⚠ You\'ve hit your limit\n· resets 3pm (UTC)'));
  });
  it('detects box-drawing TUI format', () => {
    const text = '╭──────────╮\n│ ⚠ You\'ve hit your limit │\n│ · resets 3pm │\n╰──────────╯';
    assert.ok(isRateLimited(text));
  });
  it('detects 5-hour limit + Resets on separate lines', () => {
    assert.ok(isRateLimited('⚠ 5-hour limit reached\nResets at 3pm (UTC)'));
  });
  it('detects middle-dot separated multi-line', () => {
    assert.ok(isRateLimited('⚠ You\'ve hit your 5-hour limit\n· resets 3pm (Asia/Tbilisi)'));
  });
  it('rejects limit + resets too far apart (>6 lines)', () => {
    assert.equal(isRateLimited('hit your limit\n1\n2\n3\n4\n5\n6\n7\nresets 3pm'), false);
  });
  it('rejects normal output with no rate limit keywords', () => {
    assert.equal(isRateLimited('Working on your request\nHere is the code\nDone'), false);
  });
});

describe('stripAnsi (OSC sequences)', () => {
  it('strips OSC hyperlinks (\\x1b]8;;url\\x1b\\\\)', () => {
    const input = '\x1b]8;;https://example.com\x1b\\click here\x1b]8;;\x1b\\';
    assert.equal(stripAnsi(input), 'click here');
  });
  it('strips OSC window title (\\x1b]0;title\\x07)', () => {
    assert.equal(stripAnsi('\x1b]0;My Terminal\x07hello'), 'hello');
  });
  it('strips OSC + CSI mixed sequences', () => {
    const input = '\x1b]8;;url\x1b\\\x1b[33m5-hour limit reached - resets 3pm\x1b[0m\x1b]8;;\x1b\\';
    assert.equal(stripAnsi(input), '5-hour limit reached - resets 3pm');
  });
  it('rate limit detection works through OSC hyperlinks', () => {
    const input = '\x1b]8;;link\x1b\\5-hour limit reached\x1b]8;;\x1b\\ - resets 3pm';
    assert.ok(isRateLimited(input));
  });
});

describe('hasRateLimitOptionsMenu', () => {
  it('detects the rate-limit options menu', () => {
    const text = [
      '❯ /rate-limit-options',
      '',
      '──────────────────────────────────',
      '  What do you want to do?',
      '',
      '  ❯ 1. Stop and wait for limit to reset',
      '    2. Upgrade your plan',
      '    3. Upgrade to Team plan',
      '',
      '  Enter to confirm · Esc to cancel',
    ].join('\n');
    assert.ok(hasRateLimitOptionsMenu(text));
  });

  it('detects with just the key phrases', () => {
    assert.ok(hasRateLimitOptionsMenu('Stop and wait for limit to reset\nEnter to confirm'));
  });

  it('returns false for normal rate limit text without menu', () => {
    assert.equal(hasRateLimitOptionsMenu("You've hit your limit · resets 3pm (UTC)"), false);
  });

  it('returns false for normal output', () => {
    assert.equal(hasRateLimitOptionsMenu('I can help you with that code'), false);
  });

  it('returns false for empty string', () => {
    assert.equal(hasRateLimitOptionsMenu(''), false);
  });

  it('detects menu with ANSI codes', () => {
    const text = '\x1b[1mStop and wait for limit to reset\x1b[0m\nEnter to confirm · Esc to cancel';
    assert.ok(hasRateLimitOptionsMenu(text));
  });
});

describe('hasSessionResumeMenu', () => {
  const REAL_MENU = [
    '──────────────────────────────────────────────────────────────────────────',
    '  This session is 4h 22m old and 131.3k tokens.',
    '',
    '  Resuming the full session will consume a substantial portion of your usage limits. We recommend resuming from a',
    '  summary.',
    '',
    '    1. Resume from summary (recommended)',
    '  ❯ 2. Resume full session as-is',
    '    3. Don\'t ask me again',
    '',
    '  Enter to confirm · Esc to cancel',
  ].join('\n');

  it('detects the real session resume menu', () => {
    assert.ok(hasSessionResumeMenu(REAL_MENU));
  });

  it('detects with just the key phrases', () => {
    assert.ok(hasSessionResumeMenu('Resume from summary\nResume full session\nEnter to confirm'));
  });

  it('returns false for normal output', () => {
    assert.equal(hasSessionResumeMenu('I can help you with that code'), false);
  });

  it('returns false for empty string', () => {
    assert.equal(hasSessionResumeMenu(''), false);
  });

  it('returns false for rate limit text', () => {
    assert.equal(hasSessionResumeMenu("You've hit your limit · resets 3pm (UTC)"), false);
  });

  it('detects menu with ANSI codes', () => {
    const text = '\x1b[1mResume from summary\x1b[0m\nResume full session\nEnter to confirm';
    assert.ok(hasSessionResumeMenu(text));
  });
});

describe('parseSessionResumeCurrentOption', () => {
  it('parses option 2 when cursor is on it', () => {
    const text = [
      '    1. Resume from summary (recommended)',
      '  ❯ 2. Resume full session as-is',
      '    3. Don\'t ask me again',
    ].join('\n');
    assert.equal(parseSessionResumeCurrentOption(text), 2);
  });

  it('parses option 1 when cursor is on it', () => {
    const text = [
      '  ❯ 1. Resume from summary (recommended)',
      '    2. Resume full session as-is',
      '    3. Don\'t ask me again',
    ].join('\n');
    assert.equal(parseSessionResumeCurrentOption(text), 1);
  });

  it('parses option 3 when cursor is on it', () => {
    const text = [
      '    1. Resume from summary (recommended)',
      '    2. Resume full session as-is',
      '  ❯ 3. Don\'t ask me again',
    ].join('\n');
    assert.equal(parseSessionResumeCurrentOption(text), 3);
  });

  it('returns null when no cursor found', () => {
    const text = [
      '    1. Resume from summary (recommended)',
      '    2. Resume full session as-is',
      '    3. Don\'t ask me again',
    ].join('\n');
    assert.equal(parseSessionResumeCurrentOption(text), null);
  });
});
