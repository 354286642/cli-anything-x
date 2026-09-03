import { Command } from 'commander';
import inquirer from 'inquirer';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import {
  getConfig, setConfig, setProjectConfig, getProjectConfig,
  getAllProjects, projectExists, getGatewayUrl,
  ENV_LABELS,
  DEFAULT_PROFILE, resolveProfileName, getProfile,
  createProfile, deleteProfile, listProfiles,
  getActiveProfileName, setActiveProfile, profileExists,
  setProfileField,
  getProfileAuthConfig, setProfileAuthType, setProfileAuthField, getProfileToken,
} from '../core/index.js';
import type { ProfileData } from '../core/index.js';
import { output, success, info, warn } from '../core/output.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = resolve(__dirname, '../..');

const RESERVED_NAMES = ['auth', 'config', 'skill', 'help'];

/** 开源默认演示地址：仅作为交互提示的占位默认值，不绑定任何真实服务（RFC 2606 保留域名） */
const DEMO_GATEWAY_URL = 'https://api.example.com';
const DEMO_LOGIN_URL = 'https://login.example.com';

function toPascalCase(name: string): string {
  return name
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function getExistingProjectDirs(): string[] {
  const projectsDir = join(PACKAGE_ROOT, 'src', 'projects');
  if (!existsSync(projectsDir)) return [];
  return readdirSync(projectsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

function scaffoldProject(name: string, description: string): void {
  const pascalName = toPascalCase(name);
  const projectDir = join(PACKAGE_ROOT, 'src', 'projects', name);

  mkdirSync(projectDir, { recursive: true });

  const indexContent = `import { Command } from 'commander';

export function register${pascalName}Commands(program: Command): void {
  const ${name.replace(/-/g, '_')} = program
    .command('${name}')
    .description('${description}');

  // 在此注册子命令模块
  // 示例:
  // ${name.replace(/-/g, '_')}.command('list').description('列表').action(async () => { ... });
}
`;
  writeFileSync(join(projectDir, 'index.ts'), indexContent, 'utf-8');

  const entryFile = join(PACKAGE_ROOT, 'src', 'index.ts');
  let entryContent = readFileSync(entryFile, 'utf-8');

  const importLine = `import { register${pascalName}Commands } from './projects/${name}/index.js';`;
  const registerLine = `register${pascalName}Commands(program);`;

  if (!entryContent.includes(importLine)) {
    const lastImportIndex = entryContent.lastIndexOf("import ");
    const lineEnd = entryContent.indexOf('\n', lastImportIndex);
    entryContent =
      entryContent.slice(0, lineEnd + 1) +
      importLine + '\n' +
      entryContent.slice(lineEnd + 1);
  }

  if (!entryContent.includes(registerLine)) {
    const lastRegisterIndex = entryContent.lastIndexOf('Commands(program);');
    if (lastRegisterIndex !== -1) {
      const lineEnd = entryContent.indexOf('\n', lastRegisterIndex);
      entryContent =
        entryContent.slice(0, lineEnd + 1) +
        registerLine + '\n' +
        entryContent.slice(lineEnd + 1);
    } else {
      entryContent = entryContent.replace(
        'program.parseAsync',
        registerLine + '\n\nprogram.parseAsync'
      );
    }
  }

  writeFileSync(entryFile, entryContent, 'utf-8');
}

export function registerConfigCommands(program: Command): void {
  const config = program.command('config').description('配置管理');

  config
    .command('init')
    .description('交互式初始化当前 Profile 的基础配置（环境、输出格式）')
    .action(async () => {
      const profileName = resolveProfileName();
      const profile = getProfile();

      const answers = await inquirer.prompt([
        {
          type: 'list',
          name: 'env',
          message: `选择环境 (Profile: ${profileName}):`,
          choices: [
            { name: '正式环境 (prod)', value: 'prod' },
            { name: '测试环境 (test)', value: 'test' },
          ],
          default: profile.env || 'prod',
        },
        {
          type: 'list',
          name: 'defaultFormat',
          message: '默认输出格式:',
          choices: ['json', 'table', 'text'],
          default: getConfig().defaultFormat || 'json',
        },
      ]);

      setProfileField('env', answers.env);
      setConfig('defaultFormat', answers.defaultFormat);

      const network = await inquirer.prompt([
        {
          type: 'input',
          name: 'gatewayUrl',
          message: '网关地址（整个工程一份，可稍后 anycli config set gateway-url 修改）:',
          default: profile.gatewayUrl || DEMO_GATEWAY_URL,
          validate: (input: string) => input.trim().length > 0 || '网关地址不能为空',
        },
        {
          type: 'input',
          name: 'loginUrl',
          message: '登录页地址（session-id 授权用，可稍后 anycli config set login-url 修改）:',
          default: profile.loginUrl || DEMO_LOGIN_URL,
        },
      ]);

      setProfileField('env', answers.env);
      setProfileField('gatewayUrl', network.gatewayUrl.trim());
      setProfileField('loginUrl', network.loginUrl.trim());
      setConfig('defaultFormat', answers.defaultFormat);

      success('配置已保存！');
      info(`Profile: ${profileName}`);
      info(`环境: ${ENV_LABELS[answers.env]} (${answers.env})`);
      info(`网关: ${network.gatewayUrl.trim()}`);
      info('下一步: anycli auth login');
    });

  config
    .command('add-project')
    .description('添加业务模块配置（到当前 Profile）')
    .action(async () => {
      const existingDirs = getExistingProjectDirs();

      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'name',
          message: '业务模块名称 (如: demo, store):',
          validate: (input: string) => {
            if (!input.trim()) return '名称不能为空';
            if (RESERVED_NAMES.includes(input)) return `"${input}" 是保留名称`;
            if (projectExists(input)) return `模块 "${input}" 已存在`;
            return true;
          },
        },
        {
          type: 'input',
          name: 'description',
          message: '模块描述:',
          default: (prev: { name: string }) => `${prev.name} 业务模块`,
        },
        {
          type: 'input',
          name: 'prefix',
          message: '请求前缀 (如: demo-service):',
          default: (prev: { name: string }) => `${prev.name}-server`,
        },
        {
          type: 'input',
          name: 'tenantId',
          message: 'x-tenant-id (租户标识):',
          default: (prev: { name: string }) => prev.name,
        },
        {
          type: 'input',
          name: 'extTenantId',
          message: 'x-ext-tenant-id (扩展租户标识，通常与 tenant-id 相同):',
          default: (prev: { tenantId: string }) => prev.tenantId,
        },
      ]);

      let gatewayUrl = '';
      try {
        gatewayUrl = getGatewayUrl();
      } catch {
        // 网关未配置，稍后可通过 anycli config init 补充
      }

      setProjectConfig(answers.name, {
        ...(gatewayUrl ? { baseUrl: gatewayUrl } : {}),
        prefix: answers.prefix,
        tenantId: answers.tenantId,
        extTenantId: answers.extTenantId,
      });

      success(`业务模块 "${answers.name}" 配置已保存！(Profile: ${resolveProfileName()})`);
      info(`网关: ${gatewayUrl}`);
      info(`请求前缀: ${answers.prefix}`);
      info(`请求示例: ${gatewayUrl}/${answers.prefix}/api/...`);

      if (existingDirs.includes(answers.name)) {
        info(`源码目录 src/projects/${answers.name}/ 已存在，跳过脚手架`);
        return;
      }

      const { scaffold } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'scaffold',
          message: `是否创建项目源码目录 src/projects/${answers.name}/ 并注册到 CLI?`,
          default: true,
        },
      ]);

      if (scaffold) {
        try {
          scaffoldProject(answers.name, answers.description);
          success(`已创建 src/projects/${answers.name}/index.ts`);
          success('已注册到 src/index.ts');

          const { rebuild } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'rebuild',
              message: '是否立即编译 (npm run build)?',
              default: true,
            },
          ]);

          if (rebuild) {
            info('正在编译...');
            execSync('npm run build', { cwd: PACKAGE_ROOT, stdio: 'inherit' });
            success('编译完成！新模块已可用。');
          } else {
            info('请手动执行: cd ' + PACKAGE_ROOT + ' && npm run build');
          }
        } catch (error) {
          warn(`源码脚手架创建失败: ${error instanceof Error ? error.message : String(error)}`);
          info('配置已保存，你可以手动创建 src/projects/' + answers.name + '/index.ts');
        }
      }

      info(`下一步: 在 src/projects/${answers.name}/index.ts 中添加子命令`);
    });

  config
    .command('list')
    .description('查看当前 Profile 的所有配置')
    .action(() => {
      const profileName = resolveProfileName();
      const profile = getProfile();
      const cfg = getConfig();
      const authCfg = getProfileAuthConfig();
      const credential = authCfg.type === 'bearer-token' ? getProfileToken() : profile.sessionId;
      output({
        profile: profileName,
        isActive: profileName === getActiveProfileName(),
        env: profile.env,
        envLabel: ENV_LABELS[profile.env] || profile.env,
        gateway: profile.gatewayUrl || '',
        defaultFormat: cfg.defaultFormat,
        authType: authCfg.type,
        refreshUrl: authCfg.refreshUrl || null,
        refreshIntervalMs: authCfg.refreshIntervalMs || null,
        credential: credential ? `${credential.slice(0, 8)}...` : '(未登录)',
        projects: profile.projects,
      });
    });

  config
    .command('set <key> <value>')
    .description('设置配置项（如: anycli config set env prod；auth-type session-id|bearer-token；auth.refresh-url <url>；auth.refresh-interval <毫秒>）')
    .action((key: string, value: string) => {
      if (key === 'env') {
        setProfileField('env', value);
      } else if (key === 'gateway-url' || key === 'gatewayUrl') {
        setProfileField('gatewayUrl', value);
      } else if (key === 'login-url' || key === 'loginUrl') {
        setProfileField('loginUrl', value);
      } else if (key === 'auth-type' || key === 'authType') {
        if (value !== 'session-id' && value !== 'bearer-token') {
          warn('auth-type 仅支持: session-id, bearer-token');
          return;
        }
        setProfileAuthType(value);
      } else if (key === 'auth.refresh-url' || key === 'authRefreshUrl') {
        setProfileAuthField('refreshUrl', value);
      } else if (key === 'auth.refresh-interval' || key === 'authRefreshIntervalMs') {
        const ms = parseInt(value, 10);
        if (!Number.isFinite(ms) || ms <= 0) {
          warn('刷新间隔需为毫秒数（如 8 小时 = 28800000）');
          return;
        }
        setProfileAuthField('refreshIntervalMs', ms);
      } else if (key === 'defaultFormat') {
        setConfig('defaultFormat', value);
      } else {
        setConfig(key, value);
      }
      success(`${key} = ${value} (Profile: ${resolveProfileName()})`);
    });

  config
    .command('get <key>')
    .description('查看配置项')
    .action((key: string) => {
      if (key === 'auth-type') {
        output({ 'auth-type': getProfileAuthConfig().type });
      } else if (key === 'env' || key === 'sessionId' || key === 'projects') {
        const profile = getProfile();
        output({ [key]: (profile as unknown as Record<string, unknown>)[key] ?? null });
      } else {
        const cfg = getConfig() as unknown as Record<string, unknown>;
        output({ [key]: cfg[key] ?? null });
      }
    });

  config
    .command('project <name>')
    .description('查看指定业务模块配置')
    .action((name: string) => {
      const projectCfg = getProjectConfig(name);
      if (!projectCfg) {
        info(`模块 "${name}" 未配置，请执行: anycli config add-project`);
        return;
      }
      output(projectCfg);
    });

  config
    .command('remove-project <name>')
    .description('删除业务模块配置（不删除源码）')
    .action((name: string) => {
      const projectCfg = getProjectConfig(name);
      if (!projectCfg) {
        warn(`模块 "${name}" 不存在`);
        return;
      }
      const projects = getAllProjects();
      delete projects[name];
      setProfileField('projects', projects);
      success(`已删除模块 "${name}" 的配置 (Profile: ${resolveProfileName()})`);
      info('源码目录未删除，如需清理请手动处理 src/projects/' + name);
    });

  // ── Profile 管理 ──────────────────────────────────────────

  config
    .command('use <profile>')
    .description('切换当前活跃 Profile')
    .action((profile: string) => {
      if (!profileExists(profile)) {
        warn(`Profile "${profile}" 不存在，已自动创建`);
        createProfile(profile);
      }
      setActiveProfile(profile);
      const p = getProfile(profile);
      success(`已切换到 Profile: ${profile}`);
      info(`环境: ${ENV_LABELS[p.env] || p.env} (${p.env})`);
      info(`登录状态: ${p.sessionId ? '已登录' : '未登录'}`);
      if (!p.sessionId) {
        info('下一步: anycli auth login');
      }
    });

  const profile = config.command('profile').description('Profile 管理（多环境/多租户）');

  profile
    .command('list')
    .description('列出所有 Profile')
    .action(() => {
      const profiles = listProfiles();
      const activeName = getActiveProfileName();
      const rows = Object.entries(profiles).map(([name, p]) => ({
        name: name === activeName ? `* ${name}` : `  ${name}`,
        env: p.env,
        envLabel: ENV_LABELS[p.env] || p.env,
        session: p.sessionId ? `${p.sessionId.slice(0, 8)}...` : '(未登录)',
        projects: Object.keys(p.projects).join(', ') || '-',
      }));
      output(rows);
    });

  profile
    .command('create <name>')
    .description('创建新 Profile')
    .option('--env <env>', '环境: test | prod', 'prod')
    .option('--clone <source>', '从已有 Profile 克隆配置')
    .action((name: string, options: { env: string; clone?: string }, command: Command) => {
      const globalOpts = command.optsWithGlobals();
      const env = (globalOpts.env || options.env || 'prod') as ProfileData['env'];

      if (profileExists(name)) {
        warn(`Profile "${name}" 已存在`);
        return;
      }

      if (options.clone) {
        if (!profileExists(options.clone)) {
          warn(`源 Profile "${options.clone}" 不存在`);
          return;
        }
        const source = getProfile(options.clone);
        const cloned: ProfileData = {
          env: env || source.env,
          sessionId: '',
          projects: JSON.parse(JSON.stringify(source.projects)),
        };
        const profiles = listProfiles();
        profiles[name] = cloned;
        setConfig('profiles', profiles);
        success(`已从 "${options.clone}" 克隆创建 Profile: ${name}`);
        info(`环境: ${ENV_LABELS[cloned.env] || cloned.env} (${cloned.env})`);
        info('Session 未继承，请执行: anycli auth login --profile ' + name);
        return;
      }

      createProfile(name, env);
      success(`Profile "${name}" 已创建`);
      info(`环境: ${ENV_LABELS[env] || env} (${env})`);
      info('下一步: anycli config use ' + name + ' && anycli auth login');
    });

  profile
    .command('delete <name>')
    .description('删除 Profile')
    .action((name: string) => {
      if (name === DEFAULT_PROFILE) {
        warn(`不能删除默认 Profile "${DEFAULT_PROFILE}"`);
        return;
      }
      if (!profileExists(name)) {
        warn(`Profile "${name}" 不存在`);
        return;
      }
      deleteProfile(name);
      success(`Profile "${name}" 已删除`);
      info(`当前活跃 Profile: ${getActiveProfileName()}`);
    });

  profile
    .command('show [name]')
    .description('查看 Profile 详情（默认当前）')
    .action((name?: string) => {
      const profileName = name || resolveProfileName();
      if (!profileExists(profileName)) {
        warn(`Profile "${profileName}" 不存在`);
        return;
      }
      const p = getProfile(profileName);
      output({
        name: profileName,
        isActive: profileName === getActiveProfileName(),
        env: p.env,
        envLabel: ENV_LABELS[p.env] || p.env,
        gateway: p.gatewayUrl || '',
        sessionId: p.sessionId ? `${p.sessionId.slice(0, 8)}...` : '(未登录)',
        projects: p.projects,
      });
    });
}
