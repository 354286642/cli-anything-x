#!/usr/bin/env node
/**
 * CLI-Anything-X 统一编辑器 - 本地服务
 * 门户首页 + Skill 编辑器 + Flow 编辑器
 *
 * 纯 Node.js 内置模块，零依赖。
 * 用法：node tools/editor/server.mjs [--port 3200]
 */
import http from 'node:http';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, unlinkSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execSync, spawn, spawnSync } from 'node:child_process';
import { createFlowEnhanceManager } from '../flow-editor/flow-enhance-server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const APIS_DIR = path.join(ROOT, 'apis');
const SKILLS_DIR = path.join(ROOT, 'skills');
const PUBLIC_DIR = path.join(__dirname, 'public');
// 完整版流程可视化编辑器（anycli flow edit 使用的版本）
const FLOW_EDITOR_DIR = path.join(ROOT, 'tools', 'flow-editor');

// ── 命令行参数 ──
function parsePort(argv) {
  const idx = argv.indexOf('--port');
  if (idx !== -1 && argv[idx + 1]) {
    const p = Number.parseInt(argv[idx + 1], 10);
    if (Number.isInteger(p) && p > 0 && p < 65536) return p;
  }
  return 3200;
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
  '.woff2': 'font/woff2',
};

// ── 工具函数 ──
function sendJson(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

function sendError(res, code, message) {
  sendJson(res, code, { success: false, error: message });
}

function stripAnsi(str) {
  return String(str).replace(/\u001b\[[0-9;]*m/g, '');
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

const flowEnhance = createFlowEnhanceManager({ root: ROOT, readBody, sendError, sendJson });

async function serveStatic(res, pathname) {
  // Route /skill/* to skill editor, /flow/* to flow editor
  if (pathname.startsWith('/skill/')) {
    const data = await readFile(path.join(PUBLIC_DIR, 'skill.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(data);
  }
  if (pathname === '/flow' || pathname.startsWith('/flow/')) {
    // 流程详情页：渲染完整版流程可视化编辑器（tools/flow-editor）
    const data = await readFile(path.join(FLOW_EDITOR_DIR, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(data);
  }
  // 完整版流程编辑器的静态资源（index.html 内 <base href="/flow-editor/">）
  if (pathname.startsWith('/flow-editor/')) {
    const rel = pathname.slice('/flow-editor/'.length);
    const filePath = path.normalize(path.join(FLOW_EDITOR_DIR, rel));
    if (!filePath.startsWith(FLOW_EDITOR_DIR)) return sendError(res, 403, 'Forbidden');
    try {
      const data = await readFile(filePath);
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      return res.end(data);
    } catch {
      return sendError(res, 404, `Not found: ${pathname}`);
    }
  }

  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  filePath = path.normalize(filePath);
  if (!filePath.startsWith(PUBLIC_DIR)) return sendError(res, 403, 'Forbidden');
  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    sendError(res, 404, `Not found: ${pathname}`);
  }
}

// ── 数据读取 ──
function listProjects() {
  if (!existsSync(APIS_DIR)) return [];
  return readdirSync(APIS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== '_shared')
    .map(d => d.name);
}

function listModules(project) {
  const dir = path.join(APIS_DIR, project);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.json') && f !== 'schema.json')
    .map(f => f.replace('.json', ''));
}

function loadRegistry(project, module) {
  const filePath = path.join(APIS_DIR, project, `${module}.json`);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

function loadSharedEnums(project) {
  const dir = path.join(APIS_DIR, project, '_shared');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const data = JSON.parse(readFileSync(path.join(dir, f), 'utf-8'));
      return { file: f.replace('.json', ''), ...data };
    });
}

function listFlows() {
  const flows = [];
  if (!existsSync(SKILLS_DIR)) return flows;
  for (const proj of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!proj.isDirectory()) continue;
    const flowsDir = path.join(SKILLS_DIR, proj.name, 'flows');
    if (!existsSync(flowsDir)) continue;
    for (const flow of readdirSync(flowsDir, { withFileTypes: true })) {
      if (!flow.isDirectory()) continue;
      const flowJsonPath = path.join(flowsDir, flow.name, 'flow.json');
      let meta = { name: flow.name, title: flow.name };
      if (existsSync(flowJsonPath)) {
        try {
          const data = JSON.parse(readFileSync(flowJsonPath, 'utf-8'));
          meta = { name: data.meta?.name || flow.name, title: data.title || flow.name, description: data.meta?.description || '', triggers: data.meta?.triggers || [] };
        } catch { /* ignore */ }
      }
      flows.push({ id: `${proj.name}/flows/${flow.name}`, project: proj.name, dir: flow.name, ...meta });
    }
  }
  return flows;
}

function getSkillMeta(project, module) {
  const skillFile = path.join(SKILLS_DIR, project, module, 'SKILL.md');
  if (!existsSync(skillFile)) return null;
  const raw = readFileSync(skillFile, 'utf-8');
  const nameMatch = raw.match(/^name:\s*(.+)\s*$/m);
  const verMatch = raw.match(/^version:\s*(.+)\s*$/m);
  const descMatch = raw.match(/description:\s*>?\s*\n?\s*(.+)/);
  return {
    name: nameMatch?.[1]?.trim() || `${project}-${module}`,
    version: verMatch?.[1]?.trim() || '',
    description: descMatch?.[1]?.trim() || '',
  };
}

// 去掉 CLI 参数里的 skills/ 前缀，兼容门户链接与 anycli flow edit 传参
function normalizeFlowId(id) {
  return id.replace(/^skills[\\/]/, '').split(/[\\/]/).filter(Boolean).join(path.sep);
}

function createWorkflowDir(project, business) {
  const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
  if (!project || !business) throw fail(400, '缺少 project 或 business 参数');
  const namePattern = /^[a-z0-9][a-z0-9-]*$/;
  if (!namePattern.test(project) || !namePattern.test(business)) {
    throw fail(400, 'project / business 仅允许小写字母、数字与连字符，且以字母或数字开头');
  }
  const dir = path.join(SKILLS_DIR, project, 'flows', business);
  const flowFile = path.join(dir, 'flow.json');
  if (existsSync(flowFile)) throw fail(409, `工作流已存在: ${project}/flows/${business}`);
  const skeleton = {
    meta: { name: `flow-${project}-${business}`, description: `业务流程：${business}`, type: 'flow', triggers: [] },
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
  mkdirSync(dir, { recursive: true });
  writeFileSync(flowFile, JSON.stringify(skeleton, null, 2) + '\n', 'utf-8');
  return { id: `${project}/flows/${business}`, path: `skills/${project}/flows/${business}/flow.json` };
}

// ── skill-enrich：本地 codex 分析 service 链路 ──
let enrichBusy = false;
let codexVersionCache = null;

const ENRICH_LOG_FILE = path.join(tmpdir(), 'anycli-enrich-server.log');
function enrichLog(msg) {
  try { appendFileSync(ENRICH_LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`); } catch { /* ignore */ }
}

// Windows 下 spawn 带 shell:true 时 child.kill() 只杀 cmd 外壳，必须 taskkill /T 杀整棵进程树
function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    try { execSync(`taskkill /pid ${pid} /T /F`, { timeout: 5000 }); return; } catch { /* fall through */ }
  }
  try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
}

function getCodexVersion() {
  if (codexVersionCache) return codexVersionCache;
  try {
    const r = spawnSync('codex', ['--version'], { shell: true, encoding: 'utf-8', timeout: 15000 });
    codexVersionCache = r.status === 0 ? String(r.stdout || '').trim().split('\n')[0] : 'codex';
  } catch {
    codexVersionCache = 'codex';
  }
  return codexVersionCache;
}

function loadGenConfig(project) {
  const cfgPath = path.join(APIS_DIR, project, 'gen.json');
  if (!existsSync(cfgPath)) return null;
  try {
    return JSON.parse(readFileSync(cfgPath, 'utf-8'));
  } catch {
    return null;
  }
}

// 从 codex JSONL 事件提取一行摘要，供页面进度展示
function codexEventBrief(evt) {
  if (!evt || typeof evt.type !== 'string') return null;
  const t = evt.type;
  if (t === 'agent_message' && typeof evt.message === 'string' && evt.message.trim()) {
    return `agent：${evt.message.trim().replace(/\s+/g, ' ').slice(0, 240)}`;
  }
  const item = evt.item && typeof evt.item === 'object' ? evt.item : null;
  if (item) {
    const detail = item.command || item.path || item.url || item.name || '';
    const kind = item.type ? `[${item.type}] ` : '';
    if (detail) return `${kind}${String(detail).replace(/\s+/g, ' ').slice(0, 200)}`;
    if (item.type) return `${kind}${t}`;
  }
  if (t === 'session.created') return '会话已建立';
  if (t === 'turn.completed') return '本轮推理完成';
  return null;
}

/** spawn codex 子进程：prompt 走 stdin，stdout JSONL 逐行转发，超时 kill。 */
function runCodex(args, prompt, apiId, sendEvent, onChild, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn('codex', args, { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
    onChild(child);
    let settled = false;
    const startedAt = Date.now();
    const heartbeat = setInterval(() => {
      if (settled) return;
      const secs = Math.round((Date.now() - startedAt) / 1000);
      sendEvent('progress', { apiId, type: 'heartbeat', message: `codex 分析中… 已用时 ${Math.floor(secs / 60)} 分 ${secs % 60} 秒` });
    }, 15000);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeat);
      killTree(child.pid);
      reject(new Error('codex 执行超时（10 分钟）'));
    }, timeoutMs);
    let buffer = '';
    let stderrTail = '';
    let lastMessage = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.type === 'agent_message' && typeof evt.message === 'string') lastMessage = evt.message;
          const brief = codexEventBrief(evt);
          if (brief) sendEvent('progress', { apiId, type: evt.type, brief });
        } catch { /* 非 JSON 行忽略 */ }
      }
    });
    child.stderr.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk.toString('utf-8')).slice(-2000);
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(heartbeat);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(heartbeat);
      if (code === 0) resolve({ lastMessage });
      else reject(new Error(`codex 退出码 ${code}${stderrTail ? '：' + stderrTail.trim().slice(-300) : ''}`));
    });
    child.stdin.on('error', () => { /* 进程提前结束时忽略 stdin 写入错误 */ });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function handleEnrich(req, res, project, module) {
  if (enrichBusy) return sendError(res, 409, '已有强化任务进行中，请等待完成');
  const registry = loadRegistry(project, module);
  if (!registry) return sendError(res, 404, `Registry not found: ${project}/${module}`);

  let body = {};
  try {
    body = JSON.parse((await readBody(req)) || '{}');
  } catch { /* 非法 body 按空处理 */ }

  const javaSourceRoot = loadGenConfig(project)?.javaSourceRoot;
  if (!javaSourceRoot) return sendError(res, 400, `apis/${project}/gen.json 缺少 javaSourceRoot，请先配置`);
  if (!existsSync(javaSourceRoot)) return sendError(res, 400, `javaSourceRoot 目录不存在：${javaSourceRoot}`);

  const allApis = registry.apis || [];
  const targets = body.batch ? allApis.filter((a) => !a.deprecated) : allApis.filter((a) => a.id === body.apiId);
  if (targets.length === 0) {
    return sendError(res, 400, body.batch ? '模块内没有可强化的接口' : `未找到接口：${body.apiId}`);
  }

  // codex 登录预检
  enrichLog(`enrich request ${project}/${module} targets=${targets.map((a) => a.id).join(',')}`);

  // SSE 头立即下发：页面马上建连收到阶段事件，消除登录预检/启动期的「卡死」观感
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  const sendEvent = (event, data) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  sendEvent('progress', { type: 'stage', message: `任务已受理：共 ${targets.length} 个接口，正在检查 codex 登录态…` });

  const login = spawnSync('codex', ['login', 'status'], { shell: true, encoding: 'utf-8', timeout: 20000 });
  if (login.status !== 0) {
    sendEvent('error', { message: 'codex 未登录，请先在终端执行 codex login' });
    res.end();
    return;
  }

  const enrich = await import(pathToFileURL(path.join(ROOT, 'dist', 'core', 'enrich.js')).href);

  enrichBusy = true;
  let aborted = false;
  let activeChild = null;
  req.on('close', () => {
    aborted = true;
    enrichLog('client disconnected, aborting');
    if (activeChild) killTree(activeChild.pid);
  });

  const schemaTmp = path.join(tmpdir(), `anycli-enrich-schema-${Date.now()}.json`);
  writeFileSync(schemaTmp, JSON.stringify(enrich.ENRICH_SCHEMA, null, 2), 'utf-8');
  const enrichedBy = getCodexVersion();
  const results = [];

  try {
    for (const api of targets) {
      if (aborted) break;
      const controllerAbs = enrich.findControllerFile(javaSourceRoot, api);
      if (!controllerAbs) {
        sendEvent('error', { apiId: api.id, message: `未定位到 Controller 文件（source.path=${api.source?.path || '无'}）` });
        continue;
      }
      const controllerRel = path.relative(javaSourceRoot, controllerAbs);
      const prompt = enrich.buildEnrichPrompt(api, registry, controllerAbs);
      enrichLog(`start ${api.id} controller=${controllerRel}`);
      sendEvent('progress', { apiId: api.id, type: 'stage', message: `已定位 Controller：${controllerRel}` });
      let enrichment = null;
      let lastError = '';
      for (let attempt = 1; attempt <= 2 && !enrichment && !aborted; attempt++) {
        const outTmp = path.join(tmpdir(), `anycli-enrich-out-${Date.now()}-${attempt}.txt`);
        let executed = false;
        try {
          const args = enrich.buildCodexArgs(javaSourceRoot, schemaTmp, outTmp);
          sendEvent('progress', { apiId: api.id, type: 'stage', message: `codex 已启动（只读沙箱，第 ${attempt} 次），开始分析 service 链路…` });
          const parsed = await runCodex(args, prompt, api.id, sendEvent, (c) => { activeChild = c; }, 10 * 60 * 1000);
          executed = true;
          const lastMessage = existsSync(outTmp) ? readFileSync(outTmp, 'utf-8') : (parsed.lastMessage || '');
          enrichLog(`codex done ${api.id} attempt=${attempt} outLen=${lastMessage.length} head=${lastMessage.slice(0, 120).replace(/\s+/g, ' ')}`);
          const result = enrich.parseEnrichOutput(lastMessage);
          if (result.ok) {
            enrichment = enrich.toEnrichment(result.data, { enrichedBy, controllerFile: controllerRel });
          } else {
            lastError = result.error;
            try { writeFileSync(path.join(tmpdir(), 'anycli-enrich-last-failed.txt'), lastMessage); } catch { /* ignore */ }
            enrichLog(`validate failed ${api.id} attempt=${attempt}: ${result.error}`);
            sendEvent('progress', { apiId: api.id, type: 'validate-failed', message: `第 ${attempt} 次输出校验失败：${result.error}` });
          }
        } catch (err) {
          lastError = err.message;
          enrichLog(`run failed ${api.id} attempt=${attempt}: ${err.message}`);
          sendEvent('progress', { apiId: api.id, type: 'run-failed', message: `第 ${attempt} 次执行失败：${err.message}` });
          if (!executed) break; // 执行失败/超时不重试（代价太高），仅输出校验失败重试一次
        } finally {
          try { if (existsSync(outTmp)) unlinkSync(outTmp); } catch { /* ignore */ }
        }
      }
      activeChild = null;
      if (enrichment) {
        enrich.mergeEnrichment(registry, api.id, enrichment);
        results.push(api.id);
        enrichLog(`merged ${api.id} confidence=${enrichment.confidence}`);
        sendEvent('done', { apiId: api.id, enrichment });
      } else if (!aborted) {
        sendEvent('error', { apiId: api.id, message: `强化失败：${lastError || '未知错误'}` });
      }
    }

    // 写回注册表 + 重建技能产物
    if (results.length > 0) {
      writeFileSync(path.join(APIS_DIR, project, `${module}.json`), JSON.stringify(registry, null, 2) + '\n', 'utf-8');
      try {
        execSync(`node dist/index.js skill build ${project} ${module}`, { cwd: ROOT, encoding: 'utf-8', timeout: 30000 });
        sendEvent('built', { rebuilt: `${project}/${module}` });
      } catch (err) {
        sendEvent('progress', { type: 'build-failed', message: `skill build 失败：${err.message}` });
      }
    }
    sendEvent(aborted ? 'aborted' : 'all-done', { total: targets.length, enriched: results.length });
  } finally {
    enrichBusy = false;
    try { if (existsSync(schemaTmp)) unlinkSync(schemaTmp); } catch { /* ignore */ }
    if (!res.writableEnded) res.end();
  }
}
// ── API 路由 ──
async function handleApi(req, res, url) {
  const pathname = url.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  // ── Portal data ──
  if (pathname === '/api/portal') {
    const projects = listProjects();
    const skills = [];
    for (const proj of projects) {
      for (const mod of listModules(proj)) {
        const reg = loadRegistry(proj, mod);
        if (!reg) continue;
        skills.push({
          project: proj,
          module: mod,
          name: reg.module,
          version: reg.version,
          description: reg.description || '',
          triggers: reg.triggers || [],
          apiCount: reg.apis?.length || 0,
          levels: {
            read: reg.apis?.filter(a => a.level === 'read').length || 0,
            write: reg.apis?.filter(a => a.level === 'write').length || 0,
            dangerous: reg.apis?.filter(a => a.level === 'dangerous').length || 0,
          },
        });
      }
    }
    const flows = listFlows();
    return sendJson(res, 200, { success: true, data: { projects, skills, flows } });
  }

  // ── Skills CRUD ──
  if (pathname === '/api/skills' && req.method === 'GET') {
    const projects = listProjects();
    const result = [];
    for (const proj of projects) {
      for (const mod of listModules(proj)) {
        const reg = loadRegistry(proj, mod);
        if (reg) result.push({ project: proj, module: mod, ...reg });
      }
    }
    return sendJson(res, 200, { success: true, data: result });
  }

  const skillMatch = pathname.match(/^\/api\/skills\/([^/]+)\/([^/]+)$/);
  if (skillMatch) {
    const [, project, module] = skillMatch;

    if (req.method === 'GET') {
      const reg = loadRegistry(project, module);
      if (!reg) return sendError(res, 404, `Registry not found: ${project}/${module}`);
      const enums = loadSharedEnums(project);
      return sendJson(res, 200, { success: true, data: { registry: reg, sharedEnums: enums } });
    }

    if (req.method === 'PUT') {
      try {
        const body = JSON.parse(await readBody(req));
        const dir = path.join(APIS_DIR, project);
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, `${module}.json`), JSON.stringify(body, null, 2), 'utf-8');
        return sendJson(res, 200, { success: true, message: `Saved ${project}/${module}` });
      } catch (err) {
        return sendError(res, 400, `Invalid JSON: ${err.message}`);
      }
    }
  }

  // ── Skill build / preview ──
  const buildMatch = pathname.match(/^\/api\/skills\/([^/]+)\/([^/]+)\/(build|preview)$/);
  if (buildMatch && req.method === 'POST') {
    const [, project, module, action] = buildMatch;
    try {
      if (action === 'preview') {
        const result = execSync(
          `node dist/index.js skill build ${project} ${module} --dry-run`,
          { cwd: ROOT, encoding: 'utf-8', timeout: 10000 }
        );
        const mdContent = result.replace(/^ℹ.*\n/, '');
        return sendJson(res, 200, { success: true, data: { markdown: mdContent } });
      }
      const result = execSync(
        `node dist/index.js skill build ${project} ${module}`,
        { cwd: ROOT, encoding: 'utf-8', timeout: 10000 }
      );
      return sendJson(res, 200, { success: true, data: { output: result } });
    } catch (err) {
      return sendError(res, 500, `Build failed: ${err.message}`);
    }
  }

  // ── Skill enrich：本地 codex 分析 service 链路（skill-enrich）──
  const enrichMatch = pathname.match(/^\/api\/skills\/([^/]+)\/([^/]+)\/enrich$/);
  if (enrichMatch && req.method === 'POST') {
    return handleEnrich(req, res, decodeURIComponent(enrichMatch[1]), decodeURIComponent(enrichMatch[2]));
  }

  // ── Skill export：普通可执行技能包 / 飞书 MCP 执行技能包 ──
  const exportMatch = pathname.match(/^\/api\/skills\/([^/]+)\/([^/]+)\/(export|feishu-export)$/);
  if (exportMatch && req.method === 'GET') {
    const project = decodeURIComponent(exportMatch[1]);
    const module = decodeURIComponent(exportMatch[2]);
    const exportMode = exportMatch[3] === 'feishu-export' ? 'feishu-mcp' : 'config';
    const registry = loadRegistry(project, module);
    if (!registry) return sendError(res, 404, `Registry not found: ${project}/${module}`);
    try {
      const { exportStandaloneZip } = await import(pathToFileURL(path.join(ROOT, 'dist', 'core', 'standalone-export.js')).href);
      const { loadPathVariables } = await import(pathToFileURL(path.join(ROOT, 'dist', 'core', 'path-vars.js')).href);
      const config = await import(pathToFileURL(path.join(ROOT, 'dist', 'core', 'config.js')).href);
      const projectConfig = config.getProjectConfig(project);
      if (!projectConfig) return sendError(res, 400, `项目 ${project} 未在本机配置，请先运行 anycli init`);
      const env = config.getEnv();
      const ctx = {
        baseUrl: projectConfig.baseUrl || config.getGatewayUrl(),
        envLabel: `${config.ENV_LABELS[env] || env} (${env})`,
        prefix: projectConfig.prefix || '',
        tenantId: projectConfig.tenantId,
        extTenantId: projectConfig.extTenantId,
        exportedAt: new Date().toISOString(),
      };
      const { zipName, zipBuffer } = exportStandaloneZip(
        registry,
        project,
        ctx,
        loadPathVariables(ROOT, project),
        { authMode: exportMode },
      );
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipName}"`,
        'Content-Length': zipBuffer.length,
        'Access-Control-Allow-Origin': '*',
      });
      return res.end(zipBuffer);
    } catch (err) {
      return sendError(res, 500, `导出失败: ${err.message}`);
    }
  }

  // ── 项目 gen.json 配置（skill-enrich：javaSourceRoot）──
  const genConfigMatch = pathname.match(/^\/api\/projects\/([^/]+)\/gen-config$/);
  if (genConfigMatch) {
    const project = decodeURIComponent(genConfigMatch[1]);
    const projectDir = path.join(APIS_DIR, project);
    if (!existsSync(projectDir)) return sendError(res, 404, `项目不存在：${project}`);
    if (req.method === 'GET') {
      return sendJson(res, 200, { success: true, data: loadGenConfig(project) || {} });
    }
    if (req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req));
        const root = String(body.javaSourceRoot || '').trim();
        if (!root) return sendError(res, 400, '缺少 javaSourceRoot');
        if (!existsSync(root)) return sendError(res, 400, `目录不存在：${root}`);
        const cfg = loadGenConfig(project) || {};
        cfg.javaSourceRoot = root;
        writeFileSync(path.join(projectDir, 'gen.json'), JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
        return sendJson(res, 200, { success: true, data: cfg });
      } catch (err) {
        return sendError(res, 400, `请求体不是合法 JSON: ${err.message}`);
      }
    }
    return sendError(res, 405, `不支持的方法: ${req.method}`);
  }
  // ── Flows ──
  if (pathname === '/api/flows' && req.method === 'GET') {
    return sendJson(res, 200, { success: true, data: listFlows() });
  }

  const flowMatch = pathname.match(/^\/api\/flows\/(.+?)(\/build)?$/);
  if (flowMatch) {
    const flowId = flowMatch[1];
    const isBuild = !!flowMatch[2];
    const flowDir = path.join(SKILLS_DIR, flowId);

    if (req.method === 'GET' && !isBuild) {
      const flowJsonPath = path.join(flowDir, 'flow.json');
      if (!existsSync(flowJsonPath)) return sendError(res, 404, `Flow not found: ${flowId}`);
      const data = JSON.parse(readFileSync(flowJsonPath, 'utf-8'));
      return sendJson(res, 200, { success: true, data });
    }

    if (req.method === 'PUT' && !isBuild) {
      try {
        const body = JSON.parse(await readBody(req));
        await writeFile(path.join(flowDir, 'flow.json'), JSON.stringify(body, null, 2), 'utf-8');
        return sendJson(res, 200, { success: true, message: `Saved ${flowId}` });
      } catch (err) {
        return sendError(res, 400, `Invalid JSON: ${err.message}`);
      }
    }

    if (req.method === 'POST' && isBuild) {
      try {
        const result = execSync(
          `node dist/index.js flow build skills/${flowId}`,
          { cwd: ROOT, encoding: 'utf-8', timeout: 15000 }
        );
        return sendJson(res, 200, { success: true, data: { output: result } });
      } catch (err) {
        return sendError(res, 500, `Build failed: ${err.message}`);
      }
    }
  }

  // ── Workflows（完整版流程编辑器 API） ──
  if (pathname === '/api/workflows') {
    if (req.method === 'GET') {
      const workflows = listFlows().map((f) => ({
        id: f.id,
        name: f.name,
        title: f.title,
        path: `skills/${f.id}/flow.json`,
      }));
      return sendJson(res, 200, { workflows });
    }
    if (req.method === 'POST') {
      try {
        const body = JSON.parse((await readBody(req)) || '{}');
        const created = createWorkflowDir(body.project, body.business);
        return sendJson(res, 201, created);
      } catch (err) {
        return sendError(res, err.statusCode || 400, err.message);
      }
    }
    return sendError(res, 405, `不支持的方法: ${req.method}`);
  }

  // ── Flow Enhance（完整版流程编辑器共用的实时 Agent 会话） ──
  const enhanceMatch = pathname.match(/^\/api\/workflows\/(.+?)\/enhance(?:\/([^/]+)(?:\/(answer|cancel))?)?$/);
  if (enhanceMatch) {
    const rawFlowId = decodeURIComponent(enhanceMatch[1]);
    const taskId = enhanceMatch[2];
    const action = enhanceMatch[3];
    if (/[\\/]\.\.([\\/]|$)/.test(rawFlowId) || path.isAbsolute(rawFlowId)) return sendError(res, 400, `非法的工作流 id: ${rawFlowId}`);
    const flowId = normalizeFlowId(rawFlowId);
    const flowDir = path.join(SKILLS_DIR, flowId);
    if (!taskId && req.method === 'POST') {
      const flowJsonPath = path.join(flowDir, 'flow.json');
      if (!existsSync(flowJsonPath)) return sendError(res, 404, `flow.json 不存在: ${flowId}`);
      let capture;
      try { capture = JSON.parse(readFileSync(path.join(flowDir, 'capture.json'), 'utf-8')); } catch { /* history fallback */ }
      return await flowEnhance.start(req, res, JSON.parse(readFileSync(flowJsonPath, 'utf-8')), capture);
    }
    if (taskId && action === 'answer' && req.method === 'POST') return await flowEnhance.answer(req, res, taskId);
    if (taskId && action === 'cancel' && req.method === 'POST') return flowEnhance.cancel(req, res, taskId);
    if (taskId && req.method === 'GET') return flowEnhance.status(req, res, taskId);
    return sendError(res, 405, `不支持的方法: ${req.method}`);
  }

  const workflowMatch = pathname.match(/^\/api\/workflows\/(.+?)(\/build)?$/);
  if (workflowMatch) {
    const rawId = decodeURIComponent(workflowMatch[1]);
    const isBuild = Boolean(workflowMatch[2]);
    if (/[\\/]\.\.([\\/]|$)/.test(rawId) || path.isAbsolute(rawId)) {
      return sendError(res, 400, `非法的工作流 id: ${rawId}`);
    }
    const flowId = normalizeFlowId(rawId);
    const flowDir = path.join(SKILLS_DIR, flowId);
    const flowJsonPath = path.join(flowDir, 'flow.json');

    if (isBuild && req.method === 'POST') {
      try {
        // 进程内复用 CLI 的编译实现（含接地校验、版本记录、路由表更新），无需 spawn 子进程
        const { buildSingleFlow } = await import(pathToFileURL(path.join(ROOT, 'dist', 'commands', 'flow.js')).href);
        const result = buildSingleFlow(flowDir, flowId.split(path.sep).join('/'));
        if (!result.ok) return sendError(res, 500, result.message);
        try {
          const { generateSkillDocs } = await import(pathToFileURL(path.join(ROOT, 'dist', 'core', 'skill-docs.js')).href);
          generateSkillDocs({ quiet: true });
        } catch { /* 技能总览更新失败不阻塞编译结果 */ }
        return sendJson(res, 200, { ok: true, id: flowId.split(path.sep).join('/'), message: result.message });
      } catch (err) {
        return sendError(res, 500, `编译失败: ${err.message}`);
      }
    }

    if (req.method === 'GET') {
      if (!existsSync(flowJsonPath)) return sendError(res, 404, `flow.json 不存在: ${flowId}`);
      return sendJson(res, 200, JSON.parse(readFileSync(flowJsonPath, 'utf-8')));
    }

    if (req.method === 'PUT') {
      try {
        const body = JSON.parse(await readBody(req));
        await mkdir(flowDir, { recursive: true });
        await writeFile(flowJsonPath, JSON.stringify(body, null, 2) + '\n', 'utf-8');
        return sendJson(res, 200, { ok: true, id: flowId.split(path.sep).join('/') });
      } catch (err) {
        return sendError(res, 400, `请求体不是合法 JSON: ${err.message}`);
      }
    }
    return sendError(res, 405, `不支持的方法: ${req.method}`);
  }

  // ── Enums ──
  const enumMatch = pathname.match(/^\/api\/enums\/([^/]+)$/);
  if (enumMatch && req.method === 'GET') {
    return sendJson(res, 200, { success: true, data: loadSharedEnums(enumMatch[1]) });
  }

  // ── API Test (proxy to anycli request) ──
  if (pathname === '/api/test' && req.method === 'POST') {
    try {
      const { project, method, path, body, query } = JSON.parse(await readBody(req));
      const args = ['dist/index.js', 'request', project, method, path, '--format', 'json', '--yes', '--non-interactive'];
      if (body) args.push('--body', JSON.stringify(body));
      if (query) args.push('--query', JSON.stringify(query));
      const result = execSync(`node ${args.map(a => `'${a}'`).join(' ')}`, {
        cwd: ROOT, encoding: 'utf-8', timeout: 30000,
      });
      return sendJson(res, 200, { success: true, data: JSON.parse(result) });
    } catch (err) {
      const stderr = err.stderr || err.stdout || err.message;
      try {
        return sendJson(res, 200, { success: false, data: JSON.parse(stderr) });
      } catch {
        return sendJson(res, 200, { success: false, error: stderr.slice(0, 500) });
      }
    }
  }

  sendError(res, 404, `Unknown API route: ${req.method} ${pathname}`);
}

// ── HTTP Server ──
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    if (url.pathname.startsWith('/api/')) {
      return await handleApi(req, res, url);
    }
    return await serveStatic(res, url.pathname);
  } catch (err) {
    console.error(`[editor] Error: ${err.message}`);
    sendError(res, 500, err.message);
  }
});

server.listen(PORT, () => {
  console.log(`\n  🔧 CLI-Anything-X Editor`);
  console.log(`  ─────────────────────────────────`);
  console.log(`  Portal:       http://localhost:${PORT}/`);
  console.log(`  Skill Editor: http://localhost:${PORT}/skill/{project}/{module}`);
  console.log(`  Flow Editor:  http://localhost:${PORT}/flow/{project}/{flowName}`);
  console.log(`  ─────────────────────────────────`);
  console.log(`  Root: ${ROOT}\n`);
});
