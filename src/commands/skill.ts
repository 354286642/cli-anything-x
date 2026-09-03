import { Command } from 'commander';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { success, info, output, warn } from '../core/output.js';

const AGENTS_SKILLS_DIR = join(homedir(), '.agents', 'skills');

// 方案 B 之前的旧版扁平目录（{project}-{module}），安装/卸载时一并清理
const LEGACY_FLAT_DIRS: string[] = [];

function getProjectSkillsDir(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return join(currentDir, '..', '..', 'skills');
}

interface SkillEntry {
  rel: string;
  abs: string;
  project: string;
  module: string;
  name: string;
}

function readSkillName(absSkillMd: string, fallback: string): string {
  try {
    const raw = readFileSync(absSkillMd, 'utf-8');
    const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (fm) {
      const m = fm[1].match(/^name:\s*(.+)\s*$/m);
      if (m) return m[1].replace(/^['"]|['"]$/g, '').trim();
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

function collectSkillEntries(skillsDir: string): SkillEntry[] {
  const entries: SkillEntry[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name === 'SKILL.md') {
        const rel = relative(skillsDir, dir).replace(/\\/g, '/');
        const parts = rel.split('/').filter(Boolean);
        const project = parts[0] ?? 'global';
        const module = parts.length > 1 ? parts.slice(1).join('/') : 'global';
        entries.push({ rel, abs: full, project, module, name: readSkillName(full, rel) });
      }
    }
  };
  if (existsSync(skillsDir)) walk(skillsDir);
  entries.sort((a, b) => a.rel.localeCompare(b.rel));
  return entries;
}

function cleanLegacyDirs(): number {
  let removed = 0;
  for (const name of LEGACY_FLAT_DIRS) {
    const dest = join(AGENTS_SKILLS_DIR, name);
    if (existsSync(dest)) {
      rmSync(dest, { recursive: true, force: true });
      removed++;
    }
  }
  return removed;
}

export function registerSkillCommands(program: Command): void {
  const skill = program.command('skill').description('Skill 管理（AI Agent 技能）');

  skill
    .command('install')
    .description('将 Skill 安装到 ~/.agents/skills/（供 AI Agent 发现）')
    .option('--force', '覆盖已有 Skill')
    .action((options: { force?: boolean }) => {
      const skillsDir = getProjectSkillsDir();
      if (!existsSync(skillsDir)) {
        warn(`未找到 skills 目录: ${skillsDir}`);
        return;
      }
      if (!existsSync(AGENTS_SKILLS_DIR)) {
        mkdirSync(AGENTS_SKILLS_DIR, { recursive: true });
      }

      const legacyRemoved = cleanLegacyDirs();

      // 顶层即项目目录（如 demo、anycli），整树递归拷贝，保留内部层级
      const projectDirs = readdirSync(skillsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      let installed = 0;
      let skipped = 0;
      for (const name of projectDirs) {
        const src = join(skillsDir, name);
        const dest = join(AGENTS_SKILLS_DIR, name);
        if (existsSync(dest) && !options.force) {
          skipped++;
          continue;
        }
        cpSync(src, dest, {
          recursive: true,
          force: true,
          filter: (source: string) => !source.endsWith('flow.json'),
        });
        installed++;
      }

      success(`已安装 ${installed} 个项目 Skill 到 ${AGENTS_SKILLS_DIR}`);
      if (skipped > 0) info(`跳过 ${skipped} 个（使用 --force 覆盖）`);
      if (legacyRemoved > 0) info(`已清理 ${legacyRemoved} 个旧版扁平目录`);
      info('Skill 项目:');
      for (const name of projectDirs) {
        info(`  - ${name}`);
      }
    });

  skill
    .command('list')
    .description('查看 CLI-Anything-X 管理的 Skill 及安装状态')
    .action(() => {
      const skillsDir = getProjectSkillsDir();
      const entries = collectSkillEntries(skillsDir);
      if (entries.length === 0) {
        info('未找到任何 Skill，请检查 skills 目录');
        return;
      }

      const groups = new Map<string, { name: string; module: string; installed: boolean }[]>();
      let totalInstalled = 0;
      for (const e of entries) {
        const installed = existsSync(join(AGENTS_SKILLS_DIR, e.rel, 'SKILL.md'));
        if (installed) totalInstalled++;
        if (!groups.has(e.project)) groups.set(e.project, []);
        groups.get(e.project)!.push({ name: e.name, module: e.module, installed });
      }

      const projects = Array.from(groups.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([project, skills]) => ({ project, skills }));

      output({
        skillsDir: AGENTS_SKILLS_DIR,
        projects,
        totalManaged: entries.length,
        totalInstalled,
      });
    });

  skill
    .command('uninstall')
    .description('卸载 CLI-Anything-X 相关 Skill')
    .action(() => {
      const skillsDir = getProjectSkillsDir();
      if (!existsSync(skillsDir)) {
        warn('未找到 skills 目录');
        return;
      }

      const projectDirs = readdirSync(skillsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      let removed = 0;
      for (const name of projectDirs) {
        const dest = join(AGENTS_SKILLS_DIR, name);
        if (existsSync(dest)) {
          rmSync(dest, { recursive: true, force: true });
          removed++;
        }
      }
      const legacyRemoved = cleanLegacyDirs();

      success(`已卸载 ${removed} 个项目 Skill`);
      if (legacyRemoved > 0) info(`已清理 ${legacyRemoved} 个旧版扁平目录`);
    });

  skill
    .command('docs')
    .description('生成技能总览页面（docs/skills.html），按模块浏览全部技能')
    .option('--open', '生成后用浏览器打开')
    .option('-o, --output <path>', '输出文件路径（相对项目根目录）', 'docs/skills.html')
    .action(async (options: { open?: boolean; output: string }) => {
      const { generateSkillDocs } = await import('../core/skill-docs.js');
      const outPath = generateSkillDocs({ outputPath: options.output });
      if (!outPath) {
        warn('未找到 skills 目录，无法生成技能总览页面');
        return;
      }
      success(`技能总览页面已生成: ${outPath}`);
      info('提示: anycli gen 执行完成后会自动刷新该页面');
      if (options.open) {
        const { default: open } = await import('open');
        await open(outPath);
      }
    });
}
