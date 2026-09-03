import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageVersion = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8')).version as string;

describe('anycli --version', () => {
  it('读取当前包的版本号', () => {
    const output = execFileSync(
      process.execPath,
      ['--import', 'tsx', 'src/index.ts', '--version'],
      { cwd: packageRoot, encoding: 'utf-8' },
    ).trim();

    expect(output).toBe(packageVersion);
  });
});
