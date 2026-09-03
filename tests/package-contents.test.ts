import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const npmCliPath = process.env.npm_execpath;

describe('npm 发布包内容', () => {
  it('包含 anycli edit 所需的编辑器和流程编辑器资源', () => {
    expect(npmCliPath).toBeTruthy();
    const result = JSON.parse(execFileSync(
      process.execPath,
      [npmCliPath!, 'pack', '--dry-run', '--json', '--ignore-scripts'],
      { cwd: packageRoot, encoding: 'utf-8' },
    )) as Array<{ files: Array<{ path: string }> }>;

    const paths = result[0].files.map((file) => file.path);
    expect(paths).toContain('tools/editor/server.mjs');
    expect(paths).toContain('tools/editor/public/index.html');
    expect(paths).toContain('tools/flow-editor/index.html');
    expect(paths).toContain('tools/flow-editor/editor.css');
    expect(paths).toContain('tools/lens-extension/manifest.json');
    expect(paths).toContain('tools/lens-extension/background.js');
  });
});
