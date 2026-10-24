import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, DEFAULT_CONFIG, pickMarginSeconds } from '../src/config.js';

describe('DEFAULT_CONFIG', () => {
  it('has expected defaults', () => {
    assert.equal(DEFAULT_CONFIG.maxRetries, 5);
    assert.equal(DEFAULT_CONFIG.pollIntervalSeconds, 5);
    assert.equal(DEFAULT_CONFIG.marginSeconds, 60);
    assert.equal(DEFAULT_CONFIG.marginMaxSeconds, 600);
    assert.equal(DEFAULT_CONFIG.fallbackWaitHours, 5);
    assert.equal(typeof DEFAULT_CONFIG.retryMessage, 'string');
    assert.deepEqual(DEFAULT_CONFIG.customPatterns, []);
  });
});

describe('loadConfig', () => {
  it('returns defaults when no config file exists', async () => {
    const config = await loadConfig('/nonexistent/path/.claude-auto-retry.json');
    assert.deepEqual(config, DEFAULT_CONFIG);
  });
  it('merges partial config with defaults', async () => {
    const { writeFile, unlink } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const f = join(tmpdir(), `car-test-${Date.now()}.json`);
    await writeFile(f, JSON.stringify({ maxRetries: 10 }));
    try {
      const config = await loadConfig(f);
      assert.equal(config.maxRetries, 10);
      assert.equal(config.pollIntervalSeconds, 5);
    } finally { await unlink(f); }
  });
  it('returns defaults for invalid JSON', async () => {
    const { writeFile, unlink } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const f = join(tmpdir(), `car-test-${Date.now()}.json`);
    await writeFile(f, 'not json{{{');
    try {
      const config = await loadConfig(f);
      assert.deepEqual(config, DEFAULT_CONFIG);
    } finally { await unlink(f); }
  });
  it('rejects string values and falls back to defaults', async () => {
    const { writeFile, unlink } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const f = join(tmpdir(), `car-test-${Date.now()}.json`);
    await writeFile(f, JSON.stringify({ maxRetries: "never", pollIntervalSeconds: "fast" }));
    try {
      const config = await loadConfig(f);
      assert.equal(config.maxRetries, 5);
      assert.equal(config.pollIntervalSeconds, 5);
    } finally { await unlink(f); }
  });
  it('filters invalid customPatterns entries', async () => {
    const { writeFile, unlink } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const f = join(tmpdir(), `car-test-${Date.now()}.json`);
    await writeFile(f, JSON.stringify({ customPatterns: ["valid", 42, null, "[invalid"] }));
    try {
      const config = await loadConfig(f);
      assert.deepEqual(config.customPatterns, ["valid"]);
    } finally { await unlink(f); }
  });
  it('rejects negative numbers and falls back to defaults', async () => {
    const { writeFile, unlink } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const f = join(tmpdir(), `car-test-${Date.now()}.json`);
    await writeFile(f, JSON.stringify({ maxRetries: -1, marginSeconds: -10 }));
    try {
      const config = await loadConfig(f);
      assert.equal(config.maxRetries, 5);
      assert.equal(config.marginSeconds, 60);
    } finally { await unlink(f); }
  });
  it('clamps marginMaxSeconds up to marginSeconds', async () => {
    const { writeFile, unlink } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const f = join(tmpdir(), `car-test-${Date.now()}.json`);
    await writeFile(f, JSON.stringify({ marginSeconds: 900, marginMaxSeconds: 120 }));
    try {
      const config = await loadConfig(f);
      assert.equal(config.marginMaxSeconds, 900);
    } finally { await unlink(f); }
  });
});

describe('pickMarginSeconds', () => {
  it('draws uniformly between marginSeconds and marginMaxSeconds', () => {
    const cfg = { marginSeconds: 60, marginMaxSeconds: 600 };
    assert.equal(pickMarginSeconds(cfg, () => 0), 60);
    assert.equal(pickMarginSeconds(cfg, () => 0.5), 330);
    assert.ok(pickMarginSeconds(cfg, () => 0.999999) < 600);
  });
  it('is the fixed margin when the max is missing or below the min', () => {
    assert.equal(pickMarginSeconds({ marginSeconds: 60 }, () => 0.7), 60);
    assert.equal(pickMarginSeconds({ marginSeconds: 60, marginMaxSeconds: 10 }, () => 0.7), 60);
  });
});
