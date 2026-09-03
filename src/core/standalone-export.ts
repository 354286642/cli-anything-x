/**
 * 可执行技能包导出：注册表 → 不依赖 CLI-Anything-X 的技能文件集（SKILL.md + references/）。
 *
 * 纯函数模块：不读配置、不访问网络。调用方（editor server / CLI）负责从本机配置
 * 构建 ExportContext 与变量表，再打包成 zip（src/core/zip.ts）。
 */
import { buildReferenceMd } from './skill-builder.js';
import type { ApiEntry, ModuleRegistry } from './skill-builder.js';
import { resolvePathVariables } from './path-vars.js';
import { createZip } from './zip.js';

export const SESSION_PLACEHOLDER = '{{SESSION_ID}}';
/** sessionId 获取方式的统一文案（anycli 系统页面入口，用户确认） */
export const SESSION_FETCH_GUIDE = '进入 CLI-Anything-X 系统并登录 → 鼠标悬停右上角用户名 → 点击「身份标识」，即可获取 sessionId';
/** 飞书执行技能包的 sessionId 获取方式（通过绑定的 MCP 服务动态获取，不落盘） */
export const FEISHU_SESSION_FETCH_GUIDE = '调用已绑定的 MCP 服务「kol-mcp服务」中的工具「获取KOL用户sessionId」，不传参数，取返回对象的 data 字段作为本次请求的 sessionId';

export type StandaloneAuthMode = 'config' | 'feishu-mcp';

export interface StandaloneExportOptions {
  /** 默认 config 模式保持原有可执行技能包行为；feishu-mcp 模式由 MCP 动态获取 sessionId。 */
  authMode?: StandaloneAuthMode;
}

export interface ExportContext {
  /** 网关或项目 baseUrl，如 https://api.example.com */
  baseUrl: string;
  /** 环境展示名，如 正式环境 (prod) */
  envLabel: string;
  /** 项目请求前缀（client 拼接用），如 demo-service；可为空串 */
  prefix: string;
  tenantId: string;
  extTenantId: string;
  /** 导出时间（ISO），快照语义 */
  exportedAt: string;
}

export interface StandaloneFile {
  path: string;
  data: string;
}

export interface BuildResult {
  files: StandaloneFile[];
  unresolved: string[];
}

/**
 * 替换文本中的 ${name} 占位符（不整体折叠斜杠，避免破坏 https:// 等）。
 * 占位符前是 / 且变量值以 / 开头时去掉值的前导 /，避免产生 //。
 */
export function resolveTextVariables(text: string, vars: Record<string, string>): { resolved: string; unresolved: string[] } {
  const unresolved: string[] = [];
  const resolved = text.replace(/\$\{([^}]+)\}/g, (raw, name: string, offset: number) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) {
      if (!unresolved.includes(name)) unresolved.push(name);
      return raw;
    }
    let value = vars[name];
    if (value.startsWith('/') && offset > 0 && text[offset - 1] === '/') value = value.slice(1);
    return value;
  });
  return { resolved, unresolved };
}

/** 与 client.ts 一致的 URL 拼接：baseUrl + / + prefix + path（prefix 为空时不加多余斜杠） */
export function buildFullUrl(ctx: ExportContext, resolvedPath: string): string {
  return ctx.prefix ? `${ctx.baseUrl}/${ctx.prefix}${resolvedPath}` : `${ctx.baseUrl}${resolvedPath}`;
}

function curlHeaders(ctx: ExportContext): string[] {
  return [
    "-H 'Content-Type: application/json'",
    `-H 'x-session-id: ${SESSION_PLACEHOLDER}'`,
    `-H 'x-tenant-id: ${ctx.tenantId}'`,
    `-H 'x-ext-tenant-id: ${ctx.extTenantId}'`,
  ];
}

function renderQuery(template: Record<string, unknown> | string | undefined): string {
  if (!template) return '';
  if (typeof template === 'string') return template.startsWith('?') ? template : `?${template}`;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(template)) {
    if (value === undefined || value === null) continue;
    params.append(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** 生成接口的 curl 示例（完整 URL + 请求头 + body/query 模板） */
export function buildCurlBlock(api: ApiEntry, ctx: ExportContext, vars: Record<string, string>): { block: string; unresolved: string[] } {
  const { resolved: apiPath, unresolved } = resolvePathVariables(api.path, vars);
  let url = buildFullUrl(ctx, apiPath);
  const lines = [`curl -X ${api.method} '${url}'`];
  const isGetOrDelete = api.method === 'GET' || api.method === 'DELETE';
  if (isGetOrDelete) {
    const qs = renderQuery(api.queryTemplate);
    if (qs) lines[0] = `curl -X ${api.method} '${url}${qs}'`;
    else if (api.queryParams && api.queryParams.length > 0) lines[0] = `curl -X ${api.method} '${url}?<参数见下表>'`;
  }
  for (const header of curlHeaders(ctx)) lines.push(`  ${header}`);
  if (!isGetOrDelete) {
    const template = api.bodyTemplate;
    const bodyText = template === undefined
      ? '{}'
      : typeof template === 'string' ? template : JSON.stringify(template);
    lines.push(`  -d '${bodyText}'`);
  }
  // 除最后一行外，每行末尾追加续行符 `\`
  for (let i = 0; i < lines.length - 1; i += 1) lines[i] += ' \\';
  return { block: ['```bash', ...lines, '```'].join('\n'), unresolved };
}

/** 注册表文案可能带 CLI-Anything-X 指令；导出包必须脱离 CLI，重写为自包含等价说法 */
export function sanitizeAnycliRefs(text: string): string {
  return text
    .replace(/`anycli auth login`\s*重新登录/g, '重新获取 sessionId 后重试（获取方式见 SKILL.md「使用前必读」）')
    .replace(/anycli auth login/g, '重新获取 sessionId')
    .replace(/anycli auth status/g, '确认 sessionId 有效')
    .replace(/anycli auth logout/g, '清除本地保存的 sessionId');
}

const ANYCLI_REQUEST_RE = /^anycli request \S+ (GET|POST|PUT|DELETE) (\S+)(.*)$/;

/** 把注册表示例里的 `anycli request ...` 命令转成等价 curl（支持 --body/--query）；无法识别时返回 null */
export function anycliRequestToCurl(command: string, ctx: ExportContext, vars: Record<string, string>): string | null {
  const m = command.match(ANYCLI_REQUEST_RE);
  if (!m) return null;
  const method = m[1];
  const rest = m[3] || '';
  if (rest.includes('--set') || rest.includes('--paginate') || rest.includes('--api')) return null;
  const bodyMatch = rest.match(/--body '([^']*)'/);
  const queryMatch = rest.match(/--query '([^']*)'/);
  const { resolved } = resolvePathVariables(m[2], vars);
  let url = buildFullUrl(ctx, resolved);
  if (queryMatch) {
    try {
      const obj = JSON.parse(queryMatch[1]) as Record<string, unknown>;
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(obj)) {
        if (value !== undefined && value !== null) params.append(key, String(value));
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    } catch {
      return null;
    }
  }
  const lines = [`curl -X ${method} '${url}'`, ...curlHeaders(ctx)];
  if (bodyMatch) lines.push(`  -d '${bodyMatch[1]}'`);
  for (let i = 0; i < lines.length - 1; i += 1) lines[i] += ' \\';
  return lines.join('\n');
}

/** 逐行把 md 中的 anycli request 命令替换为 curl（examples 代码块场景） */
export function rewriteAnycliCommands(md: string, ctx: ExportContext, vars: Record<string, string>): string {
  return md
    .split('\n')
    .map((line) => {
      const trimmed = line.trimStart();
      if (!trimmed.startsWith('anycli request ')) return line;
      return anycliRequestToCurl(trimmed, ctx, vars) ?? line;
    })
    .join('\n');
}

/** 在 markdown 指定小节之后插入新小节（找不到则追加到末尾） */
export function insertSectionAfter(md: string, afterTitle: string, section: string): string {
  const start = md.indexOf(afterTitle);
  if (start < 0) return `${md.trimEnd()}\n\n${section}\n`;
  const next = md.indexOf('\n## ', start + afterTitle.length);
  if (next < 0) return `${md.trimEnd()}\n\n${section}\n`;
  return `${md.slice(0, next)}\n${section}\n${md.slice(next)}`;
}

/** 单接口自包含 reference：原 reference 渲染 + 占位符解析 + 「## 请求」curl 小节 */
export function buildStandaloneReferenceMd(
  api: ApiEntry,
  registry: ModuleRegistry,
  project: string,
  ctx: ExportContext,
  vars: Record<string, string>,
  options: StandaloneExportOptions = {},
): { md: string; unresolved: string[] } {
  const base = buildReferenceMd(api, registry, project);
  const { resolved: mdResolved, unresolved } = resolveTextVariables(base, vars);
  const { block, unresolved: curlUnresolved } = buildCurlBlock(api, ctx, vars);
  const section = [
    '## 请求',
    '',
    options.authMode === 'feishu-mcp'
      ? `环境：${ctx.envLabel}。发送前${FEISHU_SESSION_FETCH_GUIDE}，将 data 值作为 x-session-id，替换 ${SESSION_PLACEHOLDER}；不要要求用户手填或持久化 sessionId。`
      : `环境：${ctx.envLabel}。发送前用技能根目录 config.json 中的 sessionId 替换 ${SESSION_PLACEHOLDER}（获取与填写方式见 SKILL.md「使用前必读」）。`,
    '',
    block,
    '',
  ].join('\n');
  return {
    md: insertSectionAfter(mdResolved, '## 何时用', section),
    unresolved: [...unresolved, ...curlUnresolved.filter((u) => !unresolved.includes(u))],
  };
}

/** 自包含 SKILL.md：frontmatter + 使用前必读 + 接口路由表；接口请求细节统一放在 references/ */
export function buildStandaloneSkillMd(
  registry: ModuleRegistry,
  project: string,
  ctx: ExportContext,
  vars: Record<string, string>,
  options: StandaloneExportOptions = {},
): { md: string; unresolved: string[] } {
  const unresolved: string[] = [];
  const lines: string[] = [];
  const description = `${registry.description || registry.module}（可执行技能包：无需 CLI-Anything-X，直接 HTTP 请求）`;

  lines.push('---');
  lines.push(`name: ${registry.module}${options.authMode === 'feishu-mcp' ? '-feishu-executable' : '-executable'}`);
  lines.push(`version: ${registry.version}`);
  lines.push(`description: ${description}`);
  if (registry.triggers && registry.triggers.length > 0) {
    lines.push('triggers:');
    for (const trigger of registry.triggers) lines.push(`  - ${trigger}`);
  }
  lines.push('---');
  lines.push('');
  lines.push('<!-- 由 anycli 可执行技能包导出 — 请勿要求安装 CLI-Anything-X -->');
  lines.push('');
  lines.push(`# ${project.charAt(0).toUpperCase() + project.slice(1)} - ${registry.module.replace(`${project}-`, '')}（可执行技能包）`);
  lines.push('');
  lines.push('> 本技能为**可执行技能包**：不依赖 CLI-Anything-X，直接用 HTTP 客户端发请求。');
  lines.push('> 调用前先按需读取 references/ 下对应文件查参数结构，不要猜字段。');
  lines.push('');
  lines.push('## 使用前必读');
  lines.push('');
  if (options.authMode === 'feishu-mcp') {
    lines.push(`1. **获取 sessionId**：${FEISHU_SESSION_FETCH_GUIDE}。`);
    lines.push(`2. **发起业务请求**：将上一步返回的 data 值作为 x-session-id，替换对应接口 reference 中请求命令的 \`${SESSION_PLACEHOLDER}\`；不要要求用户手填或把 sessionId 持久化到文件。`);
    lines.push(`3. **环境**：${ctx.envLabel}，网关 \`${ctx.baseUrl}\`（需内网可达）。`);
    lines.push('4. **响应结构**：`{ "success": true, "data": ... }`；HTTP 401 = 会话过期，重新调用上述 MCP 工具获取新的 sessionId 后重试；403 = 权限不足（不要重试）。');
    lines.push(`5. **快照声明**：导出于 ${ctx.exportedAt}；接口注册表更新后本包不会自动同步，需重新下载。`);
  } else {
    lines.push(`1. **获取 sessionId**：${SESSION_FETCH_GUIDE}。`);
    lines.push(`2. **填写 config.json**：把 sessionId 写入本技能目录下 \`config.json\` 的 \`sessionId\` 字段（只需填一次）；发送请求时用 config.json 中的值统一替换对应接口 reference 请求命令里的 \`${SESSION_PLACEHOLDER}\`。`);
    lines.push(`3. **环境**：${ctx.envLabel}，网关 \`${ctx.baseUrl}\`（需内网可达）。`);
    lines.push('4. **响应结构**：`{ "success": true, "data": ... }`；HTTP 401 = 会话过期（重新获取 sessionId），403 = 权限不足（不要重试）。');
    lines.push(`5. **快照声明**：导出于 ${ctx.exportedAt}；接口注册表更新后本包不会自动同步，需重新下载。`);
  }
  lines.push('');
  lines.push('## 选哪个接口');
  lines.push('');
  lines.push('| 想做什么 | 接口 | 方式 | 按需读取 reference |');
  lines.push('|---------|------|------|-------------------|');
  for (const api of registry.apis) {
    if (api.deprecated) continue;
    lines.push(`| ${api.summary} | \`${api.id}\` | ${api.method} | [reference](references/${api.id}.md) |`);
  }
  lines.push('');
  return { md: lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n', unresolved };
}

/** 生成全部自包含文件（SKILL.md + references/*.md） */
export function buildStandaloneFiles(
  registry: ModuleRegistry,
  project: string,
  ctx: ExportContext,
  vars: Record<string, string>,
  options: StandaloneExportOptions = {},
): BuildResult {
  const files: StandaloneFile[] = [];
  const unresolved: string[] = [];
  const pushUnresolved = (list: string[]) => {
    for (const u of list) if (!unresolved.includes(u)) unresolved.push(u);
  };

  // 统一收口：anycli 命令 → curl、CLI 指令文案 → 自包含说法（导出包不依赖 CLI）
  const finalize = (md: string): string => sanitizeAnycliRefs(rewriteAnycliCommands(md, ctx, vars));

  // zip 内以技能名文件夹包裹（如 demo-order/SKILL.md），解压即得标准技能目录，可直接拷入 skills 根目录
  const dir = registry.module;

  const skill = buildStandaloneSkillMd(registry, project, ctx, vars, options);
  files.push({ path: `${dir}/SKILL.md`, data: finalize(skill.md) });
  pushUnresolved(skill.unresolved);
  // 配置文件：只放 sessionId。下载后填一次，全包请求统一取该值替换 {{SESSION_ID}}（导出永不写真实 sessionId）
  if (options.authMode !== 'feishu-mcp') {
    files.push({
      path: `${dir}/config.json`,
      data: `${JSON.stringify(
        {
          _note: `填入 sessionId（获取方式见技能包 SKILL.md「使用前必读」）；发送请求时用该值替换任意 curl 命令中的 ${SESSION_PLACEHOLDER}`,
          sessionId: '',
        },
        null,
        2,
      )}\n`,
    });
  }

  for (const api of registry.apis) {
    if (api.deprecated) continue;
    const ref = buildStandaloneReferenceMd(api, registry, project, ctx, vars, options);
    files.push({ path: `${dir}/references/${api.id}.md`, data: finalize(ref.md) });
    pushUnresolved(ref.unresolved);
  }
  return { files, unresolved };
}

export interface ExportResult {
  zipName: string;
  zipBuffer: Buffer;
  fileCount: number;
}

/** 生成可执行技能包 zip；存在未解析占位符时抛错（拒绝导出残缺 URL） */
export function exportStandaloneZip(
  registry: ModuleRegistry,
  project: string,
  ctx: ExportContext,
  vars: Record<string, string>,
  options: StandaloneExportOptions = {},
): ExportResult {
  const { files, unresolved } = buildStandaloneFiles(registry, project, ctx, vars, options);
  if (unresolved.length > 0) {
    throw new Error(`路径含未解析占位符：${unresolved.map((u) => `\${${u}}`).join('、')}（可在 apis/${project}/gen.json 的 pathVariables 配置）`);
  }
  return {
    zipName: `${registry.module}${options.authMode === 'feishu-mcp' ? '-feishu-executable' : '-executable'}.zip`,
    zipBuffer: createZip(files.map((f) => ({ path: f.path, data: f.data }))),
    fileCount: files.length,
  };
}
