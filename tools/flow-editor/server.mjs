#!/usr/bin/env node
/**
 * 工作流可视化编辑器 - 本地服务
 *
 * 仅使用 Node.js 内置模块，无额外依赖。
 * 用法：node tools/flow-editor/server.mjs [--port 3210]
 */
import http from 'node:http';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createFlowEnhanceManager } from './flow-enhance-server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 项目根目录：tools/flow-editor -> ../../
const ROOT = path.resolve(__dirname, '..', '..');
const SKILLS_DIR = path.join(ROOT, 'skills');
const EDITOR_DIR = __dirname;

// ---------------------------------------------------------------------------
// 命令行参数
// ---------------------------------------------------------------------------
function parsePort(argv) {
  const idx = argv.indexOf('--port');
  if (idx !== -1 && argv[idx + 1]) {
    const parsed = Number.parseInt(argv[idx + 1], 10);
    if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) return parsed;
    console.error(`[flow-editor] 无效端口: ${argv[idx + 1]}，使用默认 3210`);
  }
  return 3210;
}
const PORT = parsePort(process.argv.slice(2));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------
function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

/** 拼接路径并确保不越出 base，越出返回 null */
function safeJoin(base, ...parts) {
  const target = path.resolve(base, ...parts);
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return target;
}

/** 校验工作流 id（形如 demo/flows/create-sample-requirement） */
function resolveFlowDir(id) {
  if (!id || /[\\/]\.\.([\\/]|$)/.test(id) || path.isAbsolute(id)) return null;
  const normalized = id.split(/[\\/]/).filter(Boolean).join(path.sep);
  if (!normalized) return null;
  return safeJoin(SKILLS_DIR, normalized);
}

async function readJson(file) {
  const text = await readFile(file, 'utf8');
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// 工作流扫描与读写
// ---------------------------------------------------------------------------
async function listWorkflows() {
  const items = [];
  let projects = [];
  try {
    projects = await readdir(SKILLS_DIR, { withFileTypes: true });
  } catch {
    return items; // skills 目录不存在时返回空列表
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const flowsDir = path.join(SKILLS_DIR, project.name, 'flows');
    let businesses = [];
    try {
      businesses = await readdir(flowsDir, { withFileTypes: true });
    } catch {
      continue; // 该项目没有 flows 目录
    }
    for (const business of businesses) {
      if (!business.isDirectory()) continue;
      const flowFile = path.join(flowsDir, business.name, 'flow.json');
      let flowMeta = null;
      try {
        flowMeta = await readJson(flowFile);
      } catch {
        continue; // 无 flow.json 或解析失败则跳过
      }
      const id = `${project.name}/flows/${business.name}`;
      items.push({
        id,
        name: flowMeta?.meta?.name ?? business.name,
        title: flowMeta?.title ?? business.name,
        path: path.relative(ROOT, flowFile).split(path.sep).join('/'),
      });
    }
  }
  items.sort((a, b) => a.id.localeCompare(b.id));
  return items;
}

/**
 * 读取接口注册表，供 Flow 编辑器按项目/Skill/API 选择流程步骤。
 * 注册表是 API 的单一事实来源，不能从生成后的 SKILL.md 反解析。
 */
async function listSkillCatalog() {
  const catalog = [];
  let projects = [];
  try {
    projects = await readdir(path.join(ROOT, 'apis'), { withFileTypes: true });
  } catch {
    return catalog;
  }

  for (const project of projects) {
    if (!project.isDirectory() || project.name.startsWith('_')) continue;
    const projectDir = path.join(ROOT, 'apis', project.name);
    let files = [];
    try {
      files = await readdir(projectDir, { withFileTypes: true });
    } catch {
      continue;
    }

    const modules = [];
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.json') || file.name === 'schema.json' || file.name === 'gen.json') continue;
      let registry;
      try {
        registry = await readJson(path.join(projectDir, file.name));
      } catch {
        continue;
      }
      if (!registry || !Array.isArray(registry.apis)) continue;
      modules.push({
        module: file.name.slice(0, -5),
        skill: registry.module || `${project.name}-${file.name.slice(0, -5)}`,
        description: registry.description || '',
        triggers: Array.isArray(registry.triggers) ? registry.triggers : [],
        principles: Array.isArray(registry.principles) ? registry.principles : [],
        prerequisites: Array.isArray(registry.prerequisites) ? registry.prerequisites : [],
        errorHandling: Array.isArray(registry.errorHandling) ? registry.errorHandling : [],
        chains: Array.isArray(registry.chains) ? registry.chains : [],
        apis: registry.apis.map((api) => ({
          ...api,
          id: api.id,
          summary: api.summary || api.id,
          method: api.method,
          path: api.path,
          level: api.level || 'read',
          bodyTemplate: api.bodyTemplate ?? '{}',
          outputFields: api.outputFields || '',
        })),
      });
    }
    modules.sort((a, b) => a.module.localeCompare(b.module));
    if (modules.length) catalog.push({ project: project.name, modules });
  }
  catalog.sort((a, b) => a.project.localeCompare(b.project));
  return catalog;
}

async function createWorkflow({ project, business }) {
  if (!project || !business) {
    throw new HttpError(400, '缺少 project 或 business 参数');
  }
  const namePattern = /^[a-z0-9][a-z0-9-]*$/;
  if (!namePattern.test(project) || !namePattern.test(business)) {
    throw new HttpError(400, 'project / business 仅允许小写字母、数字与连字符，且以字母或数字开头');
  }
  const dir = path.join(SKILLS_DIR, project, 'flows', business);
  const flowFile = path.join(dir, 'flow.json');
  try {
    await stat(flowFile);
    throw new HttpError(409, `工作流已存在: ${project}/flows/${business}`);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err.code !== 'ENOENT') throw err;
  }
  const skeleton = {
    meta: {
      name: `flow-${project}-${business}`,
      description: `业务流程：${business}`,
      type: 'flow',
      triggers: [],
    },
    title: business,
    sourceRefs: { controller: '', dto: '', frontend: '' },
    businessGoal: '',
    scenarios: [],
    prerequisites: [],
    steps: [],
    fieldGroups: [],
    apis: [],
    speechTemplates: [],
    agentStrategy: { prefillRules: [], mustAsk: [], forbidden: [] },
    endApi: { method: 'POST', path: '', bodyTemplate: '{}', evidenceSource: 'name-only' },
    errorHandling: [],
    successCriteria: [],
    domainKnowledge: [],
    reference: { fields: '', examples: '', verify: '' },
  };
  await mkdir(dir, { recursive: true });
  await writeFile(flowFile, JSON.stringify(skeleton, null, 2) + '\n', 'utf8');
  return { id: `${project}/flows/${business}`, path: path.relative(ROOT, flowFile).split(path.sep).join('/') };
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

// ---------------------------------------------------------------------------
// 静态文件
// ---------------------------------------------------------------------------
async function serveStatic(res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  // 深链：/flow/{id} 返回编辑器页面（与统一编辑器 URL 结构一致）
  if (rel === '/flow' || rel.startsWith('/flow/')) rel = '/index.html';
  // 嵌入统一编辑器时，静态资源走 /flow-editor/ 前缀
  if (rel.startsWith('/flow-editor/')) rel = rel.slice('/flow-editor/'.length - 1);
  if (rel === '/') rel = '/index.html';
  const file = safeJoin(EDITOR_DIR, rel.replace(/^\/+/, ''));
  if (!file) return sendError(res, 403, '禁止访问该路径');
  try {
    const content = await readFile(file);
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Content-Length': content.length,
      'Cache-Control': 'no-cache',
    });
    res.end(content);
  } catch {
    sendError(res, 404, `文件不存在: ${rel}`);
  }
}

// ---------------------------------------------------------------------------
// 请求体读取
// ---------------------------------------------------------------------------
function readBody(req, limit = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, '请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const flowEnhance = createFlowEnhanceManager({ root: ROOT, readBody, sendError, sendJson });

// ---------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  try {
    // ---- API: 工作流列表 / 新建 ----
    if (pathname === '/api/workflows') {
      if (req.method === 'GET') {
        return sendJson(res, 200, { workflows: await listWorkflows() });
      }
      if (req.method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}');
        const created = await createWorkflow(body);
        return sendJson(res, 201, created);
      }
      return sendError(res, 405, `不支持的方法: ${req.method}`);
    }

    // ---- API: 原子 Skill/API 目录 ----
    if (pathname === '/api/skill-catalog') {
      if (req.method !== 'GET') return sendError(res, 405, `不支持的方法: ${req.method}`);
      return sendJson(res, 200, { projects: await listSkillCatalog() });
    }

    // ---- API: Flow Enhance（实时 SSE + 可恢复问答） ----
    const enhanceMatch = pathname.match(/^\/api\/workflows\/(.+?)\/enhance(?:\/([^/]+)(?:\/(answer|cancel))?)?$/);
    if (enhanceMatch) {
      const rawId = decodeURIComponent(enhanceMatch[1]);
      const taskId = enhanceMatch[2];
      const action = enhanceMatch[3];
      const dir = resolveFlowDir(rawId);
      if (!dir) return sendError(res, 400, `非法的工作流 id: ${rawId}`);
      if (!taskId && req.method === 'POST') {
        const flowFile = path.join(dir, 'flow.json');
        try {
          const flow = await readJson(flowFile);
          let capture;
          try { capture = await readJson(path.join(dir, 'capture.json')); } catch { /* 历史 Flow 可降级 */ }
          return await flowEnhance.start(req, res, flow, capture);
        } catch { return sendError(res, 404, `flow.json 不存在: ${rawId}`); }
      }
      if (taskId && action === 'answer' && req.method === 'POST') return await flowEnhance.answer(req, res, taskId);
      if (taskId && action === 'cancel' && req.method === 'POST') return flowEnhance.cancel(req, res, taskId);
      if (taskId && req.method === 'GET') return flowEnhance.status(req, res, taskId);
      return sendError(res, 405, `不支持的方法: ${req.method}`);
    }

    // ---- API: 单个工作流（id 为多段路径） ----
    const flowMatch = pathname.match(/^\/api\/workflows\/(.+?)(\/build)?$/);
    if (flowMatch) {
      const id = decodeURIComponent(flowMatch[1]);
      const isBuild = Boolean(flowMatch[2]);
      const dir = resolveFlowDir(id);
      if (!dir) return sendError(res, 400, `非法的工作流 id: ${id}`);
      const flowFile = path.join(dir, 'flow.json');

      if (isBuild) {
        if (req.method !== 'POST') return sendError(res, 405, `不支持的方法: ${req.method}`);
        try {
          await stat(flowFile);
        } catch {
          return sendError(res, 404, `flow.json 不存在: ${id}`);
        }
        try {
          const compilerPath = path.join(ROOT, 'dist', 'core', 'flow-compiler.js');
          const { writeFlowFiles } = await import(pathToFileURL(compilerPath).href);
          const raw = await readFile(flowFile, 'utf-8');
          const flowData = JSON.parse(raw);
          writeFlowFiles(dir, flowData);
          return sendJson(res, 200, { ok: true, id, message: '编译成功，已生成 SKILL.md + reference/' });
        } catch (err) {
          return sendError(res, 500, `编译失败: ${err.message}`);
        }
      }

      if (req.method === 'GET') {
        try {
          return sendJson(res, 200, await readJson(flowFile));
        } catch (err) {
          if (err.code === 'ENOENT') return sendError(res, 404, `flow.json 不存在: ${id}`);
          throw err;
        }
      }
      if (req.method === 'PUT') {
        const raw = await readBody(req);
        let data;
        try {
          data = JSON.parse(raw);
        } catch {
          return sendError(res, 400, '请求体不是合法 JSON');
        }
        try {
          await stat(dir);
        } catch {
          await mkdir(dir, { recursive: true });
        }
        await writeFile(flowFile, JSON.stringify(data, null, 2) + '\n', 'utf8');
        return sendJson(res, 200, { ok: true, id });
      }
      return sendError(res, 405, `不支持的方法: ${req.method}`);
    }

    // ---- 静态文件 ----
    if (req.method === 'GET' || req.method === 'HEAD') {
      return await serveStatic(res, pathname);
    }
    sendError(res, 404, `未找到路由: ${req.method} ${pathname}`);
  } catch (err) {
    if (err instanceof HttpError) return sendError(res, err.statusCode, err.message);
    console.error('[flow-editor] 服务器错误:', err);
    if (!res.headersSent) sendError(res, 500, err.message ?? '服务器内部错误');
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ┌──────────────────────────────────────────────┐');
  console.log('  │  CLI-Anything-X 工作流编辑器                          │');
  console.log('  └──────────────────────────────────────────────┘');
  console.log(`  地址      http://localhost:${PORT}`);
  console.log(`  项目根    ${ROOT}`);
  console.log(`  技能目录  ${SKILLS_DIR}`);
  console.log('  按 Ctrl+C 停止服务');
  console.log('');
});
