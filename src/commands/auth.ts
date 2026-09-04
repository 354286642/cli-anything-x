import { Command } from 'commander';
import open from 'open';
import inquirer from 'inquirer';
import http from 'http';
import {
  setSessionId, getSessionId, getEnv, resolveProfileName, ENV_LABELS,
  refreshCredential, getProfile, getProfileAuthConfig, setProfileAuthType,
  getProfileToken, setProfileToken, setProfileAuthField, getLoginUrl,
} from '../core/index.js';
import { success, info, output, warn } from '../core/output.js';
import { warnIfInsecureHttp } from '../core/security.js';
import { AnycliError, ErrorCode } from '../core/errors.js';
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

/** 刷新间隔（小时）：取 Profile.auth.refreshIntervalMs，未配置默认 8 小时 */
function getRefreshHours(): number {
  const interval = getProfile().auth?.refreshIntervalMs;
  if (interval && interval > 0) return Math.max(1, Math.round(interval / 3600000));
  return 8;
}

async function installScheduler(): Promise<void> {
  const exeCmd = getExecutableCommand();
  const refreshCmd = `${exeCmd} auth refresh --silent`;
  const hours = getRefreshHours();
  const platform = process.platform;

  if (platform === 'win32') {
    const taskName = 'AnycliSessionRefresh';
    const registerCmd = `schtasks /create /tn "${taskName}" /tr "${refreshCmd.replace(/"/g, '\\"')}" /sc hourly /mo ${hours} /f`;
    try {
      execSync(registerCmd, { stdio: 'ignore' });
    } catch (err) {
      throw new Error(`创建计划任务失败，请确认当前终端有足够权限。错误信息: ${err instanceof Error ? err.message : err}`);
    }
  } else {
    const cronJob = `0 */${hours} * * * ${refreshCmd} # AnycliSessionRefresh`;
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

/**
 * 启动本地授权回调服务，接收登录页跳转回带的凭证。
 * - session-id：期望 /callback?sessionId=xxx
 * - bearer-token：期望 /callback?token=xxx
 * 返回授权得到的凭证（sessionId 或 token）。失败时提供 /manual 手动粘贴页面兜底。
 */
function startCallbackServer(authType: 'session-id' | 'bearer-token'): Promise<string> {
  return new Promise((resolve, reject) => {
    const isToken = authType === 'bearer-token';
    const paramName = isToken ? 'token' : 'sessionId';
    const displayLabel = isToken ? 'Token' : 'SessionId';
    const pasteHint = isToken
      ? '请粘贴 Access Token（登录后打开 F12 → Network → 任一请求的 Authorization 请求头中复制 Bearer 后的值）：'
      : '请粘贴 sessionId（登录后 F12 → Application → Local Storage 中复制）：';

    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${CALLBACK_PORT}`);

      if (url.pathname === '/callback') {
        const value = url.searchParams.get(paramName);
        if (value) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<html><body style="font-family:system-ui;text-align:center;margin-top:80px"><h2>✓ 授权成功！</h2><p>可以关闭此页面，回到终端继续操作。</p></body></html>');
          server.close();
          resolve(value);
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<html><body><h2>✗ 缺少 ${displayLabel} 参数</h2></body></html>`);
        }
        return;
      }

      if (url.pathname === '/manual') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>CLI-Anything-X 授权</title>
<style>body{font-family:system-ui;max-width:600px;margin:80px auto;padding:0 20px}
input{width:100%;padding:12px;font-size:16px;margin:10px 0;box-sizing:border-box}
button{padding:12px 24px;font-size:16px;background:#4f46e5;color:#fff;border:none;border-radius:6px;cursor:pointer}
button:hover{background:#4338ca}.hint{color:#666;font-size:14px;margin-top:20px}</style>
</head><body>
<h2>CLI-Anything-X 授权</h2>
<p>${pasteHint}</p>
<input id="cred" placeholder="${displayLabel}" autofocus />
<button onclick="submit()">完成授权</button>
<div class="hint">
  <p>在浏览器中登录后，把 ${displayLabel} 粘贴到此处。</p>
</div>
<script>
function submit() {
  const v = document.getElementById('cred').value.trim();
  if (!v) { alert('请输入${displayLabel}'); return; }
  window.location.href = '/callback?${paramName}=' + encodeURIComponent(v);
}
document.getElementById('cred').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
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
      reject(new Error('授权超时（120s），请重试'));
    }, 120000);

    server.on('close', () => {
      clearTimeout(timer);
    });
  });
}

/** 按授权方式保存凭证 */
function saveCredential(type: 'session-id' | 'bearer-token', value: string): void {
  if (type === 'bearer-token') {
    setProfileToken(value);
  } else {
    setSessionId(value);
  }
}

/** 交互粘贴凭证（手动模式兜底） */
async function promptPasteCredential(type: 'session-id' | 'bearer-token'): Promise<string> {
  const message = type === 'bearer-token'
    ? '请粘贴 Access Token（F12 → Network → Authorization 请求头，Bearer 后的值）:'
    : '请粘贴 sessionId（F12 → Application → Local Storage → sessionId）:';
  const { credential } = await inquirer.prompt<{ credential: string }>([
    {
      type: 'input',
      name: 'credential',
      message,
      validate: (input: string) => input.trim().length > 0 || '凭证不能为空',
    },
  ]);
  return credential.trim();
}

/** 登录成功后配置凭证自动刷新（地址 + 间隔 + 调度任务） */
async function maybeConfigureRefresh(profileName: string): Promise<void> {
  const auth = getProfileAuthConfig();
  const defaultHours = auth.refreshIntervalMs ? Math.max(1, Math.round(auth.refreshIntervalMs / 3600000)) : 8;

  const { autoRefresh } = await inquirer.prompt<{ autoRefresh: boolean }>([
    {
      type: 'confirm',
      name: 'autoRefresh',
      message: '是否需要开启凭证定时自动刷新？',
      default: true,
    },
  ]);
  if (!autoRefresh) {
    info(`可稍后配置: anycli config set auth.refresh-url <url> && anycli auth scheduler install`);
    return;
  }

  let refreshUrl = auth.refreshUrl || '';
  if (!refreshUrl) {
    const { url } = await inquirer.prompt<{ url: string }>([
      {
        type: 'input',
        name: 'url',
        message: '凭证刷新接口地址（需填写完整 URL，含协议与域名，如 https://api.example.com/refresh；返回体约定 { success, data: { sessionId | token } }；可稍后 anycli config set auth.refresh-url 修改）:',
        validate: (input: string) => {
          const v = input.trim();
          if (!v) return '刷新接口地址不能为空';
          try {
            const u = new URL(v);
            if (u.protocol !== 'http:' && u.protocol !== 'https:') {
              return '需以 http:// 或 https:// 开头的完整 URL（含域名，如 https://api.example.com/refresh）';
            }
          } catch {
            return '格式不正确，需填写完整 URL（含协议与域名，如 https://api.example.com/refresh）';
          }
          return true;
        },
      },
    ]);
    refreshUrl = url.trim();
    setProfileAuthField('refreshUrl', refreshUrl);
  }

  const { intervalHours } = await inquirer.prompt<{ intervalHours: number }>([
    {
      type: 'number',
      name: 'intervalHours',
      message: '刷新间隔（小时）:',
      default: defaultHours,
      validate: (input: number) => (input && input > 0) || '请输入大于 0 的数字',
    },
  ]);
  setProfileAuthField('refreshIntervalMs', Math.round(intervalHours * 3600000));

  try {
    await installScheduler();
    success(`凭证定时自动刷新任务开启成功！（每 ${intervalHours} 小时一次，Profile: ${profileName}）`);
  } catch (err) {
    warn(`定时任务注册失败: ${err instanceof Error ? err.message : err}`);
    info('刷新配置已保存，可稍后执行: anycli auth scheduler install');
  }
}

export function registerAuthCommands(program: Command): void {
  const auth = program.command('auth').description('认证管理');

  auth
    .command('login')
    .description('登录（选择授权方式：session-id 或 bearer-token）')
    .option('--type <type>', '授权方式: session-id | bearer-token（不填则按当前配置或交互选择）')
    .option('--session-id <id>', '直接设置 sessionId（session-id 方式，跳过浏览器）')
    .option('--token <token>', '直接设置 token（bearer-token 方式，跳过浏览器）')
    .option('--manual', '手动模式（不启动本地服务器）')
    .action(async (options: { type?: string; sessionId?: string; token?: string; manual?: boolean }) => {
      const profileName = resolveProfileName();

      // 1. 确定授权方式（整套 CLI 一套，跟随 Profile/环境）
      let authType = options.type as 'session-id' | 'bearer-token' | undefined;
      if (options.sessionId) authType = 'session-id';
      if (options.token) authType = 'bearer-token';
      if (!authType) {
        const existing = getProfile().auth?.type;
        if (existing === 'session-id' || existing === 'bearer-token') {
          authType = existing;
        } else {
          const { type } = await inquirer.prompt<{ type: 'session-id' | 'bearer-token' }>([
            {
              type: 'list',
              name: 'type',
              message: '选择授权方式（整个 CLI 一套，跟随当前环境）:',
              choices: [
                { name: 'session-id（浏览器登录获取会话 ID）', value: 'session-id' },
                { name: 'bearer-token（Bearer Token 授权）', value: 'bearer-token' },
              ],
            },
          ]);
          authType = type;
        }
      }
      if (authType !== 'session-id' && authType !== 'bearer-token') {
        throw new AnycliError(ErrorCode.INVALID_PARAMS, `不支持的授权方式: ${authType}（支持: session-id, bearer-token）`);
      }
      setProfileAuthType(authType);

      const env = getEnv();
      const loginUrl = getLoginUrl();
      warnIfInsecureHttp(loginUrl, '登录页与会话凭证可能被明文传输');
      info(`Profile: ${profileName} | 环境: ${ENV_LABELS[env] || env} (${env}) | 授权方式: ${authType}`);

      // 2. 直接传入凭证（脚本/CI）
      if (authType === 'session-id' && options.sessionId) {
        setSessionId(options.sessionId);
        success(`SessionId 已设置 (Profile: ${profileName})`);
        return;
      }
      if (authType === 'bearer-token' && options.token) {
        setProfileToken(options.token.trim());
        success(`Token 已设置 (Profile: ${profileName})`);
        return;
      }

      // 3. 浏览器授权（自动回调 / 手动粘贴兜底）
      let loginSuccess = false;
      if (options.manual) {
        info(`请在浏览器中登录: ${loginUrl}`);
        await open(loginUrl);
        const credential = await promptPasteCredential(authType);
        saveCredential(authType, credential);
        success(`登录成功！(Profile: ${profileName})`);
        loginSuccess = true;
      } else {
        info('正在启动本地授权服务...');
        const credentialPromise = startCallbackServer(authType);

        const callbackUrl = `http://localhost:${CALLBACK_PORT}/callback`;
        const authUrl = `${loginUrl}/cli-auth?callback=${encodeURIComponent(callbackUrl)}`;

        info('正在打开浏览器授权...');
        await open(authUrl);

        console.log('');
        info('如果浏览器未自动完成授权，请手动打开：');
        info(`  http://localhost:${CALLBACK_PORT}/manual`);
        console.log('');

        try {
          const credential = await credentialPromise;
          saveCredential(authType, credential);
          success(`登录成功！${authType === 'bearer-token' ? 'Token' : 'SessionId'} 已保存 (Profile: ${profileName})`);
          loginSuccess = true;
        } catch (error) {
          warn(`自动授权失败: ${error instanceof Error ? error.message : '未知错误'}`);
          info('切换到手动模式...');
          const credential = await promptPasteCredential(authType);
          saveCredential(authType, credential);
          success(`登录成功！(Profile: ${profileName})`);
          loginSuccess = true;
        }
      }

      // 4. 自动刷新配置
      if (loginSuccess) {
        await maybeConfigureRefresh(profileName);
        process.exit(0);
      }
    });

  auth
    .command('status')
    .description('查看当前登录状态')
    .action(() => {
      const profileName = resolveProfileName();
      const authCfg = getProfileAuthConfig();
      const type = authCfg.type;
      const credential = type === 'bearer-token' ? getProfileToken() : getSessionId();
      const env = getEnv();
      output({
        profile: profileName,
        type,
        loggedIn: !!credential,
        credential: credential
          ? (type === 'bearer-token' ? `${credential.slice(0, 6)}...` : `${credential.slice(0, 8)}...`)
          : null,
        env,
        envLabel: ENV_LABELS[env] || env,
        refreshUrl: authCfg.refreshUrl || null,
        refreshIntervalMs: authCfg.refreshIntervalMs || null,
      });
    });

  auth
    .command('logout')
    .description('登出（清除当前 Profile 的凭证）')
    .action(() => {
      const type = getProfile().auth?.type || 'session-id';
      if (type === 'bearer-token') {
        setProfileAuthField('token', undefined);
      } else {
        setSessionId('');
      }
      success(`已登出 (Profile: ${resolveProfileName()})`);
    });

  auth
    .command('set-session <sessionId>')
    .description('直接设置 sessionId（session-id 方式，适合脚本/CI）')
    .action((sessionId: string) => {
      setProfileAuthType('session-id');
      setSessionId(sessionId);
      success(`SessionId 已设置 (Profile: ${resolveProfileName()})`);
    });

  auth
    .command('token [project]')
    .description('设置 Bearer Token（Profile 级，整个 CLI 通用；project 参数已废弃，保留兼容）')
    .option('--token <token>', '直接指定 token（适合脚本/CI，避免交互）')
    .action(async (project: string | undefined, options: { token?: string }) => {
      if (project) {
        warn('auth token 已改为 Profile 级（整个 CLI 一套授权），project 参数不再生效');
      }
      setProfileAuthType('bearer-token');
      if (options.token) {
        setProfileToken(options.token.trim());
        success(`Token 已设置 (Profile: ${resolveProfileName()})`);
        return;
      }
      const { token } = await inquirer.prompt<{ token: string }>([
        {
          type: 'password',
          name: 'token',
          message: '请输入 Bearer Token:',
          validate: (input: string) => input.trim().length > 0 || 'token 不能为空',
        },
      ]);
      setProfileToken(token.trim());
      success(`Token 已保存到配置 (Profile: ${resolveProfileName()})，也可直接编辑 ~/.anycli/config 修改`);
    });

  auth
    .command('refresh')
    .description('静默刷新当前 Profile 的凭证（session-id / bearer-token）')
    .option('--silent', '静默模式（不输出普通日志）')
    .action(async (options: { silent?: boolean }) => {
      try {
        const credential = await refreshCredential();
        if (!options.silent) {
          const label = getProfile().auth?.type === 'bearer-token' ? 'Token' : 'SessionId';
          success(`${label} 刷新成功！新${label}: ${credential.slice(0, 8)}...`);
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : '未知错误';
        if (!options.silent) {
          warn(`凭证刷新失败: ${errMsg}`);
        } else {
          console.error(`[anycli:refresh-error] ${errMsg}`);
        }
        process.exit(1);
      }
    });

  const scheduler = auth.command('scheduler').description('凭证自动刷新定时任务管理');

  scheduler
    .command('install')
    .description('安装凭证定时自动刷新任务（间隔取 Profile.auth.refreshIntervalMs，默认 8 小时）')
    .action(async () => {
      try {
        await installScheduler();
        const hours = getRefreshHours();
        success(`定时任务安装成功，将每 ${hours} 小时自动执行凭证刷新`);
      } catch (err) {
        warn(err instanceof Error ? err.message : String(err));
      }
    });

  scheduler
    .command('uninstall')
    .description('卸载凭证自动刷新定时任务')
    .action(async () => {
      try {
        await uninstallScheduler();
        success('定时任务卸载成功');
      } catch (err) {
        warn(err instanceof Error ? err.message : String(err));
      }
    });
}
