import { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve, relative } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { success, info, warn, output } from '../core/output.js';
import { buildAllSkills, buildSkillMd, buildModuleFiles, loadModuleRegistry, listRegistryProjects, listRegistryModules, mergeRegistry } from '../core/skill-builder.js';
import type { ModuleRegistry } from '../core/skill-builder.js';
import { updateAnycliRouting } from '../core/routing.js';
import { generateSkillDocs } from '../core/skill-docs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = resolve(__dirname, '../..');

export function registerSkillBuildCommands(program: Command): void {
  const skill = program.commands.find((cmd) => cmd.name() === 'skill');
  if (!skill) return;

  skill
    .command('build')
    .description('从接口注册表 (apis/) 生成 SKILL.md')
    .argument('[project]', '项目名（如 demo），不指定则构建所有')
    .argument('[module]', '模块名（如 order），不指定则构建项目下所有')
    .option('--dry-run', '只输出生成内容，不写入文件')
    .action((project: string | undefined, module: string | undefined, options: { dryRun?: boolean }) => {
      if (project && module) {
        buildSingle(project, module, options.dryRun);
      } else if (project) {
        const modules = listRegistryModules(project);
        if (modules.length === 0) {
          warn(`项目 ${project} 下无注册表文件 (apis/${project}/)`);
          return;
        }
        for (const mod of modules) {
          buildSingle(project, mod, options.dryRun);
        }
        success(`已构建 ${project} 下 ${modules.length} 个模块`);
      } else {
        const results = buildAllSkills();
        const succeeded = results.filter((r) => r.success);
        const failed = results.filter((r) => !r.success);
        if (succeeded.length > 0) {
          success(`已构建 ${succeeded.length} 个模块`);
        }
        for (const fail of failed) {
          warn(`构建失败 ${fail.module}: ${fail.error}`);
        }
      }

      if (!options.dryRun) {
        refreshRoutingAndDocs();
      }
    });

  skill
    .command('validate')
    .description('校验接口注册表 JSON 格式')
    .argument('[project]', '项目名')
    .action((project: string | undefined) => {
      const projects = project ? [project] : listRegistryProjects();
      let totalApis = 0;
      let errors = 0;

      for (const proj of projects) {
        const modules = listRegistryModules(proj);
        for (const mod of modules) {
          const registry = loadModuleRegistry(proj, mod);
          if (!registry) {
            warn(`无法加载: apis/${proj}/${mod}.json`);
            errors++;
            continue;
          }
          const issues = validateRegistry(registry);
          if (issues.length > 0) {
            for (const issue of issues) {
              warn(`apis/${proj}/${mod}.json: ${issue}`);
            }
            errors += issues.length;
          } else {
            totalApis += registry.apis.length;
          }
        }
      }

      if (errors === 0) {
        success(`校验通过：${projects.length} 个项目，${totalApis} 个接口`);
      } else {
        warn(`发现 ${errors} 个问题`);
      }
    });
}

function buildSingle(project: string, module: string, dryRun?: boolean): void {
  const registry = loadModuleRegistry(project, module);
  if (!registry) {
    warn(`注册表不存在: apis/${project}/${module}.json`);
    return;
  }

  if (dryRun) {
    const skillMd = buildSkillMd(registry, project);
    info(`--- apis/${project}/${module}.json → skills/${project}/${module}/SKILL.md ---`);
    console.log(skillMd);
    return;
  }

  const result = buildModuleFiles(project, module, registry);
  if (result.success) {
    success(`已生成: skills/${project}/${module}/SKILL.md (v${registry.version})`);
  } else {
    warn(`生成失败: ${result.error}`);
  }
}

function validateRegistry(registry: ModuleRegistry): string[] {
  const issues: string[] = [];

  if (!registry.module) issues.push('缺少 module 字段');
  if (!registry.version) issues.push('缺少 version 字段');
  if (!/^\d+\.\d+\.\d+$/.test(registry.version || '')) issues.push(`version 格式不正确: ${registry.version}`);
  if (!registry.apis || registry.apis.length === 0) issues.push('apis 数组为空');

  const seenIds = new Set<string>();
  for (const api of registry.apis || []) {
    if (!api.id) { issues.push('存在缺少 id 的接口'); continue; }
    if (seenIds.has(api.id)) issues.push(`重复的接口 id: ${api.id}`);
    seenIds.add(api.id);
    if (!api.method) issues.push(`${api.id}: 缺少 method`);
    if (!api.path) issues.push(`${api.id}: 缺少 path`);
    if (!api.level) issues.push(`${api.id}: 缺少 level`);
    if (!['read', 'write', 'dangerous'].includes(api.level)) issues.push(`${api.id}: level 值无效: ${api.level}`);
  }

  return issues;
}

function refreshRoutingAndDocs(): void {
  try {
    const projects = listRegistryProjects();
    for (const project of projects) {
      for (const mod of listRegistryModules(project)) {
        const registry = loadModuleRegistry(project, mod);
        if (!registry) continue;
        const desc = registry.description || registry.module;
        updateAnycliRouting(desc, registry.module);
      }
    }
  } catch { /* routing update is best-effort */ }

  try {
    generateSkillDocs({ quiet: true });
  } catch { /* docs update is best-effort */ }
}
