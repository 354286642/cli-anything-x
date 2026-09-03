import { Command } from 'commander';
import open from 'open';
import inquirer from 'inquirer';
import http from 'http';
import { setSessionId, getSessionId, getEnv, resolveProfileName, ENV_LABELS, refreshSessionId, getProfile, getProjectConfig, setProjectConfig, getProjectAuthConfig, getStrategy, requireProject, getLoginUrl } from '../core/index.js';
import { success, info, output, warn } from '../core/output.js';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

function getExecutableCommand(): string {
  const entryPath = process.argv[1];
  if (!entryPath) {
    return 'anycli';
  }

  const isTs = entryPath.endsWith('.ts');
  const isTsx = entryPath.includes('tsx') || process.execArgv.includes('tsx') || process.execArgv.includes('--import');

  const normalizedPath = path.resolve(entryPath);
  if (isTs || isTsx) {
    return `npx tsx "${normalizedPath}"`;
  }

  return `node "${normalizedPath}"`;
}

async function installScheduler(): Promise<void> {
  const exeCmd = getExecutableCommand();
  const refreshCmd = `${exeCmd} auth refresh --silent`;
  const platform = process.platform;

  if (platform === 'win32') {
    const taskName = 'AnycliSessionRefresh';
    const registerCmd = `schtasks /create /tn "${taskName}" /tr "${refreshCmd.replace(/"/g, '\\"')}" /sc hourly /mo 8 /f`;
    try {
      execSync(registerCmd, { stdio: 'ignore' });
    } catch (err) {
      throw new Error(`创建计划任务失败，请确认当前终端有足够权限。错误信息: ${err instanceof Error ? err.message : err}`);
    }
  } else {
    const cronJob = `0 */8 * * * ${refreshCmd} # AnycliSessionRefresh`;
    let currentCron = '';
    try {
      currentCron = execSync('crontab -l', { encoding: 'utf8' });
    } catch (e) {
      // 忽略没有 crontab 时的错误
    }

    const lines = currentCron.split('\n').filter(line => !line.includes('AnycliSessionRefresh'));
    lines.push(cronJob);
    const newCron = lines.join('\n').trim() + '\n';

    const tmpFile = path.join(process.cwd(), '.cron_tmp');
    fs.writeFileSync(tmpFile, newCron);
    try {
      execSync(`crontab "${tmpFile}"`);
    } catch (err) {
      throw new Error(`写入 crontab 失败: ${err instanceof Error ? err.message : err}`);
    } finally {
      try {
        fs.unlinkSync(tmpFile);
      } catch {}
    }
  }
}

async function uninstallScheduler(): Promise<void> {
  const platform = process.platform;
  const taskName = 'AnycliSessionRefresh';

  if (platform === 'win32') {
    const unregisterCmd = `schtasks /delete /tn "${taskName}" /f`;
    try {
      execSync(unregisterCmd, { stdio: 'ignore' });
    } catch (err) {
      // 忽略任务不存在的错误
    }
  } else {
    let currentCron = '';
    try {
      currentCron = execSync('crontab -l', { encoding: 'utf8' });
    } catch (e) {
      return;
    }

    const lines = currentCron.split('\n').filter(line => !line.includes('AnycliSessionRefresh'));
    if (lines.length === 0 || (lines.length === 1 && lines[0].trim() === '')) {
      try {
        execSync('crontab -r');
      } catch {}
      return;
    }

    const newCron = lines.join('\n').trim() + '\n';
    const tmpFile = path.join(process.cwd(), '.cron_tmp');
    fs.writeFileSync(tmpFile, newCron);
    try {
      execSync(`crontab "${tmpFile}"`);
    } catch (err) {
      throw new Error(`更新 crontab 失败: ${err instanceof Error ? err.message : err}`);
    } finally {
      try {
        fs.unlinkSync(tmpFile);
      } catch {}
    }
  }
}


const CALLBACK_PORT = 19876;

function startCallbackServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${CALLBACK_PORT}`);

      if (url.pathname === '/callback') {
        const sessionId = url.searchParams.get('sessionId');
        if (sessionId) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<html><body style="font-family:system-ui;text-align:center;margin-top:80px"><h2>✓ 登录成功！</h2><p>可以关闭此页面，回到终端继续操作。</p></body></html>');
          server.close();
          resolve(sessionId);
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<html><body><h2>✗ 缺少 sessionId 参数</h2></body></html>');
        }
        return;
      }

      if (url.pathname === '/manual') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>CLI-Anything-X 登录</title>
<style>body{font-family:system-ui;max-width:600px;margin:80px auto;padding:0 20px}
input{width:100%;padding:12px;font-size:16px;margin:10px 0;box-sizing:border-box}
button{padding:12px 24px;font-size:16px;background:#4f46e5;color:#fff;border:none;border-radius:6px;cursor:pointer}
button:hover{background:#4338ca}.hint{color:#666;font-size:14px;margin-top:20px}</style>
</head><body>
<h2>CLI-Anything-X 登录</h2>
<p>请粘贴 sessionId（从浏览器 F12 → Application → Local Storage 中复制）：</p>
<input id="sid" placeholder="粘贴 sessionId..." autofocus />
<button onclick="submit()">完成登录</button>
<div class="hint">
  <p>获取方式：登录 Anycli 后，按 F12 → Application → Local Storage → 找到 sessionId 字段 → 复制值</p>
</div>
<script>
function submit() {
  const sid = document.getElementById('sid').value.trim();
  if (!sid) { alert('请输入 sessionId'); return; }
  window.location.href = '/callback?sessionId=' + encodeURIComponent(sid);
}
document.getElementById('sid').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
</script>
</body></html>`);
        return;
      }

      res.writeHead(404);
      res.end('Not Found');
    });

    server.listen(CALLBACK_PORT, () => {
      // ready
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`端口 ${CALLBACK_PORT} 被占用，请关闭占用程序后重试`));
      } else {
        reject(err);
      }
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error('登录超时（120s），请重试'));
    }, 120000);

    server.on('close', () => {
      clearTimeout(timer);
    });
  });
}

export function registerAuthCommands(program: Command): void {
  const auth = program.command('auth').description('认证管理');

  auth
    .command('login')
    .description('登录（打开浏览器，自动获取 sessionId）')
    .option('--session-id <id>', '直接设置 sessionId（跳过浏览器）')
    .option('--manual', '手动模式（不启动本地服务器）')
    .action(async (options: { sessionId?: string; manual?: boolean }) => {
      const profileName = resolveProfileName();

      if (options.sessionId) {
        setSessionId(options.sessionId);
        success(`SessionId 已设置 (Profile: ${profileName})`);
        return;
      }

      const env = getEnv();
      const loginUrl = getLoginUrl();
      info(`Profile: ${profileName} | 环境: ${ENV_LABELS[env] || env} (${env})`);

      if (options.manual) {
        info(`请在浏览器中登录: ${loginUrl}`);
        await open(loginUrl);
        const { sessionId } = await inquirer.prompt([
          {
            type: 'input',
            name: 'sessionId',
            message: '请粘贴 sessionId（F12 → Application → Local Storage → sessionId）:',
            validate: (input: string) => input.trim().length > 0 || 'sessionId 不能为空',
          },
        ]);
        setSessionId(sessionId.trim());
        success(`登录成功！(Profile: ${profileName})`);
        return;
      }

      info('正在启动本地登录服务...');
      const sessionPromise = startCallbackServer();

      const callbackUrl = `http://localhost:${CALLBACK_PORT}/callback`;
      const authUrl = `${loginUrl}/cli-auth?callback=${encodeURIComponent(callbackUrl)}`;

      info('正在打开浏览器登录...');
      await open(authUrl);

      console.log('');
      info('如果浏览器未自动完成授权，请手动打开：');
      info(`  http://localhost:${CALLBACK_PORT}/manual`);
      console.log('');

      let loginSuccess = false;
      try {
        const sessionId = await sessionPromise;
        setSessionId(sessionId);
        success(`登录成功！SessionId 已保存 (Profile: ${profileName})`);
        loginSuccess = true;
      } catch (error) {
        warn(`自动获取失败: ${error instanceof Error ? error.message : '未知错误'}`);
        info('切换到手动模式...');
        const { sessionId } = await inquirer.prompt([
          {
            type: 'input',
            name: 'sessionId',
            message: '请粘贴 sessionId:',
            validate: (input: string) => input.trim().length > 0 || 'sessionId 不能为空',
          },
        ]);
        setSessionId(sessionId.trim());
        success(`登录成功！(Profile: ${profileName})`);
        loginSuccess = true;
      }

      if (loginSuccess) {
        const { autoRefresh } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'autoRefresh',
            message: '是否需要开启 SessionId 定时自动刷新（每8小时一次）？',
            default: true,
          }
        ]);
        if (autoRefresh) {
          try {
            await installScheduler();
            success('SessionId 定时自动刷新任务开启成功！');
          } catch (err) {
            warn(`定时任务注册失败: ${err instanceof Error ? err.message : err}`);
          }
        }
        process.exit(0);
      }
    });

  auth
    .command('status')
    .description('查看当前登录状态')
    .action(() => {
      const profileName = resolveProfileName();
      const sessionId = getSessionId();
      const env = getEnv();
      output({
        profile: profileName,
        loggedIn: !!sessionId,
        sessionId: sessionId ? `${sessionId.slice(0, 8)}...` : null,
        env,
        envLabel: ENV_LABELS[env] || env,
      });
    });

  auth
    .command('logout')
    .description('登出（清除当前 Profile 的 sessionId）')
    .action(() => {
      setSessionId('');
      success(`已登出 (Profile: ${resolveProfileName()})`);
    });

  auth
    .command('set-session <sessionId>')
    .description('直接设置 sessionId（适合脚本/CI）')
    .action((sessionId: string) => {
      setSessionId(sessionId);
      success(`SessionId 已设置 (Profile: ${resolveProfileName()})`);
    });
  auth
    .command('token <project>')
    .description('设置项目的 Bearer Token（默认交互输入；可用 --token 直接传入，或直接编辑 ~/.anycli/config）')
    .option('--token <token>', '直接指定 token（适合脚本/CI，避免交互）')
    .action(async (project: string, options: { token?: string }) => {
      requireProject(project);
      const auth = { ...getProjectAuthConfig(project), type: 'bearer-token' as const };
      if (options.token) {
        const config = getProjectConfig(project)!;
        setProjectConfig(project, { ...config, auth: { ...auth, token: options.token.trim() } });
        success(`Token 已设置 (project: ${project})`);
        return;
      }
      const strategy = getStrategy('bearer-token');
      await strategy.ensureAuth?.({ project, auth, profile: getProfile() });
      success(`Token 已保存到配置 (project: ${project})，也可直接编辑 ~/.anycli/config 修改`);
    });

  auth
    .command('refresh')
    .description('静默刷新本地的 sessionId')
    .option('--silent', '静默模式（不输出普通日志）')
    .action(async (options: { silent?: boolean }) => {
      try {
        const newSessionId = await refreshSessionId();
        if (!options.silent) {
          success(`SessionId 刷新成功！新 SessionId: ${newSessionId.slice(0, 8)}...`);
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : '未知错误';
        if (!options.silent) {
          warn(`SessionId 刷新失败: ${errMsg}`);
        } else {
          console.error(`[anycli:refresh-error] ${errMsg}`);
        }
        process.exit(1);
      }
    });

  const scheduler = auth.command('scheduler').description('自动刷新定时任务管理');

  scheduler
    .command('install')
    .description('安装每 8 小时自动刷新 SessionId 的定时任务')
    .action(async () => {
      try {
        await installScheduler();
        success('定时任务安装成功，将每 8 小时自动执行刷新');
      } catch (err) {
        warn(err instanceof Error ? err.message : String(err));
      }
    });

  scheduler
    .command('uninstall')
    .description('卸载自动刷新 SessionId 的定时任务')
    .action(async () => {
      try {
        await uninstallScheduler();
        success('定时任务卸载成功');
      } catch (err) {
        warn(err instanceof Error ? err.message : String(err));
      }
    });
}

