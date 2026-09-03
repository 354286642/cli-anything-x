import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname, resolve, isAbsolute, relative } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

import { resolveWorkspace } from './config.js';


const WORKSPACE = resolveWorkspace();

export interface SkillCommand {
  cmd: string;
  desc: string;
}

export interface SkillInfo {
  name: string;
  module: string;
  description: string;
  triggers: string[];
  commands: SkillCommand[];
  markdown: string;
  installed: boolean;
  type: string;
}

export interface ProjectGroup {
  name: string;
  description: string;
  accent: string;
  skills: SkillInfo[];
}

export interface SkillDocsOptions {
  quiet?: boolean;
  outputPath?: string;
}

const ACCENT_PALETTE = ['#f2b544', '#4fd6c2', '#ff8f6b', '#7fb4ff', '#c792ea', '#86dd82'];

function parseFrontmatter(raw: string): { data: Record<string, string | string[]>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { data: {}, body: raw };
  const body = raw.slice(match[0].length);
  const data: Record<string, string | string[]> = {};
  const lines = match[1].split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const keyMatch = lines[i].match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!keyMatch) {
      i++;
      continue;
    }
    const key = keyMatch[1];
    const rest = keyMatch[2].trim();
    if (rest === '' || rest === '>' || rest === '|') {
      const buf: string[] = [];
      let isList = false;
      let j = i + 1;
      while (j < lines.length && (/^\s+/.test(lines[j]) || lines[j].trim() === '')) {
        const trimmed = lines[j].trim();
        if (trimmed.startsWith('- ')) {
          isList = true;
          buf.push(trimmed.slice(2).replace(/^['"]|['"]$/g, ''));
        } else if (trimmed !== '') {
          buf.push(trimmed);
        }
        j++;
      }
      data[key] = isList ? buf : buf.join(' ');
      i = j;
    } else {
      data[key] = rest.replace(/^['"]|['"]$/g, '');
      i++;
    }
  }
  return { data, body };
}

function parseCommands(body: string): SkillCommand[] {
  const commands: SkillCommand[] = [];
  const seen = new Set<string>();
  const rowPattern = /^\|\s*`([^`]+)`\s*\|\s*([^|\n]+?)\s*\|\s*$/gm;
  let match;
  while ((match = rowPattern.exec(body)) !== null) {
    const cmd = match[1].trim();
    const desc = match[2].trim();
    if (!cmd.startsWith('anycli ')) continue;
    if (seen.has(cmd)) continue;
    seen.add(cmd);
    commands.push({ cmd, desc });
  }
  return commands;
}

function getProjectDescription(projectName: string): string {
  if (projectName === 'anycli') return '全局路由 · 认证配置 · Skill 管理';
  const indexFile = join(WORKSPACE, 'src', 'projects', projectName, 'index.ts');
  if (!existsSync(indexFile)) return '';
  const content = readFileSync(indexFile, 'utf-8');
  const match = content.match(/\.description\(\s*'([^']+)'\s*\)/);
  return match ? match[1] : '';
}

export function collectSkillData(): ProjectGroup[] {
  const skillsDir = join(WORKSPACE, 'skills');
  if (!existsSync(skillsDir)) return [];
  const agentsSkillsDir = join(homedir(), '.agents', 'skills');

  const skillEntries: { rel: string; abs: string }[] = [];
  const walkSkills = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walkSkills(full);
      } else if (entry.name === 'SKILL.md') {
        skillEntries.push({ rel: relative(skillsDir, dir), abs: full });
      }
    }
  };
  walkSkills(skillsDir);
  skillEntries.sort((a, b) => a.rel.localeCompare(b.rel));

  const groups = new Map<string, SkillInfo[]>();

  for (const { rel, abs } of skillEntries) {
    const raw = readFileSync(abs, 'utf-8');
    const { data, body } = parseFrontmatter(raw);
    const parts = rel.split(/[/\\]/).filter(Boolean);
    const project = parts[0] ?? 'global';
    const module = parts.length > 1 ? parts.slice(1).join('/') : 'global';
    const name = typeof data.name === 'string' && data.name ? data.name : rel;
    const triggers = Array.isArray(data.triggers) ? data.triggers : [];
    const description = typeof data.description === 'string' ? data.description : '';
    const skillType = typeof data.type === 'string' && data.type ? data.type : 'atomic';

    const info: SkillInfo = {
      name,
      module,
      description,
      triggers,
      commands: parseCommands(body),
      markdown: body.trim(),
      installed: existsSync(join(agentsSkillsDir, rel, 'SKILL.md')),
      type: skillType,
    };

    if (!groups.has(project)) groups.set(project, []);
    groups.get(project)!.push(info);
  }

  const projectsDir = join(WORKSPACE, 'src', 'projects');
  const codeProjects = existsSync(projectsDir)
    ? readdirSync(projectsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    : [];

  const allProjects = Array.from(new Set([...groups.keys(), ...codeProjects])).sort((a, b) => {
    if (a === 'anycli') return 1;
    if (b === 'anycli') return -1;
    return a.localeCompare(b);
  });

  return allProjects.map((project, index) => ({
    name: project,
    description: getProjectDescription(project),
    accent: ACCENT_PALETTE[index % ACCENT_PALETTE.length],
    skills: groups.get(project) ?? [],
  }));
}

function buildHtml(projects: ProjectGroup[], generatedAt: string, relPath: string): string {
  const totalSkills = projects.reduce((sum, p) => sum + p.skills.length, 0);
  const totalCommands = projects.reduce(
    (sum, p) => sum + p.skills.reduce((s, sk) => s + sk.commands.length, 0),
    0,
  );
  const totalInstalled = projects.reduce(
    (sum, p) => sum + p.skills.filter((sk) => sk.installed).length,
    0,
  );

  const payload = { generatedAt, relPath, totalSkills, totalCommands, totalInstalled, projects };
  const dataJson = JSON.stringify(payload).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Anycli · Skill Registry</title>
<style>
${HTML_CSS}
</style>
</head>
<body>
<div class="bg-grid" aria-hidden="true"></div>
<div class="bg-glow glow-a" aria-hidden="true"></div>
<div class="bg-glow glow-b" aria-hidden="true"></div>

<header class="topbar">
  <div class="term reveal">
    <div class="term-bar">
      <span class="dot dot-r"></span><span class="dot dot-y"></span><span class="dot dot-g"></span>
      <span class="term-title">anycli — skill registry</span>
    </div>
    <div class="term-body">
      <div class="term-line"><span class="prompt">❯</span> <span id="typed"></span><span class="cursor" id="cursor"></span></div>
      <div class="term-line term-out" id="termOut1"></div>
      <div class="term-line term-out" id="termOut2"></div>
    </div>
  </div>

  <div class="brand reveal">
    <p class="brand-kicker">CLI-ANYTHING-X / SKILLS</p>
    <h1 class="brand-title">Skill<span class="brand-accent">Registry</span></h1>
    <p class="brand-sub">按模块浏览全部 Agent 技能 · 命令即点即拷</p>
    <div class="brand-tools">
      <label class="search">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="search" type="text" placeholder="搜索技能 / 命令 / 触发词…" autocomplete="off">
        <kbd>/</kbd>
      </label>
      <button class="theme-btn" id="themeToggle" title="切换主题">◐</button>
    </div>
  </div>
</header>

<section class="stats reveal" id="stats"></section>

<nav class="tabs reveal" id="tabs" aria-label="模块切换"></nav>

<p class="hit-note" id="hitNote" hidden></p>

<main id="main"></main>

<div class="modal-overlay" id="modal" hidden>
  <div class="modal" role="dialog" aria-modal="true">
    <div class="modal-head">
      <span class="modal-module"></span>
      <span class="modal-title"></span>
      <div class="modal-actions">
        <button class="modal-copy" type="button"></button>
        <button class="modal-close" type="button" aria-label="关闭">×</button>
      </div>
    </div>
    <div class="modal-body"></div>
  </div>
</div>

<footer class="footer">
  <span>generated by <code>anycli skill docs</code></span>
  <span class="footer-sep">·</span>
  <span id="genTime"></span>
  <span class="footer-sep">·</span>
  <span id="genPath"></span>
</footer>

<script>
var DATA = ${dataJson};
${HTML_JS}
</script>
</body>
</html>
`;
}

const HTML_CSS = `/* ---------- base ---------- */
* { margin: 0; padding: 0; box-sizing: border-box; }

:root[data-theme="dark"] {
  --bg: #0e181d;
  --panel: #152229;
  --panel-2: #1a2a32;
  --panel-3: #101c22;
  --line: #243842;
  --line-soft: #1d2f38;
  --text: #f4faf7;
  --text-dim: #c4d6d1;
  --text-faint: #93ada7;
  --code-bg: #0b1418;
  --shadow: 0 12px 32px rgba(0, 0, 0, .35);
  --glow-a: rgba(242, 181, 68, .13);
  --glow-b: rgba(79, 214, 194, .11);
  --grid-line: rgba(148, 171, 166, .05);
}
:root[data-theme="light"] {
  --bg: #eef2f0;
  --panel: #ffffff;
  --panel-2: #f4f7f6;
  --panel-3: #e7edeb;
  --line: #d3dedb;
  --line-soft: #e0e8e5;
  --text: #182624;
  --text-dim: #546b67;
  --text-faint: #8aa09b;
  --code-bg: #10201f;
  --shadow: 0 12px 28px rgba(24, 38, 36, .10);
  --glow-a: rgba(242, 181, 68, .20);
  --glow-b: rgba(38, 176, 155, .14);
  --grid-line: rgba(24, 38, 36, .045);
}

:root {
  --mono: "JetBrains Mono", "Cascadia Code", "Fira Code", Consolas, "Courier New", monospace;
  --body: "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif;
  --amber: #f2b544;
  --green: #6fd387;
}

html { scroll-behavior: smooth; }
body {
  font-family: var(--body);
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  overflow-x: hidden;
  transition: background .35s ease, color .35s ease;
}

/* ---------- ambient layers ---------- */
.bg-grid {
  position: fixed; inset: 0; z-index: -2; pointer-events: none;
  background-image:
    linear-gradient(var(--grid-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--grid-line) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: radial-gradient(ellipse 90% 70% at 50% 0%, #000 30%, transparent 100%);
  -webkit-mask-image: radial-gradient(ellipse 90% 70% at 50% 0%, #000 30%, transparent 100%);
}
.bg-glow {
  position: fixed; z-index: -3; pointer-events: none;
  width: 640px; height: 640px; border-radius: 50%;
  filter: blur(90px);
}
.glow-a { top: -220px; left: -160px; background: radial-gradient(circle, var(--glow-a), transparent 70%); }
.glow-b { bottom: -260px; right: -180px; background: radial-gradient(circle, var(--glow-b), transparent 70%); }

/* ---------- layout shell ---------- */
.topbar, .stats, .tabs, #main, .footer, .hit-note {
  max-width: 1180px;
  margin-left: auto;
  margin-right: auto;
  padding-left: 28px;
  padding-right: 28px;
}

/* ---------- header ---------- */
.topbar {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
  gap: 36px;
  align-items: center;
  padding-top: 52px;
  padding-bottom: 30px;
}

.term {
  background: var(--panel-3);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: var(--shadow);
  overflow: hidden;
}
.term-bar {
  display: flex; align-items: center; gap: 7px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--line-soft);
}
.dot { width: 11px; height: 11px; border-radius: 50%; }
.dot-r { background: #ff6159; } .dot-y { background: #ffbd2e; } .dot-g { background: #28c840; }
.term-title {
  margin-left: 8px;
  font-family: var(--mono);
  font-size: 11.5px;
  letter-spacing: .08em;
  color: var(--text-faint);
}
.term-body { padding: 18px 20px 20px; font-family: var(--mono); font-size: 13.5px; line-height: 1.9; }
.term-line { white-space: nowrap; overflow: hidden; }
.prompt { color: var(--amber); font-weight: 700; }
#typed { color: var(--text); }
.cursor {
  display: inline-block; width: 8px; height: 16px; margin-left: 2px;
  background: var(--amber); vertical-align: -2px;
  animation: blink 1s steps(1) infinite;
}
@keyframes blink { 50% { opacity: 0; } }
.term-out { color: var(--text-dim); opacity: 0; transform: translateY(4px); transition: opacity .4s ease, transform .4s ease; }
.term-out.show { opacity: 1; transform: none; }
.term-out .ok { color: var(--green); font-weight: 700; }
.term-out .num { color: var(--amber); font-weight: 700; }

.brand-kicker {
  font-family: var(--mono);
  font-size: 11.5px;
  letter-spacing: .34em;
  color: var(--text-faint);
  margin-bottom: 12px;
}
.brand-title {
  font-family: var(--mono);
  font-size: clamp(38px, 5.2vw, 58px);
  font-weight: 800;
  letter-spacing: -.02em;
  line-height: 1.02;
}
.brand-accent { color: var(--amber); }
.brand-sub { margin-top: 12px; color: var(--text-dim); font-size: 14.5px; }
.brand-tools { display: flex; align-items: center; gap: 10px; margin-top: 24px; }

.search {
  flex: 1;
  display: flex; align-items: center; gap: 9px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 10px 12px;
  color: var(--text-faint);
  transition: border-color .2s ease, box-shadow .2s ease;
}
.search:focus-within {
  border-color: var(--amber);
  box-shadow: 0 0 0 3px rgba(242, 181, 68, .16);
  color: var(--amber);
}
.search input {
  flex: 1; min-width: 0;
  border: none; outline: none; background: transparent;
  font-family: var(--mono); font-size: 13px; color: var(--text);
}
.search input::placeholder { color: var(--text-faint); }
.search kbd {
  font-family: var(--mono); font-size: 11px;
  border: 1px solid var(--line); border-radius: 5px;
  padding: 1px 7px; color: var(--text-faint);
}
.theme-btn {
  width: 41px; height: 41px; flex: none;
  border-radius: 9px;
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--text-dim);
  font-size: 17px;
  cursor: pointer;
  transition: transform .25s ease, border-color .2s ease, color .2s ease;
}
.theme-btn:hover { transform: rotate(40deg); border-color: var(--amber); color: var(--amber); }

/* ---------- stats ---------- */
.stats {
  display: flex;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel);
  margin-bottom: 26px;
  overflow: hidden;
}
.stat {
  flex: 1;
  padding: 18px 22px;
  border-right: 1px solid var(--line-soft);
  transition: background .25s ease;
}
.stat:last-child { border-right: none; }
.stat:hover { background: var(--panel-2); }
.stat-num {
  font-family: var(--mono);
  font-size: 30px;
  font-weight: 800;
  line-height: 1;
}
.stat-label {
  margin-top: 7px;
  font-size: 11.5px;
  letter-spacing: .14em;
  color: var(--text-faint);
}

/* ---------- tabs ---------- */
.tabs { display: flex; flex-wrap: wrap; gap: 9px; margin-bottom: 10px; }
.tab {
  display: inline-flex; align-items: center; gap: 8px;
  font-family: var(--mono); font-size: 13px;
  padding: 8px 15px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--text-dim);
  cursor: pointer;
  transition: transform .18s ease, border-color .2s ease, color .2s ease, background .2s ease, box-shadow .2s ease;
}
.tab:hover { transform: translateY(-2px); border-color: var(--tab-accent, var(--amber)); color: var(--text); }
.tab.active {
  border-color: var(--tab-accent, var(--amber));
  color: var(--tab-accent, var(--amber));
  background: color-mix(in srgb, var(--tab-accent, var(--amber)) 10%, var(--panel));
  box-shadow: 0 4px 16px color-mix(in srgb, var(--tab-accent, var(--amber)) 18%, transparent);
  font-weight: 700;
}
.tab-count {
  font-size: 11px;
  min-width: 20px; text-align: center;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--panel-2);
  color: var(--text-faint);
}
.tab.active .tab-count { background: color-mix(in srgb, var(--tab-accent, var(--amber)) 22%, transparent); color: inherit; }

.hit-note {
  font-family: var(--mono); font-size: 12.5px;
  color: var(--text-faint);
  margin: 4px auto 2px;
}
.hit-note b { color: var(--amber); }

/* ---------- skill cards ---------- */
#main { padding-bottom: 24px; }
.project-head {
  display: flex; align-items: baseline; gap: 14px;
  margin: 30px 0 16px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line-soft);
}
.project-head h2 {
  font-family: var(--mono);
  font-size: 21px;
  font-weight: 800;
  letter-spacing: -.01em;
}
.project-head .project-desc { font-size: 13px; color: var(--text-faint); }
.project-head .project-count {
  margin-left: auto;
  font-family: var(--mono); font-size: 12px; color: var(--text-faint);
}

.skill-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(480px, 1fr));
  gap: 18px;
}

.skill {
  position: relative;
  background: var(--panel);
  border: 1px solid var(--line);
  border-left: 4px solid var(--accent, var(--amber));
  border-radius: 12px;
  padding: 20px 22px 16px;
  transition: transform .22s ease, box-shadow .22s ease, border-color .22s ease;
  opacity: 0;
  transform: translateY(16px);
}
.skill.in {
  opacity: 1; transform: none;
  transition: opacity .5s ease var(--d, 0s), transform .5s ease var(--d, 0s), box-shadow .22s ease, border-color .22s ease;
}
.skill:hover {
  transform: translateY(-3px);
  box-shadow: 0 14px 34px color-mix(in srgb, var(--accent, var(--amber)) 13%, rgba(0,0,0,.28));
  border-color: color-mix(in srgb, var(--accent, var(--amber)) 55%, var(--line));
}

.skill-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.skill-module {
  font-family: var(--mono); font-size: 11px; font-weight: 700;
  letter-spacing: .1em; text-transform: uppercase;
  padding: 3px 9px; border-radius: 5px;
  color: var(--accent, var(--amber));
  background: color-mix(in srgb, var(--accent, var(--amber)) 13%, transparent);
}
.skill-name { font-family: var(--mono); font-size: 17.5px; font-weight: 800; letter-spacing: -.01em; cursor: pointer; transition: color .2s ease; }
.skill-name:hover { color: var(--accent, var(--amber)); text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 4px; }
.badge-flow { display: inline-block; padding: 1px 7px; font-size: 11px; font-weight: 600; color: #fff; background: #e8873a; border-radius: 4px; margin-left: 6px; vertical-align: middle; }
.name-copy { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; flex: none; border: 1px solid var(--line); border-radius: 6px; background: transparent; color: var(--text-faint); cursor: pointer; padding: 0; transition: color .18s ease, border-color .18s ease, transform .15s ease, background .18s ease; }
.name-copy:hover { color: var(--accent, var(--amber)); border-color: var(--accent, var(--amber)); background: color-mix(in srgb, var(--accent, var(--amber)) 12%, transparent); transform: translateY(-1px); }
.name-copy svg { width: 13px; height: 13px; }
.name-copy.done { color: var(--green); border-color: var(--green); }
.skill-status {
  margin-left: auto;
  display: inline-flex; align-items: center; gap: 6px;
  font-family: var(--mono); font-size: 11px; color: var(--text-faint);
}
.skill-status i { width: 7px; height: 7px; border-radius: 50%; background: var(--text-faint); }
.skill-status.on { color: var(--green); }
.skill-status.on i { background: var(--green); box-shadow: 0 0 8px var(--green); }

.skill-desc { margin-top: 11px; font-size: 13.5px; line-height: 1.65; color: var(--text-dim); }

.triggers { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.trigger {
  font-family: var(--mono); font-size: 11px;
  padding: 2px 9px; border-radius: 999px;
  border: 1px solid var(--line);
  color: var(--text-faint);
  transition: color .2s ease, border-color .2s ease, transform .15s ease;
}
.trigger:hover { color: var(--accent, var(--amber)); border-color: var(--accent, var(--amber)); transform: translateY(-1px); }

.cmd-list {
  margin-top: 15px;
  border-top: 1px dashed var(--line);
  padding-top: 11px;
  display: flex; flex-direction: column; gap: 3px;
}
.cmd {
  display: flex; align-items: center; gap: 9px;
  font-family: var(--mono); font-size: 12.5px;
  padding: 6px 9px;
  border-radius: 7px;
  cursor: pointer;
  transition: background .18s ease;
}
.cmd:hover { background: var(--panel-2); }
.cmd .dollar { color: var(--accent, var(--amber)); font-weight: 700; }
.cmd code { color: var(--text); white-space: nowrap; }
.cmd .cmd-desc {
  color: var(--text-faint); font-size: 11.5px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cmd .copy-btn {
  margin-left: auto; flex: none;
  font-family: var(--mono); font-size: 10.5px;
  border: 1px solid var(--line); border-radius: 5px;
  background: transparent; color: var(--text-faint);
  padding: 2px 8px; cursor: pointer;
  opacity: 0; transition: opacity .18s ease, color .18s ease, border-color .18s ease;
}
.cmd:hover .copy-btn { opacity: 1; }
.copy-btn:hover { color: var(--accent, var(--amber)); border-color: var(--accent, var(--amber)); }
.copy-btn.done { color: var(--green); border-color: var(--green); opacity: 1; }

.expand-btn {
  margin-top: 13px;
  display: inline-flex; align-items: center; gap: 7px;
  font-family: var(--mono); font-size: 12px;
  background: none; border: none; cursor: pointer;
  color: var(--text-faint);
  padding: 3px 0;
  transition: color .2s ease;
}
.expand-btn:hover { color: var(--accent, var(--amber)); }
.expand-btn .chev { display: inline-block; transition: transform .3s ease; }
.skill.open .expand-btn .chev { transform: rotate(90deg); }

.doc-wrap {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows .38s ease;
}
.skill.open .doc-wrap { grid-template-rows: 1fr; }
.doc-inner { overflow: hidden; }
.doc {
  margin-top: 14px;
  border-top: 1px solid var(--line-soft);
  padding-top: 14px;
  font-size: 13.5px;
  line-height: 1.75;
  color: var(--text-dim);
}
.doc h1, .doc h2, .doc h3, .doc h4 { color: var(--text); font-weight: 700; margin: 20px 0 9px; line-height: 1.35; }
.doc h1 { font-size: 19px; }
.doc h2 { font-size: 16.5px; padding-bottom: 6px; border-bottom: 1px solid var(--line-soft); }
.doc h3 { font-size: 14.5px; }
.doc h4 { font-size: 13.5px; }
.doc h1:first-child, .doc h2:first-child { margin-top: 2px; }
.doc p { margin: 8px 0; }
.doc ul, .doc ol { margin: 8px 0 8px 22px; }
.doc li { margin: 3px 0; }
.doc code {
  font-family: var(--mono); font-size: 12px;
  background: var(--panel-2);
  border: 1px solid var(--line-soft);
  border-radius: 4px;
  padding: 1px 6px;
  color: var(--accent, var(--amber));
}
.doc a { color: var(--accent, var(--amber)); }
.doc strong { color: var(--text); }
.doc .codeblock {
  position: relative;
  margin: 11px 0;
  border-radius: 9px;
  background: var(--code-bg);
  border: 1px solid var(--line-soft);
  overflow: hidden;
}
.doc .code-lang {
  position: absolute; top: 7px; right: 11px;
  font-family: var(--mono); font-size: 10px;
  letter-spacing: .14em; text-transform: uppercase;
  color: #5d7370;
}
.doc pre {
  padding: 14px 16px;
  overflow-x: auto;
  font-family: var(--mono); font-size: 12px; line-height: 1.7;
  color: #cfe3de;
}
.doc .tbl-wrap { margin: 11px 0; overflow-x: auto; border: 1px solid var(--line-soft); border-radius: 9px; }
.doc table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.doc th {
  text-align: left;
  font-family: var(--mono); font-size: 11px; letter-spacing: .08em;
  background: var(--panel-2);
  color: var(--text-dim);
  padding: 8px 13px;
  border-bottom: 1px solid var(--line-soft);
}
.doc td { padding: 7px 13px; border-bottom: 1px solid var(--line-soft); vertical-align: top; }
.doc tr:last-child td { border-bottom: none; }
.doc tbody tr { transition: background .15s ease; }
.doc tbody tr:hover { background: var(--panel-2); }

/* ---------- empty state ---------- */
.empty {
  margin: 46px 0;
  text-align: center;
  font-family: var(--mono);
  color: var(--text-faint);
  font-size: 13.5px;
  line-height: 2.1;
}
.empty .empty-prompt { color: var(--amber); }
.empty .empty-cursor {
  display: inline-block; width: 8px; height: 15px; margin-left: 3px;
  background: var(--text-faint); vertical-align: -2px;
  animation: blink 1s steps(1) infinite;
}

/* ---------- footer ---------- */
.footer {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding-top: 20px; padding-bottom: 42px;
  font-family: var(--mono); font-size: 11.5px;
  color: var(--text-faint);
  border-top: 1px solid var(--line-soft);
}
.footer code { color: var(--text-dim); }
.footer-sep { opacity: .5; }

/* ---------- reveal ---------- */
.reveal { opacity: 0; transform: translateY(14px); transition: opacity .55s ease, transform .55s ease; }
.reveal.in { opacity: 1; transform: none; }

/* ---------- modal ---------- */
.modal-overlay { position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center; padding: 32px; background: rgba(6, 12, 14, .62); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); opacity: 0; pointer-events: none; transition: opacity .25s ease; }
.modal-overlay.open { opacity: 1; pointer-events: auto; }
.modal { width: min(860px, 100%); max-height: 86vh; display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--line); border-top: 3px solid var(--modal-accent, var(--amber)); border-radius: 14px; box-shadow: 0 30px 80px rgba(0,0,0,.5); transform: translateY(14px) scale(.98); transition: transform .28s cubic-bezier(.2,.8,.2,1); overflow: hidden; }
.modal-overlay.open .modal { transform: none; }
.modal-head { display: flex; align-items: center; gap: 11px; padding: 16px 20px; border-bottom: 1px solid var(--line-soft); background: var(--panel-2); }
.modal-head .modal-module { font-family: var(--mono); font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; padding: 3px 9px; border-radius: 5px; color: var(--modal-accent, var(--amber)); background: color-mix(in srgb, var(--modal-accent, var(--amber)) 13%, transparent); }
.modal-title { font-family: var(--mono); font-size: 17px; font-weight: 800; letter-spacing: -.01em; }
.modal-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.modal-copy { display: inline-flex; align-items: center; gap: 6px; font-family: var(--mono); font-size: 11.5px; border: 1px solid var(--line); border-radius: 7px; background: transparent; color: var(--text-dim); padding: 5px 11px; cursor: pointer; transition: color .18s ease, border-color .18s ease; }
.modal-copy:hover { color: var(--modal-accent, var(--amber)); border-color: var(--modal-accent, var(--amber)); }
.modal-copy.done { color: var(--green); border-color: var(--green); }
.modal-copy svg { width: 13px; height: 13px; }
.modal-close { width: 32px; height: 32px; flex: none; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: var(--text-dim); font-size: 18px; line-height: 1; cursor: pointer; transition: color .18s ease, border-color .18s ease, transform .2s ease; }
.modal-close:hover { color: var(--amber); border-color: var(--amber); transform: rotate(90deg); }
.modal-body { padding: 22px 26px; overflow-y: auto; }
.modal-body::-webkit-scrollbar { width: 9px; }
.modal-body::-webkit-scrollbar-thumb { background: var(--line); border-radius: 9px; }
.modal-body .doc { margin-top: 0; border-top: none; padding-top: 0; }

@media (max-width: 900px) {
  .topbar { grid-template-columns: 1fr; gap: 26px; padding-top: 34px; }
  .skill-grid { grid-template-columns: 1fr; }
  .stats { flex-wrap: wrap; }
  .stat { flex: 1 1 45%; border-bottom: 1px solid var(--line-soft); }
}`;

const HTML_JS = `/* ---------- data ---------- */
var PROJECTS = DATA.projects;
var COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
var state = { tab: '__all__', query: '' };
var SKMAP = {};

/* ---------- helpers ---------- */
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function inline(s) {
  return s
    .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
    .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
    .replace(/\\[([^\\]]+)\\]\\(([^)\\s]+)\\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
function splitRow(line) {
  return line.trim().replace(/^\\|/, '').replace(/\\|$/, '').split('|').map(function (c) { return c.trim(); });
}
function renderTable(header, rows) {
  var h = '<div class="tbl-wrap"><table><thead><tr>';
  header.forEach(function (c) { h += '<th>' + inline(c) + '</th>'; });
  h += '</tr></thead><tbody>';
  rows.forEach(function (r) {
    h += '<tr>';
    r.forEach(function (c) { h += '<td>' + inline(c) + '</td>'; });
    h += '</tr>';
  });
  return h + '</tbody></table></div>';
}
function mdToHtml(md) {
  var lines = esc(md).split(/\\r?\\n/);
  var html = [];
  var i = 0;
  var inCode = false;
  var codeBuf = [];
  var codeLang = '';
  var listType = null;

  function closeList() {
    if (listType) { html.push('</' + listType + '>'); listType = null; }
  }

  while (i < lines.length) {
    var line = lines[i];
    var fence = line.match(/^\`\`\`(\\w*)\\s*$/);
    if (fence) {
      if (!inCode) {
        closeList();
        inCode = true;
        codeLang = fence[1] || '';
        codeBuf = [];
      } else {
        html.push('<div class="codeblock"><span class="code-lang">' + (codeLang || 'shell') + '</span><pre><code>' + codeBuf.join('\\n') + '</code></pre></div>');
        inCode = false;
      }
      i++;
      continue;
    }
    if (inCode) { codeBuf.push(line); i++; continue; }

    var h = line.match(/^(#{1,4})\\s+(.*)$/);
    if (h) {
      closeList();
      var lv = h[1].length;
      html.push('<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>');
      i++;
      continue;
    }

    if (/^\\s*([-*]|\\d+\\.)\\s+/.test(line)) {
      var type = /^\\s*\\d+\\./.test(line) ? 'ol' : 'ul';
      if (listType !== type) { closeList(); html.push('<' + type + '>'); listType = type; }
      html.push('<li>' + inline(line.replace(/^\\s*([-*]|\\d+\\.)\\s+/, '')) + '</li>');
      i++;
      continue;
    }

    if (/^\\|.*\\|\\s*$/.test(line) && i + 1 < lines.length && /^\\|[\\s:|-]+\\|\\s*$/.test(lines[i + 1])) {
      closeList();
      var header = splitRow(line);
      i += 2;
      var rows = [];
      while (i < lines.length && /^\\|.*\\|\\s*$/.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
      html.push(renderTable(header, rows));
      continue;
    }

    if (line.trim() === '') { closeList(); i++; continue; }
    closeList();
    html.push('<p>' + inline(line) + '</p>');
    i++;
  }
  closeList();
  if (inCode) html.push('<div class="codeblock"><pre><code>' + codeBuf.join('\\n') + '</code></pre></div>');
  return html.join('\\n');
}

/* ---------- stats ---------- */
function countUp(el, target) {
  var start = null;
  var dur = 700;
  function step(ts) {
    if (!start) start = ts;
    var p = Math.min((ts - start) / dur, 1);
    el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
function renderStats() {
  var moduleCount = PROJECTS.filter(function (p) { return p.skills.length > 0; }).length;
  var items = [
    { num: moduleCount, label: '模块 MODULES', color: '#f2b544' },
    { num: DATA.totalSkills, label: '技能 SKILLS', color: '#4fd6c2' },
    { num: DATA.totalCommands, label: '命令 COMMANDS', color: '#ff8f6b' },
    { num: DATA.totalInstalled, label: '已装 INSTALLED', color: '#6fd387' }
  ];
  var box = document.getElementById('stats');
  box.innerHTML = items.map(function (it) {
    return '<div class="stat"><div class="stat-num" style="color:' + it.color + '" data-n="' + it.num + '">0</div><div class="stat-label">' + it.label + '</div></div>';
  }).join('');
  Array.prototype.forEach.call(box.querySelectorAll('.stat-num'), function (el) {
    countUp(el, parseInt(el.getAttribute('data-n'), 10));
  });
}

/* ---------- tabs ---------- */
function renderTabs() {
  var box = document.getElementById('tabs');
  var total = DATA.totalSkills;
  var html = '<button class="tab" data-tab="__all__" style="--tab-accent:#f2b544">全部 <span class="tab-count">' + total + '</span></button>';
  PROJECTS.forEach(function (p) {
    html += '<button class="tab" data-tab="' + esc(p.name) + '" style="--tab-accent:' + p.accent + '">' + esc(p.name) + ' <span class="tab-count">' + p.skills.length + '</span></button>';
  });
  box.innerHTML = html;
  Array.prototype.forEach.call(box.querySelectorAll('.tab'), function (btn) {
    btn.addEventListener('click', function () {
      state.tab = btn.getAttribute('data-tab');
      render();
    });
  });
}

/* ---------- matching ---------- */
function matchSkill(sk, q) {
  if (!q) return true;
  var hay = [sk.name, sk.module, sk.description, sk.triggers.join(' '), sk.commands.map(function (c) { return c.cmd + ' ' + c.desc; }).join(' ')].join(' ').toLowerCase();
  return q.toLowerCase().split(/\\s+/).every(function (part) { return hay.indexOf(part) !== -1; });
}

/* ---------- cards ---------- */
function skillCard(sk, accent, idx) {
  var cmds = sk.commands.map(function (c) {
    return '<div class="cmd" data-cmd="' + esc(c.cmd) + '" title="点击复制">' +
      '<span class="dollar">❯</span><code>' + esc(c.cmd) + '</code>' +
      '<span class="cmd-desc">' + esc(c.desc) + '</span>' +
      '<button class="copy-btn">复制</button></div>';
  }).join('');
  if (!cmds) cmds = '<div class="cmd" style="cursor:default"><span class="dollar">❯</span><span class="cmd-desc">暂无命令，等待 anycli gen 生成</span></div>';

  var triggers = sk.triggers.map(function (t) { return '<span class="trigger">#' + esc(t) + '</span>'; }).join('');
  var status = sk.installed
    ? '<span class="skill-status on"><i></i>已安装</span>'
    : '<span class="skill-status"><i></i>未安装</span>';

  return '<article class="skill" style="--accent:' + accent + ';--d:' + (idx % 6) * 70 + 'ms">' +
    '<div class="skill-top">' +
      '<span class="skill-module">' + esc(sk.module) + '</span>' +
      '<span class="skill-name" data-skill="' + esc(sk.name) + '" title="点击查看完整文档">' + esc(sk.name) + '</span>' +
      (sk.type === 'flow' ? '<span class="badge-flow">流程</span>' : '') +
      '<button class="name-copy" data-copy-name="' + esc(sk.name) + '" title="复制技能名">' + COPY_ICON + '</button>' + status +
    '</div>' +
    (sk.description ? '<p class="skill-desc">' + esc(sk.description) + '</p>' : '') +
    (triggers ? '<div class="triggers">' + triggers + '</div>' : '') +
    '<div class="cmd-list">' + cmds + '</div>' +

  '</article>';
}

function render() {
  var q = state.query.trim();
  var main = document.getElementById('main');
  var note = document.getElementById('hitNote');
  var html = '';
  var hitTotal = 0;
  SKMAP = {};

  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (btn) {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === state.tab);
  });

  PROJECTS.forEach(function (p) {
    if (state.tab !== '__all__' && p.name !== state.tab) return;
    var skills = p.skills.filter(function (sk) { return matchSkill(sk, q); });
    if (state.tab === '__all__' && q && skills.length === 0) return;
    hitTotal += skills.length;
    skills.forEach(function (sk) { SKMAP[sk.name] = sk; });

    html += '<div class="project-head">' +
      '<h2 style="color:' + p.accent + '">' + esc(p.name) + '</h2>' +
      (p.description ? '<span class="project-desc">' + esc(p.description) + '</span>' : '') +
      '<span class="project-count">' + skills.length + ' skill' + (skills.length === 1 ? '' : 's') + '</span>' +
    '</div>';

    if (skills.length === 0) {
      html += '<div class="empty"><span class="empty-prompt">❯</span> ' + esc(p.name) + ' 暂无技能<span class="empty-cursor"></span></div>';
    } else {
      html += '<div class="skill-grid">' + skills.map(function (sk, i) { return skillCard(sk, p.accent, i); }).join('') + '</div>';
    }
  });

  if (q && hitTotal === 0) {
    html = '<div class="empty"><span class="empty-prompt">❯</span> search "' + esc(q) + '" — 0 matches<span class="empty-cursor"></span></div>';
  }

  main.innerHTML = html;
  note.hidden = !q;
  if (q) note.innerHTML = '匹配 <b>' + hitTotal + '</b> 个技能';

  bindCards();
  observeReveal();
}

function bindCards() {
  Array.prototype.forEach.call(document.querySelectorAll('.skill'), function (card) {
    var accent = card.style.getPropertyValue('--accent') || '#f2b544';
    var nameEl = card.querySelector('.skill-name');
    if (nameEl) nameEl.addEventListener('click', function () { openModal(SKMAP[nameEl.getAttribute('data-skill')], accent); });
    var nc = card.querySelector('.name-copy');
    if (nc) nc.addEventListener('click', function (e) { e.stopPropagation(); copyText(nc.getAttribute('data-copy-name'), nc); });
    Array.prototype.forEach.call(card.querySelectorAll('.cmd[data-cmd]'), function (row) {
      row.addEventListener('click', function () {
        copyText(row.getAttribute('data-cmd'), row.querySelector('.copy-btn'));
      });
    });
  });
}

function copyText(text, btn) {
  function done() {
    if (!btn) return;
    btn.textContent = '✓ 已复制';
    btn.classList.add('done');
    setTimeout(function () { btn.textContent = '复制'; btn.classList.remove('done'); }, 1300);
  }
  function fallback() {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
    done();
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, fallback);
  } else {
    fallback();
  }
}

/* ---------- modal ---------- */
function openModal(sk, accent) {
  if (!sk) return;
  var overlay = document.getElementById('modal');
  var modal = overlay.querySelector('.modal');
  modal.style.setProperty('--modal-accent', accent || '#f2b544');
  overlay.querySelector('.modal-module').textContent = sk.module;
  overlay.querySelector('.modal-title').textContent = sk.name;
  var copyBtn = overlay.querySelector('.modal-copy');
  copyBtn.innerHTML = COPY_ICON + ' 复制技能名';
  copyBtn.onclick = function () { copyText(sk.name, copyBtn); };
  overlay.querySelector('.modal-body').innerHTML = '<div class="doc">' + mdToHtml(sk.markdown) + '</div>';
  overlay.classList.add('open');
  overlay.removeAttribute('hidden');
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  var overlay = document.getElementById('modal');
  overlay.classList.remove('open');
  document.body.style.overflow = '';
  setTimeout(function () { if (!overlay.classList.contains('open')) overlay.setAttribute('hidden', ''); }, 260);
}
function initModal() {
  var overlay = document.getElementById('modal');
  overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
  overlay.querySelector('.modal-close').addEventListener('click', closeModal);
}

/* ---------- reveal on scroll ---------- */
var observer = null;
function observeReveal() {
  var els = document.querySelectorAll('.skill:not(.in), .reveal:not(.in)');
  if (!('IntersectionObserver' in window)) {
    Array.prototype.forEach.call(els, function (el) { el.classList.add('in'); });
    return;
  }
  if (!observer) {
    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); observer.unobserve(en.target); }
      });
    }, { threshold: 0.06 });
  }
  Array.prototype.forEach.call(els, function (el) { observer.observe(el); });
}

/* ---------- terminal typing ---------- */
function typeLine() {
  var text = 'anycli skill docs --open';
  var el = document.getElementById('typed');
  var i = 0;
  function tick() {
    el.textContent = text.slice(0, i);
    if (i <= text.length) { i++; setTimeout(tick, 46 + Math.random() * 60); }
    else {
      setTimeout(function () {
        var o1 = document.getElementById('termOut1');
        var o2 = document.getElementById('termOut2');
        o1.innerHTML = '<span class="ok">✔</span> 已生成 docs/skills.html';
        o1.classList.add('show');
        setTimeout(function () {
          o2.innerHTML = '<span class="ok">✔</span> <span class="num">' + DATA.totalSkills + '</span> skills · <span class="num">' + DATA.totalCommands + '</span> commands · <span class="num">' + PROJECTS.length + '</span> modules';
          o2.classList.add('show');
        }, 260);
      }, 240);
    }
  }
  tick();
}

/* ---------- theme ---------- */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('anycli-skill-theme', t); } catch (e) {}
}
function initTheme() {
  var saved = null;
  try { saved = localStorage.getItem('anycli-skill-theme'); } catch (e) {}
  applyTheme(saved === 'light' ? 'light' : 'dark');
  document.getElementById('themeToggle').addEventListener('click', function () {
    var cur = document.documentElement.getAttribute('data-theme');
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  });
}

/* ---------- search shortcut ---------- */
document.addEventListener('keydown', function (e) {
  var searchBox = document.getElementById('search');
  if (e.key === 'Escape' && document.getElementById('modal').classList.contains('open')) { closeModal(); return; }
  if (e.key === '/' && document.activeElement !== searchBox) {
    e.preventDefault();
    searchBox.focus();
  }
  if (e.key === 'Escape' && document.activeElement === searchBox) {
    searchBox.value = '';
    state.query = '';
    render();
    searchBox.blur();
  }
});

/* ---------- boot ---------- */
document.getElementById('genTime').textContent = DATA.generatedAt;
document.getElementById('genPath').textContent = DATA.relPath;
document.getElementById('search').addEventListener('input', function (e) {
  state.query = e.target.value;
  render();
});
initTheme();
initModal();
renderStats();
renderTabs();
render();
typeLine();
observeReveal();`;

export function generateSkillDocs(options: SkillDocsOptions = {}): string | null {
  const projects = collectSkillData();
  if (projects.length === 0) return null;

  const outputPath = options.outputPath ?? join('docs', 'skills.html');
  const absPath = isAbsolute(outputPath) ? outputPath : resolve(WORKSPACE, outputPath);
  const relPath = relative(WORKSPACE, absPath).replace(/\\/g, '/');

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const generatedAt = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const html = buildHtml(projects, generatedAt, relPath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, html, 'utf-8');
  return absPath;
}
