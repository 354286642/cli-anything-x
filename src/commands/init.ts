import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { success, info, warn } from '../core/output.js';
import { getProfile } from '../core/config.js';
import { buildRegistryFromEndpoints, inferRoutingKeywords } from '../core/api-infer.js';
import { buildModuleFiles } from '../core/skill-builder.js';
import { scanControllers } from '../core/java-parser.js';
import type { ApiEndpoint } from '../core/java-parser.js';
import type { ModuleRegistry } from '../core/skill-builder.js';

import { resolveWorkspace } from '../core/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = resolve(__dirname, '../..');
const WORKSPACE = resolveWorkspace();

export function registerInitCommands(program: Command): void {
  program
    .command('init <project>')
    .description('一键接入新业务系统（配置 + 注册表 + Skill + 路由，一步到位）')
    .option('--source <path>', 'Java Controller 源码路径（可选，指定后自动解析接口）')
    .action(async (project: string, options: { source?: string }) => {
      console.log('');
      console.log(chalk.bold(`  🔧 接入新项目: ${project}`));
      console.log(chalk.gray('  ─────────────────────────────────'));
      console.log('');

      // ── Step 1: 项目配置 ──
      info('Step 1/4: 项目配置');

      const { env } = await inquirer.prompt([{
        type: 'list',
        name: 'env',
        message: '默认环境:',
        choices: [
          { name: '正式环境 (prod)', value: 'prod' },
          { name: '测试环境 (test)', value: 'test' },
        ],
        default: 'prod',
      }]);

      const defaultGateway = getProfile().gatewayUrl || '';
      const { baseUrl } = await inquirer.prompt([{
        type: 'input',
        name: 'baseUrl',
        message: '网关地址:',
        default: defaultGateway,
      }]);

      const { prefix } = await inquirer.prompt([{
        type: 'input',
        name: 'prefix',
        message: '请求前缀 (prefix，拼在 path 前):',
        default: `${project}-service`,
      }]);

      const tenantId = `${project}-service`;

      // Write config via anycli config
      try {
        execSync(
          `node dist/index.js config set projects.${project}.baseUrl "${baseUrl}" --non-interactive`,
          { cwd: PACKAGE_ROOT, stdio: 'pipe' },
        );
        execSync(`node dist/index.js config set projects.${project}.prefix "${prefix}" --non-interactive`, { cwd: PACKAGE_ROOT, stdio: 'pipe' });
        execSync(`node dist/index.js config set projects.${project}.tenantId "${tenantId}" --non-interactive`, { cwd: PACKAGE_ROOT, stdio: 'pipe' });
        execSync(`node dist/index.js config set projects.${project}.extTenantId "${tenantId}" --non-interactive`, { cwd: PACKAGE_ROOT, stdio: 'pipe' });
        success(`项目配置已写入 (env=${env}, prefix=${prefix})`);
      } catch {
        warn('自动写入配置失败，请手动执行: anycli config add-project');
      }

      // ── Step 2: 创建第一个模块 ──
      console.log('');
      info('Step 2/4: 创建第一个模块');

      const { moduleName } = await inquirer.prompt([{
        type: 'input',
        name: 'moduleName',
        message: '模块名 (英文，如 order / user / item):',
        validate: (input: string) => /^[a-z][a-z0-9-]*$/.test(input) || '小写字母开头，可含数字和连字符',
      }]);

      const { description } = await inquirer.prompt([{
        type: 'input',
        name: 'description',
        message: '模块描述 (一句话):',
        default: `${project} ${moduleName} 模块`,
      }]);

      // ── Step 3: 解析接口（可选） ──
      console.log('');
      info('Step 3/4: 接口解析');

      let endpoints: ApiEndpoint[] = [];
      let sourcePath = options.source;

      if (!sourcePath) {
        const { hasSource } = await inquirer.prompt([{
          type: 'confirm',
          name: 'hasSource',
          message: '是否有 Java Controller 源码可解析？',
          default: false,
        }]);

        if (hasSource) {
          const { srcPath } = await inquirer.prompt([{
            type: 'input',
            name: 'srcPath',
            message: 'Controller 源码路径（目录或 .java 文件）:',
          }]);
          sourcePath = srcPath;
        }
      }

      if (sourcePath) {
        const absSource = resolve(process.cwd(), sourcePath);
        if (!existsSync(absSource)) {
          warn(`路径不存在: ${sourcePath}，跳过解析`);
        } else {
          try {
            const results = scanControllers(absSource);
            for (const result of results) {
              endpoints.push(...result.endpoints);
            }
            success(`解析完成: ${results.length} 个 Controller，${endpoints.length} 个接口`);
          } catch (error) {
            warn(`解析失败: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }

      if (endpoints.length === 0) {
        info('未解析到接口，将创建空注册表骨架（后续可用 anycli gen 添加）');
      }

      // ── Step 4: 生成注册表 + SKILL.md ──
      console.log('');
      info('Step 4/4: 生成产物');

      const registry: ModuleRegistry = buildRegistryFromEndpoints(project, moduleName, endpoints);
      registry.description = description;
      registry.triggers = inferRoutingKeywords(moduleName, registry.apis);

      // Write registry
      const apisDir = join(WORKSPACE, 'apis', project);
      mkdirSync(apisDir, { recursive: true });
      const registryPath = join(apisDir, `${moduleName}.json`);
      writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf-8');
      success(`注册表: apis/${project}/${moduleName}.json (${registry.apis.length} 个接口)`);

      // Build SKILL.md + references
      const buildResult = buildModuleFiles(project, moduleName, registry);
      if (buildResult.success) {
        success(`SKILL.md: skills/${project}/${moduleName}/SKILL.md`);
        if (registry.apis.some(a => a.avoidWhen || a.tips)) {
          success(`references/: skills/${project}/${moduleName}/references/`);
        }
      }

      // ── Done ──
      console.log('');
      console.log(chalk.green('  ✅ 接入完成！'));
      console.log('');
      console.log(chalk.bold('  下一步:'));
      console.log(`    ${chalk.cyan('anycli auth login')}                          # 登录`);
      if (registry.apis.length > 0) {
        const firstApi = registry.apis[0];
        console.log(`    ${chalk.cyan(`anycli request ${project} --api ${firstApi.id}`)}   # 测试第一个接口`);
      }
      console.log(`    ${chalk.cyan(`anycli edit`)}                                # 打开编辑器完善 Skill`);
      console.log(`    ${chalk.cyan(`anycli gen`)}                                 # 继续添加更多接口`);
      console.log(`    ${chalk.cyan(`anycli skill install`)}                       # 安装到 Agent`);
      console.log('');
    });
}
