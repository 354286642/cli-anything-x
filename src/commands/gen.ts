import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, cpSync, rmSync, statSync } from 'fs';
import { join, dirname, resolve, relative } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { collectEndpoints, planRegistryUpdate, hashSourceFiles, planSyncDiff } from '../core/gen-pipeline.js';
import { collectReferencedEnums } from '../core/java-parser.js';
import type { ApiEndpoint, WrapperDef } from '../core/java-parser.js';
import { success, info, warn } from '../core/output.js';
import { generateSkillDocs } from '../core/skill-docs.js';
import { inferApiId } from '../core/api-infer.js';
import { buildModuleFiles, loadModuleRegistry } from '../core/skill-builder.js';
import type { ApiEntry } from '../core/skill-builder.js';

import { resolveWorkspace } from '../core/config.js';


const WORKSPACE = resolveWorkspace();

function refreshSkillDocs(): void {
  try {
    const docsPath = generateSkillDocs({ quiet: true });
    if (docsPath) {
      const rel = relative(WORKSPACE, docsPath).replace(/\\/g, '/');
      success(`已更新技能总览页面: ${rel}`);
    }
  } catch (error) {
    warn(`技能总览页面更新失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function getProjectDirs(): string[] {
  const projects = new Set<string>();

  // TS 命令模式项目：src/projects/{project}/
  const projectsDir = join(WORKSPACE, 'src', 'projects');
  if (existsSync(projectsDir)) {
    readdirSync(projectsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .forEach((d) => projects.add(d.name));
  }

  // 接口清单模式项目：skills/{project}/（根目录直接含 SKILL.md 的是独立 Skill，不算项目）
  const skillsDir = join(WORKSPACE, 'skills');
  if (existsSync(skillsDir)) {
    readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !existsSync(join(skillsDir, d.name, 'SKILL.md')))
      .forEach((d) => projects.add(d.name));
  }

  return [...projects].sort();
}

function getSubModuleDirs(projectName: string): string[] {
  const RESERVED = new Set(['flows', '_shared', 'reference']);
  const dirs = new Set<string>();
  // 扫描 src/projects/{project}/ 下的 TS 子模块
  const srcDir = join(WORKSPACE, 'src', 'projects', projectName);
  if (existsSync(srcDir)) {
    readdirSync(srcDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !RESERVED.has(d.name))
      .forEach((d) => dirs.add(d.name));
  }
  // 扫描 skills/{project}/ 下的 Skill 子模块（接口清单模式）
  const skillDir = join(WORKSPACE, 'skills', projectName);
  if (existsSync(skillDir)) {
    readdirSync(skillDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !RESERVED.has(d.name))
      .forEach((d) => dirs.add(d.name));
  }
  return [...dirs].sort();
}

function getSubModuleDescription(projectName: string, moduleName: string): string {
  // 优先从 SKILL.md frontmatter 读取
  const skillFile = join(WORKSPACE, 'skills', projectName, moduleName, 'SKILL.md');
  if (existsSync(skillFile)) {
    const raw = readFileSync(skillFile, 'utf-8');
    const m = raw.match(/description:\s*>?\s*\n?\s*(.+)/);
    if (m) return m[1].trim().replace(/\s+/g, ' ').substring(0, 60);
  }
  // 兜底从 TS index.ts 读取
  const indexFile = join(WORKSPACE, 'src', 'projects', projectName, moduleName, 'index.ts');
  if (!existsSync(indexFile)) return '';
  const content = readFileSync(indexFile, 'utf-8');
  const match = content.match(/\.description\(\s*'([^']+)'\s*\)/);
  return match ? match[1] : '';
}

function getExistingApiPaths(projectName: string, moduleName: string): string[] {
  const skillFile = join(WORKSPACE, 'skills', projectName, moduleName, 'SKILL.md');
  if (!existsSync(skillFile)) return [];
  const content = readFileSync(skillFile, 'utf-8');
  // 匹配接口清单表格中的路径列: | 名称 | 方式 | /api/xxx | 用途 |
  const paths: string[] = [];
  const pattern = /^\|[^|]+\|[^|]+\|\s*(\/[^|]+?)\s*\|/gm;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const p = match[1].trim();
    if (p && p !== '路径' && p !== '---') paths.push(p);
  }
  return paths;
}

/**
 * F-8：CRUD 模式识别 —— 检测同 Controller 的 list(Page)+getDetail+create 组合，提示可组 flow。
 */
function hintCrudFlows(projectName: string, moduleName: string, endpoints: ApiEndpoint[]): void {
  const byController = new Map<string, ApiEndpoint[]>();
  for (const ep of endpoints) {
    const list = byController.get(ep.controllerName) || [];
    list.push(ep);
    byController.set(ep.controllerName, list);
  }
  for (const [controller, eps] of byController) {
    const hasList = eps.some((ep) => /list/i.test(ep.methodName) && /page/i.test(ep.methodName));
    const hasDetail = eps.some((ep) => /get/i.test(ep.methodName) && /detail/i.test(ep.methodName));
    const hasCreate = eps.some((ep) => /^(create|add|save)/i.test(ep.methodName));
    if (hasList && hasCreate) {
      info(`F-8：检测到 ${controller} 的 CRUD 组合（list${hasDetail ? '+detail' : ''}+create），可组合流程骨架：anycli flow from-chain ${projectName} ${moduleName} <chain 序号>`);
    }
  }
}

/**
 * F-3：读取 apis/{project}/gen.json 的 wrappers 配置（包装类名 → data 字段 + 分页参数）。
 * 缺省/解析失败返回 undefined → 使用内置 PageRequest/PageInfo 固定格式。
 */
function loadProjectWrappers(projectName: string): Record<string, WrapperDef> | undefined {
  const cfgPath = join(WORKSPACE, 'apis', projectName, 'gen.json');
  if (!existsSync(cfgPath)) return undefined;
  try {
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
    return cfg.wrappers as Record<string, WrapperDef> | undefined;
  } catch (error) {
    warn(`apis/${projectName}/gen.json 解析失败，使用内置包装类配置: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

/**
 * 构建“接口是否已存在”检查器：
 * 有注册表 (apis/{project}/{module}.json) 的模块按注册表 method+path 匹配；
 * 无注册表的旧格式模块回退解析 SKILL.md 的接口清单表格。
 */
function makeExistenceChecker(projectName: string, moduleName: string): (ep: ApiEndpoint) => boolean {
  const registry = loadModuleRegistry(projectName, moduleName);
  if (registry) {
    return (ep) => registry.apis.some((a) => a.path === ep.path && a.method === ep.httpMethod);
  }
  const legacyPaths = getExistingApiPaths(projectName, moduleName);
  return (ep) => legacyPaths.includes(ep.path);
}

/**
 * 解析旧格式 SKILL.md 的接口清单表格（| 名称 | 方式 | /路径 | 用途 |），
 * 转换为注册表 ApiEntry，作为旧模块迁移建注册表时的种子。
 */
export function parseLegacyApiRows(projectName: string, moduleName: string): ApiEntry[] {
  const skillFile = join(WORKSPACE, 'skills', projectName, moduleName, 'SKILL.md');
  if (!existsSync(skillFile)) return [];
  const content = readFileSync(skillFile, 'utf-8');
  const rows: ApiEntry[] = [];
  const pattern = /^\|([^|]+)\|\s*(GET|POST|PUT|DELETE|PATCH)\s*\|\s*(\/[^|]+?)\s*\|([^|]*)\|/gmi;
  let m;
  while ((m = pattern.exec(content)) !== null) {
    const name = m[1].trim();
    const method = m[2].toUpperCase();
    const path = m[3].trim();
    const usage = m[4].trim();
    // B-1: DELETE 归 write（prod 走确认），与 api-infer.endpointToApiEntry 保持一致
    rows.push({
      id: inferApiId(path),
      summary: usage || name,
      method,
      path,
      level: method === 'GET' ? 'read' : 'write',
      deprecated: false,
      version: '1.0.0',
    });
  }
  return rows;
}

function createSubModule(projectName: string, moduleName: string, description: string): void {
  // 统一只创建 SKILL.md（接口清单格式），不生成 TS 命令文件
  const skillDir = join(WORKSPACE, 'skills', projectName, moduleName);
  mkdirSync(skillDir, { recursive: true });
  const skillFile = join(skillDir, 'SKILL.md');
  if (!existsSync(skillFile)) {
    const skillContent = `---
name: ${projectName}-${moduleName}
description: >
  ${description}
  \u672c\u6a21\u5757\u4e3a\u300c\u63a5\u53e3\u6e05\u5355 + \u901a\u7528 request \u8c03\u7528\u300d\u6a21\u5f0f\uff0c\u4e0d\u542b\u4e13\u5c5e TS \u547d\u4ee4\uff0c\u63a5\u53e3\u8def\u5f84\u4e0e\u53c2\u6570\u4ec5\u5728\u6b64\u7ef4\u62a4\u4e00\u4efd\u3002
triggers:
  - ${moduleName}
---

# ${projectName} - ${description}

> \u672c\u6a21\u5757\u6240\u6709\u63a5\u53e3\u7edf\u4e00\u901a\u8fc7\u901a\u7528\u547d\u4ee4 \`anycli request ${projectName} <METHOD> <path>\` \u8c03\u7528\u3002
> \u4e0b\u9762\u7ed9\u51fa\u6bcf\u4e2a\u63a5\u53e3\u7684\u8def\u5f84\u3001\u65b9\u5f0f\u3001\u53c2\u6570\u4e0e body/query \u6a21\u677f\uff0c\u7167\u7740\u6539\u5373\u53ef\u3002

## \u63a5\u53e3\u6e05\u5355

| \u63a5\u53e3 | \u65b9\u5f0f | \u8def\u5f84 | \u7528\u9014 |
|------|------|------|------|

`;
    writeFileSync(skillFile, skillContent, 'utf-8');
  }
}

function previewEndpoints(endpoints: ApiEndpoint[]): void {
  const table = new Table({
    head: [
      chalk.cyan('#'),
      chalk.cyan('\u65b9\u6cd5'),
      chalk.cyan('\u63a5\u53e3\u8def\u5f84'),
      chalk.cyan('\u63cf\u8ff0'),
      chalk.cyan('Controller'),
    ],
    style: { head: [], border: [] },
    colWidths: [5, 9, 42, 24, 26],
    wordWrap: true,
  });

  endpoints.forEach((ep, index) => {
    const methodColor =
      ep.httpMethod === 'GET' ? chalk.green(ep.httpMethod) :
      ep.httpMethod === 'POST' ? chalk.yellow(ep.httpMethod) :
      ep.httpMethod === 'PUT' ? chalk.blue(ep.httpMethod) :
      ep.httpMethod === 'DELETE' ? chalk.red(ep.httpMethod) :
      ep.httpMethod;
    table.push([
      String(index + 1),
      methodColor,
      ep.path,
      ep.description,
      ep.controllerName,
    ]);
  });

  console.log(table.toString());
}


function updateAnycliRouting(projectName: string, moduleName: string, description: string): void {
  const anycliSkillFile = join(WORKSPACE, 'skills', 'anycli', 'SKILL.md');
  if (!existsSync(anycliSkillFile)) return;

  let anycliContent = readFileSync(anycliSkillFile, 'utf-8');
  const skillName = `${projectName}-${moduleName}`;

  if (anycliContent.includes(skillName)) return;

  const routingPattern = /(\| \u7528\u6237\u610f\u56fe \| \u52a0\u8f7d Skill \|\n\|[-|]+\|\n(?:\|[^\n]+\|\n)*)/;
  const match = anycliContent.match(routingPattern);
  if (match) {
    const newRow = `| ${description}、${moduleName} | ${skillName} |\n`;
    anycliContent = anycliContent.replace(routingPattern, match[1] + newRow);
  }


  writeFileSync(anycliSkillFile, anycliContent, 'utf-8');
}


/**
 * F-4：非交互模式 —— gen --sync（漂移检测 + 溯源更新）/ gen --dry-run（仅预览不写文件）。
 */
function runGenSync(
  project: string | undefined,
  moduleName: string | undefined,
  controllerPath: string | undefined,
  options: { sync?: boolean; dryRun?: boolean },
): void {
  if (!project || !moduleName || !controllerPath) {
    warn('用法: anycli gen --sync|--dry-run <project> <module> <controllerPath>');
    return;
  }
  const resolvedDir = resolve(controllerPath);
  if (!existsSync(resolvedDir)) {
    warn(`路径不存在: ${resolvedDir}`);
    return;
  }

  const registry = loadModuleRegistry(project, moduleName);
  const wrappers = loadProjectWrappers(project);
  const { controllerCount, controllerFiles, endpoints } = collectEndpoints(resolvedDir, wrappers);
  if (controllerCount === 0) {
    warn('未找到任何 Controller 文件');
    return;
  }
  const baseDir = statSync(resolvedDir).isFile() ? dirname(resolvedDir) : resolvedDir;
  const sourceFiles = hashSourceFiles(controllerFiles, baseDir);
  const mode = options.dryRun ? 'dry-run' : 'sync';
  info(`[${mode}] ${controllerCount} 个 Controller，${endpoints.length} 个接口，${sourceFiles.length} 个源文件`);

  if (!registry) {
    if (options.sync) {
      warn(`注册表 apis/${project}/${moduleName}.json 不存在，请先用交互式 anycli gen 创建`);
      return;
    }
    info(`注册表不存在：将新建 apis/${project}/${moduleName}.json（${endpoints.length} 个接口）`);
    for (const ep of endpoints) info(`  + ${ep.httpMethod} ${ep.path}  ${ep.description}`);
    const enums = collectReferencedEnums(endpoints, resolvedDir);
    if (enums.length > 0) info(`将采集枚举: ${enums.map((e) => e.name).join(', ')}`);
    info('dry-run 完成，未写入任何文件');
    return;
  }

  const diff = planSyncDiff(registry, endpoints, sourceFiles);
  info(`注册表现有 ${registry.apis.filter((a) => !a.deprecated).length} 个活跃接口，diff 结果：`);
  info(`  + 新增（代码有、注册表无）：${diff.added.length}`);
  for (const ep of diff.added) info(`      ${ep.httpMethod} ${ep.path}  ${ep.description}`);
  info(`  - 疑似下线（注册表有、代码无）：${diff.missing.length}`);
  for (const api of diff.missing) info(`      ${api.id}  ${api.method} ${api.path}`);
  info(`  ~ 签名变化：${diff.signatureChanged.length}`);
  for (const item of diff.signatureChanged) {
    info(`      ${item.apiId}:`);
    for (const change of item.changes) info(`        · ${change}`);
  }
  info(`  源文件 hash：${diff.fileChanges.changed.length} 变化 / ${diff.fileChanges.added.length} 新增 / ${diff.fileChanges.removed.length} 移除`);
  for (const f of diff.fileChanges.changed) info(`      ~ ${f}`);
  for (const f of diff.fileChanges.added) info(`      + ${f}`);
  for (const f of diff.fileChanges.removed) info(`      - ${f}`);

  if (options.dryRun) {
    const enums = collectReferencedEnums(endpoints, resolvedDir);
    if (enums.length > 0) info(`将采集枚举: ${enums.map((e) => e.name).join(', ')}`);
    info('dry-run 完成，未写入任何文件');
    return;
  }

  // --sync：写回溯源信息（sourceFiles + lastSyncedAt），不改接口条目
  registry.sourceFiles = sourceFiles;
  registry.lastSyncedAt = new Date().toISOString();
  const registryPath = join(WORKSPACE, 'apis', project, `${moduleName}.json`);
  writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf-8');
  success(`已更新溯源信息: apis/${project}/${moduleName}.json（${sourceFiles.length} 个源文件，lastSyncedAt=${registry.lastSyncedAt}）`);
  if (diff.added.length > 0 || diff.missing.length > 0) {
    info('提示：新增接口入库、疑似下线接口处理，请运行交互式 anycli gen');
  }
}

export function registerGenCommands(program: Command): void {
  program
    .command('gen')
    .description('\u4ea4\u4e92\u5f0f\u521b\u5efa\u5b50\u6a21\u5757 / \u6dfb\u52a0\u63a5\u53e3\u547d\u4ee4')
    .argument('[project]', '项目名（--sync/--dry-run 模式必填）')
    .argument('[module]', '模块名（--sync/--dry-run 模式必填）')
    .argument('[controllerPath]', 'Java Controller 路径（--sync/--dry-run 模式必填）')
    .option('--sync', 'F-4 漂移检测：代码 ↔ 注册表 diff 并更新溯源信息（非交互）')
    .option('--dry-run', 'F-4 预览 gen 结果，不写入任何文件（非交互）')
    .action(async (projectArg?: string, moduleArg?: string, controllerPathArg?: string, options: { sync?: boolean; dryRun?: boolean } = {}) => {
      if (options.sync || options.dryRun) {
        runGenSync(projectArg, moduleArg, controllerPathArg, options);
        return;
      }
      const projects = getProjectDirs();
      if (projects.length === 0) {
        warn('\u672a\u627e\u5230\u4efb\u4f55\u9879\u76ee\uff0c\u8bf7\u5148\u6267\u884c: anycli config add-project');
        return;
      }

      const { project } = await inquirer.prompt([
        {
          type: 'list',
          name: 'project',
          message: '\u9009\u62e9\u9879\u76ee:',
          choices: projects,
        },
      ]);

      const subModules = getSubModuleDirs(project);
      const NEW_MODULE = '\u2795 \u65b0\u589e\u5b50\u6a21\u5757';

      const moduleChoices = [
        new inquirer.Separator('\u2500\u2500\u2500 \u5df2\u6709\u5b50\u6a21\u5757 \u2500\u2500\u2500'),
        ...subModules.map((m) => {
          const desc = getSubModuleDescription(project, m);
          return { name: `${m}${desc ? chalk.gray(`  (${desc})`) : ''}`, value: m };
        }),
        new inquirer.Separator('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'),
        { name: chalk.green(NEW_MODULE), value: '__new__' },
      ];

      const { selectedModule } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedModule',
          message: '\u9009\u62e9\u5b50\u6a21\u5757:',
          choices: moduleChoices,
        },
      ]);

      let moduleName: string;

      if (selectedModule === '__new__') {
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'name',
            message: '\u5b50\u6a21\u5757\u540d\u79f0 (\u5c0f\u5199\u82f1\u6587\uff0c\u5982 sample):',
            validate: (input: string) => {
              const RESERVED_NAMES = ['flows', '_shared', 'reference'];
              if (RESERVED_NAMES.includes(input.trim())) {
                return `"${input.trim()}" 是保留目录名，请更换模块名`;
              }
              if (!input || !/^[a-z][a-z0-9-]*$/.test(input)) {
                return '\u5fc5\u987b\u4e3a\u5c0f\u5199\u82f1\u6587\uff0c\u53ef\u542b\u6570\u5b57\u548c\u8fde\u5b57\u7b26';
              }
              if (subModules.includes(input)) {
                return `\u5b50\u6a21\u5757 "${input}" \u5df2\u5b58\u5728`;
              }
              return true;
            },
          },
          {
            type: 'input',
            name: 'description',
            message: '\u6a21\u5757\u63cf\u8ff0:',
            default: (prev: { name: string }) => `${prev.name} \u6a21\u5757`,
          },
        ]);

        moduleName = answers.name;
        createSubModule(project, moduleName, answers.description);
        success(`\u5df2\u521b\u5efa skills/${project}/${moduleName}/SKILL.md`);

        const { addApis } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'addApis',
            message: '\u662f\u5426\u7ee7\u7eed\u6dfb\u52a0\u63a5\u53e3?',
            default: true,
          },
        ]);

        if (!addApis) {
          refreshSkillDocs();
          info('\u7eaf\u6ce8\u518c\u8868\u6a21\u5f0f\uff1a\u672a\u751f\u6210 TS \u547d\u4ee4\uff0c\u5df2\u8df3\u8fc7 npm run build');
          return;
        }
      } else {
        moduleName = selectedModule;
      }

      const { controllerDir } = await inquirer.prompt([
        {
          type: 'input',
          name: 'controllerDir',
          message: 'Java Controller \u8def\u5f84 (\u76ee\u5f55\u6216\u5355\u4e2a .java \u6587\u4ef6):',
          validate: (input: string) => {
            if (!input) return '\u8bf7\u8f93\u5165\u8def\u5f84';
            const resolved = resolve(input);
            if (!existsSync(resolved)) return `\u76ee\u5f55\u4e0d\u5b58\u5728: ${resolved}`;
            return true;
          },
        },
      ]);

      const resolvedDir = resolve(controllerDir);

      const spinner = ora('\u6b63\u5728\u626b\u63cf Controller \u5e76\u89e3\u6790\u63a5\u53e3\u53c2\u6570\uff0c\u8bf7\u7a0d\u7b49...').start();

      // F-3：项目级包装类配置（apis/{project}/gen.json 的 wrappers 字段，缺省用内置 PageRequest/PageInfo）
      const wrappers = loadProjectWrappers(project);
      const { controllerCount, endpoints: allEndpoints } = collectEndpoints(resolvedDir, wrappers);

      if (controllerCount === 0) {
        spinner.fail('未找到任何 Controller 文件');
        return;
      }

      spinner.succeed(`找到 ${controllerCount} 个 Controller，共 ${allEndpoints.length} 个接口`);
      console.log('');

      previewEndpoints(allEndpoints);
      console.log('');

      // \u7edf\u4e00\u63a5\u53e3\u6e05\u5355\u6a21\u5f0f\uff0c\u4e0d\u518d\u751f\u6210 TS \u547d\u4ee4
      const isExistingApi = makeExistenceChecker(project, moduleName);
      const choices = allEndpoints.map((ep, index) => {
        const isExisting = isExistingApi(ep);
        return {
          name: `${chalk.gray(`#${index + 1}`)} ${ep.httpMethod.padEnd(6)} ${ep.path}  ${chalk.gray(ep.description)}${isExisting ? chalk.yellow(' [\u5df2\u5b58\u5728\uff0c\u52fe\u9009\u5c06\u8986\u76d6]') : ''}`,
          value: index,
        };
      });

      const { selected } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'selected',
          message: '\u52fe\u9009\u9700\u8981\u6dfb\u52a0\u7684\u63a5\u53e3 (\u7a7a\u683c\u52fe\u9009\uff0c\u56de\u8f66\u786e\u8ba4):',
          choices,
          pageSize: 20,
        },
      ]);

      if (selected.length === 0) {
        info('\u672a\u9009\u62e9\u4efb\u4f55\u63a5\u53e3');
        return;
      }

      const selectedEndpoints = selected.map((index: number) => allEndpoints[index]);

      console.log('');
      info(`\u5c06\u66f4\u65b0 ${selectedEndpoints.length} \u4e2a\u63a5\u53e3:`);
      for (const ep of selectedEndpoints) {
        const isOverwrite = isExistingApi(ep);
        const icon = isOverwrite ? chalk.yellow('\u21bb') : chalk.green('+');
        const tag = isOverwrite ? chalk.yellow(' [\u8986\u76d6]') : '';
        console.log(`  ${icon} anycli request ${project} ${ep.httpMethod} ${ep.path}  ${chalk.gray(ep.description)}${tag}`);
      }
      console.log('');

      const registry = loadModuleRegistry(project, moduleName);
      const confirmMessage = registry
        ? '\u786e\u8ba4\u66f4\u65b0\u6ce8\u518c\u8868\u5e76\u91cd\u65b0\u751f\u6210 SKILL.md?'
        : `未检测到注册表，将创建 apis/${project}/${moduleName}.json 并重建 SKILL.md（覆盖旧内容），是否继续?`;
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: confirmMessage,
          default: true,
        },
      ]);

      if (!confirm) {
        info('\u5df2\u53d6\u6d88');
        return;
      }

      // 注册表模式：merge 重建（人工字段由 buildRegistryFromEndpoints 保护）；
      // 无注册表：以旧 SKILL.md 接口清单表格（如有）为种子迁移建表
      const legacyApis = registry ? [] : parseLegacyApiRows(project, moduleName);
      const { registry: mergedRegistry, created } = planRegistryUpdate(
        project, moduleName, selectedEndpoints, registry, legacyApis,
      );

      // F-2：采集请求 DTO 引用的枚举 → apis/{project}/_shared/{enum}.json + enumRefs
      const collectedEnums = collectReferencedEnums(selectedEndpoints, resolvedDir);
      if (collectedEnums.length > 0) {
        const sharedDir = join(WORKSPACE, 'apis', project, '_shared');
        mkdirSync(sharedDir, { recursive: true });
        for (const enumDef of collectedEnums) {
          writeFileSync(join(sharedDir, `${enumDef.name}.json`), JSON.stringify(enumDef, null, 2), 'utf-8');
        }
        const enumRefSet = new Set([...(mergedRegistry.enumRefs || []), ...collectedEnums.map((e) => e.name)]);
        mergedRegistry.enumRefs = [...enumRefSet].sort();
        success(`已采集 ${collectedEnums.length} 个枚举 → apis/${project}/_shared/`);
      }

      const registryPath = join(WORKSPACE, 'apis', project, `${moduleName}.json`);
      if (created) mkdirSync(dirname(registryPath), { recursive: true });
      writeFileSync(registryPath, JSON.stringify(mergedRegistry, null, 2), 'utf-8');
      const buildResult = buildModuleFiles(project, moduleName, mergedRegistry);
      if (buildResult.success) {
        success(`${created ? '已创建' : '已更新'} apis/${project}/${moduleName}.json (${mergedRegistry.apis.length} 个接口)`);
        success(`已重新生成 skills/${project}/${moduleName}/SKILL.md`);
      } else {
        warn(`SKILL.md 生成失败: ${buildResult.error}`);
      }

      // F-8：CRUD 组合提示（chain 由 F-1 outputFields 推断支撑）
      hintCrudFlows(project, moduleName, selectedEndpoints);

      const moduleDesc = getSubModuleDescription(project, moduleName) || moduleName;
      updateAnycliRouting(project, moduleName, moduleDesc);
      success('\u5df2\u66f4\u65b0 anycli \u8def\u7531\u8868 (skills/anycli/SKILL.md)');

      const { installSkill } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'installSkill',
          message: `\u662f\u5426\u5c06 Skill \u5b89\u88c5\u5230 Agent \u76ee\u5f55 (~/.agents/skills/)? ${chalk.green('(\u63a8\u8350)')}`,
          default: true,
        },
      ]);

      if (installSkill) {
        const skillNames = [project, 'anycli'];
        for (const sn of skillNames) {
          const skillSrc = join(WORKSPACE, 'skills', sn);
          const skillDest = join(homedir(), '.agents', 'skills', sn);
          if (existsSync(skillSrc)) {
            mkdirSync(skillDest, { recursive: true });
            cpSync(skillSrc, skillDest, { recursive: true, force: true });
          }
        }
          // cleanup legacy flat skill dir after project-tree migration
          const legacyDest = join(homedir(), '.agents', 'skills', `${project}-${moduleName}`);
          if (existsSync(legacyDest)) rmSync(legacyDest, { recursive: true, force: true });
        success(`Skill \u5df2\u5b89\u88c5\u5230 ~/.agents/skills/ (${skillNames.join(', ')})`);
      }

      refreshSkillDocs();

      // F-5: 纯注册表模式不产生 TS 产物，跳过原收尾编译步骤
      info('\u7eaf\u6ce8\u518c\u8868\u6a21\u5f0f\uff1a\u672a\u751f\u6210 TS \u547d\u4ee4\uff0c\u5df2\u8df3\u8fc7 npm run build\uff08\u5982\u9700\u7f16\u8bd1 cli-anything-x \u672c\u8eab\u8bf7\u624b\u52a8\u6267\u884c\uff09');
    });
}
