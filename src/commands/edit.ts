import { Command } from 'commander';
import { existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { success, info, warn } from '../core/output.js';
import { getProfileOverride } from '../core/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = resolve(__dirname, '../..');

export function registerEditCommands(program: Command): void {
  const openWorkbench = async (options: { port: string }) => {
    const port = parseInt(options.port, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      warn('端口必须是 1 到 65535 之间的整数');
      return;
    }
    const serverFile = join(PACKAGE_ROOT, 'tools', 'editor', 'server.mjs');

    if (!existsSync(serverFile)) {
      warn('编辑器文件不存在: tools/editor/server.mjs');
      return;
    }

    const profileOverride = getProfileOverride();
    const serverProcess = spawn('node', [serverFile, '--port', String(port)], {
      stdio: 'inherit',
      env: { ...process.env, ...(profileOverride ? { ANYCLI_PROFILE: profileOverride } : {}) },
    });

    serverProcess.on('error', (err) => {
      warn(`启动编辑器失败: ${err.message}`);
    });

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 800));

    const url = `http://127.0.0.1:${port}`;
    success(`本地工作台已启动: ${url}`);
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
  };

  program
    .command('workbench')
    .description('启动本地 Web 工作台（环境、项目、接口、Skill 与 Flow）')
    .option('-p, --port <port>', '服务端口', '3200')
    .action(openWorkbench);

  program
    .command('edit')
    .description('启动 Web 编辑器（workbench 的兼容命令）')
    .option('-p, --port <port>', '服务端口', '3200')
    .action(openWorkbench);
}
