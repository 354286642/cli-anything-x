import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Command } from 'commander';
import { resolveWorkspace } from './config.js';

const WORKSPACE = resolveWorkspace();

export interface DiscoveredProject {
  name: string;
  description: string;
  modules: string[];
  hasFlows: boolean;
}

/**
 * 自动发现 skills/ 目录下的所有项目。
 * 扫描规则：skills/{project}/ 下含有 SKILL.md 的子目录即为模块。
 */
export function discoverProjects(): DiscoveredProject[] {
  const skillsDir = join(WORKSPACE, 'skills');
  if (!existsSync(skillsDir)) return [];

  const RESERVED = new Set(['_shared', 'anycli']);
  const projects: DiscoveredProject[] = [];

  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (RESERVED.has(entry.name)) continue;

    const projectDir = join(skillsDir, entry.name);
    const modules: string[] = [];
    let hasFlows = false;
    let description = '';

    for (const sub of readdirSync(projectDir, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue;
      if (sub.name === 'flows') {
        hasFlows = true;
        continue;
      }
      if (sub.name === '_shared') continue;

      const skillFile = join(projectDir, sub.name, 'SKILL.md');
      if (existsSync(skillFile)) {
        modules.push(sub.name);
        if (!description) {
          description = extractDescription(skillFile);
        }
      }
    }

    if (modules.length > 0 || hasFlows) {
      projects.push({
        name: entry.name,
        description: description || `${entry.name} 业务系统`,
        modules,
        hasFlows,
      });
    }
  }

  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

function extractDescription(skillFile: string): string {
  try {
    const raw = readFileSync(skillFile, 'utf-8');
    const match = raw.match(/description:\s*>?\s*\n?\s*(.+)/);
    if (match) return match[1].trim().replace(/\s+/g, ' ').substring(0, 80);
  } catch { /* ignore */ }
  return '';
}

/**
 * 为自动发现的项目注册 CLI 命令（仅描述性命令，实际调用走 request）。
 * 替代原来手工 import 每个项目 index.ts 的方式。
 */
export function registerDiscoveredProjects(program: Command): void {
  const projects = discoverProjects();

  for (const project of projects) {
    const existing = program.commands.find((cmd) => cmd.name() === project.name);
    if (existing) continue;

    const cmd = program
      .command(project.name)
      .description(`${project.description}（接口清单模式，统一用 anycli request ${project.name} 调用）`);

    for (const moduleName of project.modules) {
      cmd
        .command(moduleName)
        .description(`${project.name} ${moduleName} 模块`);
    }
  }
}
