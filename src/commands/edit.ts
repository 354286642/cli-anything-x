import { Command } from 'commander';
import { existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { success, info, warn } from '../core/output.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = resolve(__dirname, '../..');

export function registerEditCommands(program: Command): void {
  program
    .command('edit')
    .description('启动统一编辑器（门户 + Skill 编辑 + Flow 编辑）')
    .option('-p, --port <port>', '服务端口', '3200')
    .action(async (options: { port: string }) => {
      const port = parseInt(options.port, 10);
      const serverFile = join(PACKAGE_ROOT, 'tools', 'editor', 'server.mjs');

      if (!existsSync(serverFile)) {
        warn('编辑器文件不存在: tools/editor/server.mjs');
        return;
      }

      const serverProcess = spawn('node', [serverFile, '--port', String(port)], {
        stdio: 'inherit',
        env: { ...process.env },
      });

      serverProcess.on('error', (err) => {
        warn(`启动编辑器失败: ${err.message}`);
      });

      await new Promise((resolvePromise) => setTimeout(resolvePromise, 800));

      const url = `http://localhost:${port}`;
      success(`编辑器已启动: ${url}`);
      info('按 Ctrl+C 退出');

      try {
        const { default: open } = await import('open');
        await open(url);
      } catch {
        info('请手动在浏览器中打开上述地址');
      }

      process.on('SIGINT', () => {
        serverProcess.kill();
        process.exit(0);
      });
    });
}
