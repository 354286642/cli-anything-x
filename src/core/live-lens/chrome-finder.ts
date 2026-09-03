/**
 * Windows 平台 Chrome 路径自动探测与沙盒启动器
 */

import { existsSync, mkdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = resolve(__dirname, '../../..');

export function findSystemChromePath(): string | null {
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
  const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';

  const candidatePaths = [
    join(localAppData, 'Google\\Chrome\\Application\\chrome.exe'),
    join(programFiles, 'Google\\Chrome\\Application\\chrome.exe'),
    join(programFilesX86, 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];

  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  for (const p of candidatePaths) {
    if (p && existsSync(p)) {
      return p;
    }
  }

  return null;
}

export function launchDevChromeSandbox(
  urlToOpen = 'https://google.com',
  pairingToken = ''
): boolean {
  const chromePath = findSystemChromePath();
  if (!chromePath) {
    return false;
  }

  // 统一转为 Chrome 熟悉的正斜杠格式 (C:/code/cli-anything-x/tools/lens-extension)
  const rawExtensionPath = join(PACKAGE_ROOT, 'tools', 'lens-extension');
  const extensionPath = rawExtensionPath.replace(/\\/g, '/');

  const rawProfileDir = join(homedir(), '.anycli', 'lens-profile');
  if (!existsSync(rawProfileDir)) {
    mkdirSync(rawProfileDir, { recursive: true });
  }
  const persistentProfileDir = rawProfileDir.replace(/\\/g, '/');

  const args = [
    `--load-extension=${extensionPath}`,
    `--user-data-dir=${persistentProfileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    urlToOpen,
  ];


  const child = spawn(chromePath, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  return true;
}

