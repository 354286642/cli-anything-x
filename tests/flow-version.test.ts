import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadFlowVersion, bumpFlowVersion, getFlowHistory, getFlowVersion } from '../src/core/flow-version.js';

describe('flow-version', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'anycli-test-'));
    writeFileSync(join(tempDir, 'flow.json'), '{}');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns default version 1 for new flow', () => {
    const meta = loadFlowVersion(tempDir);
    expect(meta.currentVersion).toBe(1);
    expect(meta.revisions).toHaveLength(0);
  });

  it('bumps version and records revision', () => {
    const meta = bumpFlowVersion(tempDir, 'initial build', 'tester');
    expect(meta.currentVersion).toBe(2);
    expect(meta.revisions).toHaveLength(1);
    expect(meta.revisions[0].message).toBe('initial build');
    expect(meta.revisions[0].author).toBe('tester');
    expect(meta.revisions[0].version).toBe(2);
  });

  it('accumulates revisions', () => {
    bumpFlowVersion(tempDir, 'first');
    bumpFlowVersion(tempDir, 'second');
    const meta = loadFlowVersion(tempDir);
    expect(meta.currentVersion).toBe(3);
    expect(meta.revisions).toHaveLength(2);
  });

  it('getFlowVersion returns current version', () => {
    bumpFlowVersion(tempDir, 'build');
    expect(getFlowVersion(tempDir)).toBe(2);
  });

  it('getFlowHistory returns reversed revisions', () => {
    bumpFlowVersion(tempDir, 'first');
    bumpFlowVersion(tempDir, 'second');
    const history = getFlowHistory(tempDir);
    expect(history[0].message).toBe('second');
    expect(history[1].message).toBe('first');
  });

  it('limits history to 50 entries', () => {
    for (let i = 0; i < 55; i++) {
      bumpFlowVersion(tempDir, `rev-${i}`);
    }
    const meta = loadFlowVersion(tempDir);
    expect(meta.revisions.length).toBeLessThanOrEqual(50);
  });
});
