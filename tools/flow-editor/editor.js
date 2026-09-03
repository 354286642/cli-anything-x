/* ═══════════════════════════════════════════════════════════
   CLI-Anything-X 工作流编辑器 — 交互逻辑（原生 JS，无框架）
   依赖：vendor/sortable.min.js（Sortable）、vendor/marked.min.js（marked）
   ═══════════════════════════════════════════════════════════ */
'use strict';

/* global Sortable, marked */

// ─────────────────────────── 全局状态 ───────────────────────────
let flowData = null;          // 当前编辑的 flow.json 对象
let undoStack = [];           // undo 栈（深拷贝快照，最多 50 个）
let redoStack = [];           // redo 栈
let currentWorkflowId = null; // 当前工作流 id（相对 skills/ 的路径）
let dirty = false;            // 是否有未保存更改
let currentView = 'meta';     // 当前导航视图
let activeFieldGroup = 0;     // 当前选中的字段分组下标
let expandedSteps = new Set(); // 处于展开状态的步骤 id
let sortables = [];           // 已创建的 Sortable 实例（重渲染前统一销毁）
let skillCatalog = [];        // /api/skill-catalog 返回的项目/模块/API 目录
let composeSelection = [];    // 选中的 API key，顺序即流程执行顺序
let enhanceTaskId = null;
let enhanceProposal = null;
let enhanceLog = [];

const UNDO_LIMIT = 50;
const FIELD_TYPES = ['string', 'number', 'boolean', 'enum', 'array', 'object', 'date'];
const API_METHODS = ['POST', 'GET', 'PUT', 'DELETE'];

// ─────────────────────────── 通用工具 ───────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** DOM 构建助手：el('div', {class:'x'}, '文本', childNode) */
function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (key === 'class') node.className = value;
    else if (key === 'value') node.value = value;
    else if (key === 'checked') node.checked = Boolean(value);
    else node.setAttribute(key, value);
  }
  children.flat(Infinity).forEach((child) => {
    if (child == null || child === false) return;
    node.append(child);
  });
  return node;
}

function renderMarkdown(md) {
  if (!window.marked) return escapeHtml(md || '');
  try {
    return marked.parse(md || '');
  } catch {
    return escapeHtml(md || '');
  }
}

// ─────────────────────────── Toast 提示 ───────────────────────────
let toastTimer = null;
function toast(message, type) {
  const node = $('#toast');
  node.textContent = message;
  node.className = 'toast' + (type === 'error' ? ' toast-error' : type === 'success' ? ' toast-success' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.add('hidden'), 3200);
}

// ─────────────────────────── 保存状态 ───────────────────────────
function markDirty() {
  if (!dirty) {
    dirty = true;
    const status = $('#save-status');
    status.textContent = '● 未保存';
    status.className = 'status status-dirty';
    $('#btn-save').disabled = false;
  }
  schedulePreview();
}

function markSaved() {
  dirty = false;
  const status = $('#save-status');
  status.textContent = '● 已保存';
  status.className = 'status status-saved';
  $('#btn-save').disabled = true;
}

// ─────────────────────────── Undo / Redo ───────────────────────────
function pushSnapshot() {
  if (!flowData) return;
  const snapshot = deepClone(flowData);
  const last = undoStack[undoStack.length - 1];
  if (last && JSON.stringify(last) === JSON.stringify(snapshot)) return; // 无变化不重复入栈
  undoStack.push(snapshot);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack = [];
  updateUndoButtons();
}

function undo() {
  if (!undoStack.length || !flowData) return;
  redoStack.push(deepClone(flowData));
  flowData = undoStack.pop();
  updateUndoButtons();
  markDirty();
  renderCurrentView();
}

function redo() {
  if (!redoStack.length || !flowData) return;
  undoStack.push(deepClone(flowData));
  flowData = redoStack.pop();
  updateUndoButtons();
  markDirty();
  renderCurrentView();
}

function updateUndoButtons() {
  $('#btn-undo').disabled = undoStack.length === 0;
  $('#btn-redo').disabled = redoStack.length === 0;
}

// ─────────────────────────── API 封装 ───────────────────────────
async function api(path, options) {
  const res = await fetch(path, options || {});
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data;
}

async function loadWorkflowList() {
  try {
    const res = await api('/api/workflows');
    const select = $('#workflow-select');
    select.innerHTML = '';
    select.append(el('option', { value: '' }, '—— 选择工作流 ——'));
    (res.workflows || []).forEach((w) => {
      select.append(el('option', { value: w.id }, `${w.title || w.name}（${w.id}）`));
    });
    if (currentWorkflowId) select.value = currentWorkflowId;
  } catch (err) {
    toast('加载工作流列表失败: ' + err.message, 'error');
  }
}

async function loadWorkflow(id) {
  if (!id) return;
  if (dirty && !confirm('当前有未保存的更改，确定放弃并切换工作流吗？')) {
    $('#workflow-select').value = currentWorkflowId || '';
    return;
  }
  try {
    const data = await api(`/api/workflows/${id}`);
    flowData = normalizeFlow(data);
    currentWorkflowId = id;
    undoStack = [];
    redoStack = [];
    updateUndoButtons();
    expandedSteps.clear();
    composeSelection = [];
    activeFieldGroup = 0;
    markSaved();
    $('#btn-build').disabled = false;
    $('#btn-open-enhance').disabled = flowData.apis.length === 0;
    $('#empty-state').classList.remove('active');
    $('#sidebar-footer').textContent = id;
    switchView('meta');
    updatePreview();
    // 同步 URL 深链：刷新页面保持当前流程，链接可直接分享
    try {
      const encoded = id.split('/').map(encodeURIComponent).join('/');
      history.replaceState(null, '', '/flow/' + encoded);
    } catch {
      /* 忽略不支持 history API 的环境 */
    }
  } catch (err) {
    toast('加载失败: ' + err.message, 'error');
  }
}


function toFlowJsonFormat(data) {
  const d = deepClone(data);
  d.meta.sourceRefs = d.sourceRefs || {};
  delete d.sourceRefs;
  d.steps = nestedToFlatSteps(d.steps || []);
  if (typeof d.submitCommand === 'string') {
    const scStr = d.submitCommand;
    const methodMatch = scStr.match(/(GET|POST|PUT|DELETE)/);
    const pathMatch = scStr.match(/(?:GET|POST|PUT|DELETE)\s+(\S+)/);
    const bodyMatch = scStr.match(/--body\s+'([\s\S]*)'/);
    d.submitCommand = {
      method: methodMatch ? methodMatch[1] : 'POST',
      path: pathMatch ? pathMatch[1] : '',
      bodyTemplate: bodyMatch ? bodyMatch[1] : scStr,
    };
  }
  // 新 Flow 使用 endApi；submitCommand 仅作为读取旧文件的兼容字段。
  if (d.endApi) delete d.submitCommand;
  return d;
}

async function saveWorkflow() {
  if (!currentWorkflowId || !flowData) return;
  const status = $('#save-status');
  status.textContent = '● 保存中…';
  status.className = 'status status-saving';
  try {
    await api(`/api/workflows/${currentWorkflowId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toFlowJsonFormat(flowData), null, 2),
    });
    markSaved();
    toast('已保存到 ' + currentWorkflowId + '/flow.json', 'success');
    loadWorkflowList(); // 标题可能变化，静默刷新列表
  } catch (err) {
    status.textContent = '● 未保存';
    status.className = 'status status-dirty';
    toast('保存失败: ' + err.message, 'error');
  }
}

async function buildWorkflow() {
  if (!currentWorkflowId) return;
  try {
    const res = await api(`/api/workflows/${currentWorkflowId}/build`, { method: 'POST' });
    toast(res.message || '编译请求已发送', 'success');
  } catch (err) {
    toast('编译失败: ' + err.message, 'error');
  }
}

// ─────────────────────────── 数据规范化 ───────────────────────────
function normalizeStep(step) {
  const s = Object.assign(
    { id: '', title: '', condition: '', dependsOn: [], fields: [], apis: [], content: '', children: [] },
    step || {}
  );
  if (step && step.fieldRefs && !step.fields) s.fields = step.fieldRefs;
  if (step && (!step.apis || !step.apis.length)) {
    if (Array.isArray(step.apiRefs) && step.apiRefs.length) s.apis = step.apiRefs.filter(Boolean);
    else if (step.apiRef) s.apis = [step.apiRef];
    else s.apis = [];
  }
  if (step && step.conditional && !step.condition) s.condition = step.condition || 'conditional';
  ['dependsOn', 'fields', 'apis', 'children'].forEach((k) => {
    if (!Array.isArray(s[k])) s[k] = [];
  });
  s.children = s.children.map(normalizeStep);
  return s;
}

function flatToNestedSteps(flatSteps) {
  if (!flatSteps.length) return [];
  const hasHierarchy = flatSteps.some((s) => s.level != null || s.parentId != null);
  if (!hasHierarchy) return flatSteps;
  const byId = new Map();
  flatSteps.forEach((s) => byId.set(s.id, s));
  const topLevel = [];
  flatSteps.forEach((s) => {
    if (s.parentId && byId.has(s.parentId)) {
      const parent = byId.get(s.parentId);
      if (!parent.children) parent.children = [];
      parent.children.push(s);
    } else {
      topLevel.push(s);
    }
  });
  return topLevel;
}

function nestedToFlatSteps(nestedSteps) {
  const flat = [];
  const walk = (steps, parentId, level) => {
    steps.forEach((s) => {
      const children = s.children || [];
      const rest = Object.assign({}, s);
      delete rest.children;
      rest.level = level;
      rest.parentId = parentId;
      rest.fieldRefs = rest.fields || [];
      rest.apiRefs = rest.apis || [];
      rest.conditional = Boolean(rest.condition);
      delete rest.fields;
      delete rest.apis;
      flat.push(rest);
      if (children.length) walk(children, s.id, level + 1);
    });
  };
  walk(nestedSteps, null, 0);
  return flat;
}

/** 补全缺失结构，保证各视图可安全访问 */
function normalizeFlow(data) {
  const d = deepClone(data || {});
  d.meta = Object.assign({ name: '', description: '', type: 'flow', triggers: [] }, d.meta);
  if (!Array.isArray(d.meta.triggers)) d.meta.triggers = [];
  d.title = d.title || '';
  d.sourceRefs = Object.assign({ controller: '', dto: '', frontend: '' }, d.meta.sourceRefs || d.sourceRefs);
  d.businessGoal = d.businessGoal || '';
  ['scenarios', 'prerequisites', 'successCriteria', 'domainKnowledge'].forEach((k) => {
    if (!Array.isArray(d[k])) d[k] = [];
  });
  d.steps = Array.isArray(d.steps) ? flatToNestedSteps(d.steps).map(normalizeStep) : [];
  d.fieldGroups = Array.isArray(d.fieldGroups) ? d.fieldGroups : [];
  d.fieldGroups.forEach((g) => {
    if (!Array.isArray(g.fields)) g.fields = [];
  });
  d.apis = Array.isArray(d.apis) ? d.apis : [];
  d.speechTemplates = Array.isArray(d.speechTemplates) ? d.speechTemplates : [];
  d.agentStrategy = Object.assign({ prefillRules: [], mustAsk: [], forbidden: [] }, d.agentStrategy);
  ['prefillRules', 'mustAsk', 'forbidden'].forEach((k) => {
    if (!Array.isArray(d.agentStrategy[k])) d.agentStrategy[k] = [];
  });
  const endForEditor = d.endApi || d.submitCommand;
  if (typeof endForEditor === 'object' && endForEditor !== null) {
    const sc = endForEditor;
    d.submitCommand = [
      'anycli request <project> ' + (sc.method || 'POST') + ' ' + (sc.path || ''),
      "--body '" + (sc.bodyTemplate || '{}') + "'"
    ].join(' ');
  } else {
    d.submitCommand = d.submitCommand || '';
  }
  d.errorHandling = Array.isArray(d.errorHandling) ? d.errorHandling : [];
  d.reference = Object.assign({ fields: '', examples: '', verify: '' }, d.reference);

  // 为缺失 id 的步骤补 id
  const used = new Set();
  const collect = (steps) => steps.forEach((s) => {
    if (s.id) used.add(s.id);
    collect(s.children);
  });
  collect(d.steps);
  let counter = 0;
  const fill = (steps) => steps.forEach((s) => {
    if (!s.id) {
      do { counter += 1; } while (used.has(`step-${counter}`));
      s.id = `step-${counter}`;
      used.add(s.id);
    }
    fill(s.children);
  });
  fill(d.steps);

  // 清洗依赖：纯数字 n -> step-n；去重；过滤自身与未知 id
  const cleanDep = (steps, known) => steps.forEach((st) => {
    const seen = new Set(); const out = [];
    (st.dependsOn || []).forEach((raw) => {
      let dep = String(raw == null ? '' : raw).trim();
      if (!dep) return;
      if (/^\d+$/.test(dep)) dep = 'step-' + dep;
      if (dep === st.id || seen.has(dep)) return;
      if (!known.has(dep)) return;
      seen.add(dep); out.push(dep);
    });
    st.dependsOn = out;
    cleanDep(st.children, known);
  });
  cleanDep(d.steps, used);
  return d;
}

function getStringArray(key) {
  if (key === 'mustAsk' || key === 'forbidden') return flowData.agentStrategy[key];
  return flowData[key];
}

function nextStepId(extraIds) {
  let max = 0;
  const consider = (id) => {
    const m = /^step-(\d+)$/.exec(id || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  };
  const walk = (steps) => steps.forEach((s) => {
    consider(s.id);
    walk(s.children || []);
  });
  if (flowData) walk(flowData.steps);
  (extraIds || []).forEach(consider);
  return `step-${max + 1}`;
}

function assignNewIds(step, extraIds) {
  step.id = nextStepId(extraIds);
  extraIds.push(step.id);
  (step.children || []).forEach((c) => assignNewIds(c, extraIds));
}

function nextApiId() {
  let max = 0;
  flowData.apis.forEach((a) => {
    const m = /^api-(\d+)$/.exec(a.id || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return `api-${max + 1}`;
}

function findStepParent(id) {
  for (let i = 0; i < flowData.steps.length; i += 1) {
    if (flowData.steps[i].id === id) return { arr: flowData.steps, index: i };
    const children = flowData.steps[i].children || [];
    for (let j = 0; j < children.length; j += 1) {
      if (children[j].id === id) return { arr: children, index: j };
    }
  }
  return null;
}

function newStep() {
  return { id: nextStepId(), title: '', condition: '', dependsOn: [], fields: [], apis: [], content: '', children: [] };
}

// ─────────────────────────── 导航切换 ───────────────────────────
function switchView(view) {
  currentView = view;
  $$('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.view === view));
  $$('#editor > .view').forEach((v) => v.classList.remove('active'));
  const target = $(`#view-${view}`);
  if (target) target.classList.add('active');
  renderCurrentView();
}

function renderCurrentView() {
  if (!flowData) return;
  switch (currentView) {
    case 'meta': renderMeta(); break;
    case 'prerequisites': renderStringList('prerequisites'); break;
    case 'success': renderStringList('successCriteria'); break;
    case 'steps': renderSteps(); break;
    case 'fields': renderFields(); break;
    case 'apis': renderApis(); break;
    case 'speech': renderSpeech(); break;
    case 'strategy':
      renderPrefill();
      renderStringList('mustAsk');
      renderStringList('forbidden');
      break;
    case 'errors': renderErrors(); break;
    case 'knowledge': renderStringList('domainKnowledge'); break;
    case 'reference': renderReference(); break;
    default: break;
  }
}

// ─────────────────────────── Flow Enhance：结束接口反推 ───────────────────────────
function appendEnhanceLog(message) {
  if (!message) return;
  enhanceLog.push(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${message}`);
  if (enhanceLog.length > 200) enhanceLog.shift();
  const box = $('#enhance-log');
  if (box) { box.textContent = enhanceLog.join('\n'); box.scrollTop = box.scrollHeight; }
}

function selectedEndCandidate() {
  const select = $('#enhance-end-api');
  const index = Number(select?.value);
  const apiDef = flowData?.apis?.[index];
  if (!apiDef) return null;
  const current = flowData.endApi;
  const sameCurrent = current && (current.apiRef === apiDef.id || (current.method === apiDef.method && current.path === apiDef.path));
  return { apiRef: apiDef.id, method: apiDef.method || 'POST', path: apiDef.path || '', bodyTemplate: sameCurrent ? (current.bodyTemplate || '{}') : '{}', evidenceSource: apiDef.evidence?.source || (sameCurrent ? current.evidenceSource : 'name-only') };
}

function openEnhance() {
  if (!flowData?.apis?.length) { toast('请先导入或录制至少一个接口', 'error'); return; }
  const select = $('#enhance-end-api');
  select.innerHTML = '';
  let selectedIndex = flowData.apis.length - 1;
  flowData.apis.forEach((apiDef, index) => {
    if (flowData.endApi && (flowData.endApi.apiRef === apiDef.id || (flowData.endApi.method === apiDef.method && flowData.endApi.path === apiDef.path))) selectedIndex = index;
    select.append(el('option', { value: String(index) }, `${apiDef.purpose || apiDef.id}（${apiDef.method} ${apiDef.path}）`));
  });
  select.value = String(selectedIndex);
  $('#enhance-proposal').classList.toggle('hidden', !enhanceProposal);
  $('#btn-enhance-cancel').classList.toggle('hidden', !enhanceTaskId);
  $('#modal-enhance').classList.remove('hidden');
}

async function consumeEnhanceSse(stream) {
  const reader = stream.getReader(); const decoder = new TextDecoder(); let buffer = '';
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buffer += decoder.decode(value, { stream: true }); let sep;
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, sep); buffer = buffer.slice(sep + 2);
      let type = 'message'; const lines = [];
      frame.split('\n').forEach((line) => { if (line.startsWith('event:')) type = line.slice(6).trim(); else if (line.startsWith('data:')) lines.push(line.slice(5).trim()); });
      if (!lines.length) continue;
      let data; try { data = JSON.parse(lines.join('\n')); } catch { continue; }
      if (type === 'stage' || type === 'progress' || type === 'heartbeat') { appendEnhanceLog(data.message); $('#enhance-status').textContent = data.message || ''; }
      if (type === 'question') { enhanceTaskId = data.id; appendEnhanceLog('Agent 需要业务确认，等待回答。'); renderEnhanceQuestion(data.questions || []); $('#btn-enhance-cancel').classList.remove('hidden'); }
      if (type === 'proposal') { enhanceTaskId = data.id; enhanceProposal = data.proposal; appendEnhanceLog('已生成流程提案，请核对后应用。'); renderEnhanceProposal(); $('#btn-enhance-cancel').classList.remove('hidden'); }
      if (type === 'error') {
        appendEnhanceLog('失败：' + data.message);
        $('#enhance-status').textContent = '分析失败：' + (data.message || '请重试');
        enhanceTaskId = null;
        $('#btn-enhance-cancel').classList.add('hidden');
        toast(data.message || '完善流程失败', 'error');
      }
      if (type === 'cancelled') { appendEnhanceLog('会话已取消'); enhanceTaskId = null; }
    }
  }
}

function renderEnhanceQuestion(questions) {
  const wrap = $('#enhance-question'); wrap.innerHTML = ''; wrap.classList.remove('hidden');
  questions.forEach((q) => {
    const box = el('div', { class: 'speech-card' }); box.append(el('b', {}, q.title || '需要确认'), el('p', { class: 'view-desc' }, q.question || ''));
    if (q.options?.length) {
      const select = el('select', { class: 'enhance-answer', 'data-question-id': q.id });
      select.append(el('option', { value: '' }, '请选择'));
      q.options.forEach((option) => select.append(el('option', { value: option }, option)));
      if (q.recommended) select.value = q.recommended;
      box.append(select);
    }
    const input = el('textarea', { class: 'mono-area enhance-extra', rows: '2', 'data-question-id': q.id, placeholder: '可补充具体业务说明（选填）' });
    box.append(input); wrap.append(box);
  });
  const continueBtn = el('button', { class: 'btn btn-primary' }, '提交回答并继续分析');
  continueBtn.addEventListener('click', async () => {
    const answers = {};
    $$('.enhance-answer').forEach((item) => { answers[item.dataset.questionId] = item.value; });
    $$('.enhance-extra').forEach((item) => { if (item.value.trim()) answers[`${item.dataset.questionId}_detail`] = item.value.trim(); });
    try {
      const resp = await fetch(`/api/workflows/${encodeURIComponent(currentWorkflowId)}/enhance/${encodeURIComponent(enhanceTaskId)}/answer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers }) });
      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);
      wrap.classList.add('hidden'); appendEnhanceLog('已提交回答，继续分析…'); await consumeEnhanceSse(resp.body);
    } catch (err) { toast('继续分析失败：' + err.message, 'error'); }
  });
  wrap.append(continueBtn);
}

function renderEnhanceProposal() {
  const wrap = $('#enhance-proposal'); const content = $('#enhance-proposal-content');
  if (!enhanceProposal) return;
  const flow = enhanceProposal.flow || {};
  const sourceRefs = flow.meta?.sourceRefs || {};
  const traces = (enhanceProposal.fieldTraces || []).map((item) => `${item.field}：${item.source} — ${item.detail}`).join('\n');
  const sourceLines = [
    sourceRefs.controller ? `Controller：${sourceRefs.controller}` : '',
    sourceRefs.dto ? `结束接口溯源：${sourceRefs.dto}` : '',
    sourceRefs.frontend ? `前端：${sourceRefs.frontend}` : '',
  ].filter(Boolean);
  const speechLines = (flow.speechTemplates || []).flatMap((item) => [
    `【${item.name || '基础话术'}】`, item.template || '', item.note ? `说明：${item.note}` : '', '',
  ]).filter(Boolean);
  content.textContent = [
    `流程结束接口：${flow.endApi?.method || ''} ${flow.endApi?.path || ''}`,
    `来源证据：${flow.endApi?.evidenceSource || '待确认'}`,
    '', '基本信息溯源：', ...(sourceLines.length ? sourceLines : ['（暂无可确认溯源）']),
    '', '字段来源链：', traces || '（暂无可追溯字段）',
    '', '基础话术模板：', ...(speechLines.length ? speechLines : ['（暂无话术模板）']),
    '', '待确认项：', ...(enhanceProposal.pendingConfirmations || []),
    '', '警告：', ...(enhanceProposal.warnings || []),
  ].join('\n');
  wrap.classList.remove('hidden');
}

async function startEnhance() {
  const endApi = selectedEndCandidate(); if (!endApi) return;
  const businessGoalContext = $('#enhance-business-goal')?.value.trim() || '';
  enhanceLog = []; enhanceProposal = null; $('#enhance-log').textContent = ''; $('#enhance-proposal').classList.add('hidden'); $('#enhance-question').classList.add('hidden');
  try {
    const resp = await fetch(`/api/workflows/${encodeURIComponent(currentWorkflowId)}/enhance`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ flow: flowData, endApi, businessGoalContext }) });
    if (!resp.ok || !resp.body) { const err = await resp.json().catch(() => ({})); throw new Error(err.error || `HTTP ${resp.status}`); }
    $('#enhance-status').textContent = '本地 Agent 已启动…'; await consumeEnhanceSse(resp.body);
  } catch (err) { toast('完善流程启动失败：' + err.message, 'error'); }
}

async function cancelEnhance() {
  if (!enhanceTaskId) return;
  try { await api(`/api/workflows/${encodeURIComponent(currentWorkflowId)}/enhance/${encodeURIComponent(enhanceTaskId)}/cancel`, { method: 'POST' }); appendEnhanceLog('已取消会话'); enhanceTaskId = null; $('#btn-enhance-cancel').classList.add('hidden'); } catch (err) { toast('取消失败：' + err.message, 'error'); }
}

function applyEnhanceProposal() {
  if (!enhanceProposal?.flow) return;
  pushSnapshot(); flowData = normalizeFlow(enhanceProposal.flow); markDirty(); renderCurrentView(); toast('流程提案已应用，请检查并点击保存', 'success'); $('#modal-enhance').classList.add('hidden');
}

// ─────────────────────────── 视图：接口编排 ───────────────────────────
function apiKey(project, module, id) {
  return `${project}/${module}/${id}`;
}

function catalogEntries() {
  const entries = [];
  (skillCatalog || []).forEach((project) => (project.modules || []).forEach((module) => (module.apis || []).forEach((apiDef) => {
    entries.push({ key: apiKey(project.project, module.module, apiDef.id), project: project.project, module, api: apiDef });
  })));
  return entries;
}

function selectedEntries() {
  const byKey = new Map(catalogEntries().map((entry) => [entry.key, entry]));
  return composeSelection.map((key) => byKey.get(key)).filter(Boolean);
}

async function loadSkillCatalog() {
  try {
    const res = await api('/api/skill-catalog');
    skillCatalog = res.projects || [];
  } catch (err) {
    // 统一编辑器（anycli edit）已有 /api/skills，但未必挂载 flow-editor 专属端点。
    try {
      const fallback = await api('/api/skills');
      const grouped = new Map();
      (fallback.data || []).forEach((registry) => {
        const project = grouped.get(registry.project) || { project: registry.project, modules: [] };
        const moduleName = String(registry.module || '').replace(new RegExp(`^${registry.project}-`), '') || registry.module;
        project.modules.push({
          module: moduleName,
          skill: registry.module,
          description: registry.description || '',
          triggers: registry.triggers || [],
          principles: registry.principles || [],
          prerequisites: registry.prerequisites || [],
          errorHandling: registry.errorHandling || [],
          chains: registry.chains || [],
          apis: (registry.apis || []).map((apiDef) => ({
            ...apiDef,
            id: apiDef.id,
            summary: apiDef.summary || apiDef.id,
            method: apiDef.method,
            path: apiDef.path,
            level: apiDef.level || 'read',
            bodyTemplate: apiDef.bodyTemplate ?? '{}',
            outputFields: apiDef.outputFields || '',
          })),
        });
        grouped.set(registry.project, project);
      });
      skillCatalog = Array.from(grouped.values());
    } catch (fallbackErr) {
      skillCatalog = [];
      const container = $('#skill-catalog');
      if (container) container.innerHTML = `<p class="empty-tip">接口目录加载失败：${escapeHtml(fallbackErr.message)}</p>`;
      return;
    }
  }
  renderCompose();
}

function renderCompose() {
  const catalog = $('#skill-catalog');
  const selected = $('#compose-selected');
  const generate = $('#btn-compose-generate');
  if (!catalog || !selected || !generate || !flowData) return;

  catalog.innerHTML = '';
  let visible = 0;
  (skillCatalog || []).forEach((project) => {
    const projectBox = el('div', { class: 'catalog-project' });
    projectBox.append(el('h4', { class: 'catalog-project-title' }, project.project));
    (project.modules || []).forEach((module) => {
      const matching = module.apis || [];
      if (!matching.length) return;
      const moduleBox = el('div', { class: 'catalog-module' });
      moduleBox.append(el('div', { class: 'catalog-module-title' }, `${module.skill || module.module}（${module.module}）`));
      matching.forEach((apiDef) => {
        visible += 1;
        const key = apiKey(project.project, module.module, apiDef.id);
        const cb = el('input', { type: 'checkbox' });
        cb.checked = composeSelection.includes(key);
        cb.addEventListener('change', () => {
          if (cb.checked) {
            if (!composeSelection.includes(key)) composeSelection.push(key);
          } else {
            composeSelection = composeSelection.filter((item) => item !== key);
          }
          renderCompose();
        });
        const detail = el('span', { class: 'catalog-api-detail' },
          el('strong', {}, apiDef.summary || apiDef.id),
          el('small', {}, `${apiDef.method} ${apiDef.path} · ${apiDef.id}`));
        const row = el('label', { class: 'catalog-api' + (cb.checked ? ' selected' : '') }, cb, detail);
        moduleBox.append(row);
      });
      projectBox.append(moduleBox);
    });
    if (projectBox.querySelector('.catalog-module')) catalog.append(projectBox);
  });
  if (!visible) catalog.append(el('p', { class: 'empty-tip' }, '暂无已生成的接口注册表。'));

  selected.innerHTML = '';
  const chosen = selectedEntries();
  if (!chosen.length) {
    selected.append(el('p', { class: 'view-desc' }, '尚未选择接口。'));
  } else {
    chosen.forEach((entry, index) => {
      const row = el('div', { class: 'compose-selected-row' });
      row.append(el('span', { class: 'compose-index' }, String(index + 1)));
      row.append(el('span', { class: 'compose-selected-title' }, `${entry.api.summary || entry.api.id}（${entry.api.id}）`));
      const up = el('button', { class: 'btn-icon', title: '上移' }, '↑');
      const down = el('button', { class: 'btn-icon', title: '下移' }, '↓');
      const remove = el('button', { class: 'btn-icon', title: '移除' }, '✕');
      up.disabled = index === 0;
      down.disabled = index === chosen.length - 1;
      up.addEventListener('click', () => moveComposeSelection(index, -1));
      down.addEventListener('click', () => moveComposeSelection(index, 1));
      remove.addEventListener('click', () => {
        composeSelection = composeSelection.filter((key) => key !== entry.key);
        renderCompose();
      });
      row.append(up, down, remove);
      selected.append(row);
    });
  }
  generate.disabled = chosen.length === 0;
}

function moveComposeSelection(index, offset) {
  const next = index + offset;
  if (next < 0 || next >= composeSelection.length) return;
  const [item] = composeSelection.splice(index, 1);
  composeSelection.splice(next, 0, item);
  renderCompose();
}

function bodyTemplateText(bodyTemplate) {
  if (typeof bodyTemplate === 'string') return bodyTemplate;
  try { return JSON.stringify(bodyTemplate ?? {}, null, 2); } catch { return '{}'; }
}

function uniqueStrings(values) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function flowFieldType(type) {
  const value = String(type || '').toLowerCase();
  if (value.includes('bool')) return 'boolean';
  if (value.includes('int') || value.includes('long') || value.includes('double') || value.includes('float') || value.includes('decimal')) return 'number';
  if (value.includes('list') || value.includes('set') || value.includes('[]')) return 'array';
  if (value.includes('map') || value.includes('object')) return 'object';
  return 'string';
}

function apiParams(apiDef) {
  const query = Array.isArray(apiDef.queryParams) ? apiDef.queryParams.map((param) => ({ ...param, location: 'query' })) : [];
  const body = Array.isArray(apiDef.bodyParams) ? apiDef.bodyParams.map((param) => ({ ...param, location: 'body' })) : [];
  return [...query, ...body];
}

function parameterDescription(param, apiDef) {
  const source = apiDef.paramSources?.[param.name];
  const parts = [param.desc || ''];
  if (source) parts.push(`来源：${source}`);
  parts.push(`位置：${param.location}`);
  return parts.filter(Boolean).join('；');
}

function buildFlowFields(chosen) {
  return chosen.map((entry) => {
    const params = apiParams(entry.api);
    return {
      group: `${entry.api.summary || entry.api.id}（${entry.api.id}）`,
      fields: params.map((param) => ({
        name: param.name,
        type: flowFieldType(param.type),
        required: Boolean(param.required),
        condition: null,
        options: Array.isArray(entry.api.enumRefs) && entry.api.enumRefs.length ? entry.api.enumRefs.join(', ') : null,
        description: parameterDescription(param, entry.api),
      })),
    };
  }).filter((group) => group.fields.length > 0);
}

function isUpstreamParameter(param, apiDef) {
  const source = String(apiDef.paramSources?.[param.name] || '').toLowerCase();
  return source.includes('上游') || source.includes('返回') || source.includes('接口');
}

function buildAgentStrategy(chosen) {
  const prefill = [];
  const mustAsk = [];
  const forbidden = ['严禁随机生成测试数据或臆造必填字段'];
  chosen.forEach((entry) => {
    apiParams(entry.api).forEach((param) => {
      const source = entry.api.paramSources?.[param.name];
      const defaultValue = param.default || (param.name === 'pageNo' || param.name === 'pageNum' ? '1' : param.name === 'pageSize' ? '20' : '');
      if (defaultValue) prefill.push(`${param.name}=${defaultValue}（${entry.api.id}，可修改）`);
      if (param.required && !isUpstreamParameter(param, entry.api)) {
        mustAsk.push(`${param.name}（${param.desc || param.type || '必填参数'}）`);
      }
      if (source) prefill.push(`${param.name} 来源：${source}`);
    });
    (entry.api.avoidWhen || []).forEach((item) => forbidden.push(item));
  });
  return {
    prefillRules: uniqueStrings(prefill),
    mustAsk: uniqueStrings(mustAsk),
    forbidden: uniqueStrings(forbidden),
  };
}

function buildDomainKnowledge(chosen) {
  const knowledge = [];
  chosen.forEach((entry) => {
    const apiDef = entry.api;
    (entry.module.principles || []).forEach((item) => knowledge.push(item));
    (apiDef.tips || []).forEach((item) => knowledge.push(`${apiDef.id}：${item}`));
    if (apiDef.notes) knowledge.push(`${apiDef.id}：${apiDef.notes}`);
    (apiDef.avoidWhen || []).forEach((item) => knowledge.push(`${apiDef.id} 不适用：${item}`));
    const enrichment = apiDef.enrichment || {};
    (enrichment.businessRules || []).forEach((item) => knowledge.push(`${apiDef.id} 业务规则：${item}`));
    (enrichment.validations || []).forEach((item) => knowledge.push(`${apiDef.id} 校验：${item}`));
    (enrichment.callChain || []).forEach((item) => knowledge.push(`${apiDef.id} 调用链：${item}`));
  });
  return uniqueStrings(knowledge);
}

function buildErrorHandling(chosen) {
  const errors = [];
  chosen.forEach((entry) => {
    (entry.module.errorHandling || []).forEach((item) => errors.push({
      scenario: item.code || item.judgment || item.symptom || '模块异常',
      handling: item.action || item.handling || item.judgment || '请根据接口返回信息处理',
    }));
    (entry.api.enrichment?.errorScenarios || []).forEach((item) => errors.push({
      scenario: `${entry.api.id}：${item}`,
      handling: '请根据该接口的业务错误信息处理，并确认是否需要重新选择输入。',
    }));
  });
  errors.push({ scenario: 'AUTH_EXPIRED / Session 过期', handling: '`anycli auth login` 重新登录' });
  const seen = new Set();
  return errors.filter((item) => {
    const key = `${item.scenario}|${item.handling}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildReferences(chosen) {
  const fields = ['# 自动生成的字段字典', '', '> 首次导入依据接口注册表生成，业务条件和字段映射请人工确认。', ''];
  const examples = ['# 自动生成的调用示例', ''];
  const verify = ['# 自动生成的验证脚本', '', '```bash', 'anycli auth status', ''];
  chosen.forEach((entry) => {
    const apiDef = entry.api;
    fields.push(`## ${apiDef.summary || apiDef.id}`, '');
    apiParams(apiDef).forEach((param) => fields.push(`- ${param.name}（${param.type || 'string'}，${param.required ? '必填' : '选填'}）：${parameterDescription(param, apiDef)}`));
    fields.push('');
    (apiDef.examples || []).forEach((example) => examples.push(`## ${example.title || apiDef.id}`, '', '```bash', example.command || '', '```', ''));
    const body = bodyTemplateText(apiDef.bodyTemplate);
    const query = bodyTemplateText(apiDef.queryTemplate);
    const queryPart = apiDef.queryTemplate ? ` --query '${query}'` : '';
    const bodyPart = apiDef.bodyTemplate ? ` --body '${body}'` : '';
    verify.push(`# ${apiDef.summary || apiDef.id}`, `anycli request <project> ${apiDef.method} ${apiDef.path}${queryPart}${bodyPart}`, '');
  });
  verify.push('```', '', '## 成功标准', '', '- 各接口返回成功响应。', '- 业务字段与接口实际返回结果已人工核对。');
  return { fields: fields.join('\n'), examples: examples.join('\n'), verify: verify.join('\n') };
}

function buildSubmitCommand(project, apiDef) {
  const query = apiDef.queryTemplate ? ` --query '${bodyTemplateText(apiDef.queryTemplate)}'` : '';
  const body = apiDef.bodyTemplate ? ` --body '${bodyTemplateText(apiDef.bodyTemplate)}'` : '';
  return `anycli request ${project} ${apiDef.method} ${apiDef.path}${query}${body}`;
}

function generateFlowFromSelection() {
  if (!flowData) return;
  const chosen = selectedEntries();
  if (!chosen.length) return;
  if (flowData.steps.length && !confirm('当前已有流程步骤，生成操作会替换步骤、接口列表和流程结束接口，确定继续吗？')) return;
  pushSnapshot();
  const moduleDescriptions = uniqueStrings(chosen.map((entry) => entry.module.description));
  const moduleTriggers = uniqueStrings(chosen.flatMap((entry) => entry.module.triggers || []));
  const allPrerequisites = uniqueStrings(chosen.flatMap((entry) => [
    ...(entry.module.prerequisites || []),
    ...(entry.api.prerequisites || []),
  ]));
  if (!allPrerequisites.some((item) => item.includes('登录'))) allPrerequisites.unshift(`已登录业务系统（anycli auth status 检查）`);
  const allFields = buildFlowFields(chosen);
  flowData.steps = chosen.map((entry, index) => ({
    id: `step-${index + 1}`,
    title: entry.api.summary || entry.api.id,
    level: 0,
    parentId: null,
    conditional: false,
    condition: null,
    dependsOn: index === 0 ? [] : [`step-${index}`],
    fieldRefs: apiParams(entry.api).map((param) => param.name),
    apiRefs: [entry.api.id],
    fields: [],
    apis: [entry.api.id],
    content: [
      `调用 ${entry.api.id}（${entry.api.method} ${entry.api.path}）。`,
      entry.api.outputFields ? `输出：${entry.api.outputFields}` : '',
      ...(entry.api.prerequisites || []).map((item) => `前置条件：${item}`),
      ...(entry.api.tips || []).map((item) => `注意：${item}`),
      entry.api.notes ? `备注：${entry.api.notes}` : '',
      entry.api.enrichment?.summary ? `业务说明：${entry.api.enrichment.summary}` : '',
      '不确定的字段来源和条件分支请人工确认。',
    ].filter(Boolean).join('\n'),
    children: [],
  }));
  flowData.apis = chosen.map((entry) => ({
    id: entry.api.id,
    purpose: entry.api.summary || entry.api.id,
    method: entry.api.method,
    path: entry.api.path,
    description: [
      `来自 ${entry.project}/${entry.module.module} Skill 注册表`,
      entry.api.level ? `级别：${entry.api.level}` : '',
      entry.api.outputFields ? `输出：${entry.api.outputFields}` : '',
    ].filter(Boolean).join('；'),
    evidence: { source: 'registry', registryRef: { project: entry.project, module: entry.module.module, apiId: entry.api.id } },
  }));
  const target = chosen[chosen.length - 1];
  flowData.meta.description = moduleDescriptions.join('；') || `业务流程：${chosen.map((entry) => entry.api.summary || entry.api.id).join(' → ')}`;
  flowData.meta.triggers = moduleTriggers;
  flowData.title = chosen.map((entry) => entry.api.summary || entry.api.id).join(' → ');
  flowData.businessGoal = `围绕「${flowData.title}」完成一组业务操作。具体业务目标、条件分支和成功状态请根据实际场景确认。`;
  flowData.prerequisites = allPrerequisites;
  flowData.fieldGroups = allFields;
  flowData.agentStrategy = buildAgentStrategy(chosen);
  flowData.domainKnowledge = buildDomainKnowledge(chosen);
  flowData.errorHandling = buildErrorHandling(chosen);
  flowData.successCriteria = [`最后一个接口（${target.api.id}）返回成功响应，且业务结果符合预期。`];
  flowData.reference = buildReferences(chosen);
  flowData.submitCommand = buildSubmitCommand(target.project, target.api);
  flowData.endApi = { apiRef: target.api.id, method: target.api.method, path: target.api.path, bodyTemplate: bodyTemplateText(target.api.bodyTemplate), evidenceSource: 'registry' };
  markDirty();
  $('#btn-open-enhance').disabled = false;
  $('#modal-compose').classList.add('hidden');
  switchView('steps');
  toast(`已生成 ${chosen.length} 个流程步骤，最后一个接口已设为建议的流程结束接口`, 'success');
}

// ─────────────────────────── Sortable 管理 ───────────────────────────
function destroySortables() {
  sortables.forEach((s) => {
    try { s.destroy(); } catch { /* 忽略 */ }
  });
  sortables = [];
}

// ─────────────────────────── 输入绑定助手 ───────────────────────────
/** focus 时入快照（一次编辑会话只记一次），input 时即时同步数据 */
function bindTextInput(inputEl, apply, after) {
  inputEl.addEventListener('focus', () => pushSnapshot());
  inputEl.addEventListener('input', () => {
    apply(inputEl.value);
    markDirty();
    if (after) after();
  });
}

function cellInput(obj, key, placeholder, after) {
  const td = el('td');
  const input = el('input', { type: 'text' });
  if (placeholder) input.placeholder = placeholder;
  input.value = obj[key] || '';
  bindTextInput(input, (v) => { obj[key] = v; }, after);
  td.append(input);
  return td;
}

function cellSelect(obj, key, options) {
  const td = el('td');
  const select = el('select');
  options.forEach((opt) => {
    const o = el('option', { value: opt }, opt);
    if (obj[key] === opt) o.selected = true;
    select.append(o);
  });
  select.addEventListener('change', () => {
    pushSnapshot();
    obj[key] = select.value;
    markDirty();
  });
  td.append(select);
  return td;
}

function cellCheckbox(obj, key) {
  const td = el('td', { class: 'col-narrow' });
  const cb = el('input', { type: 'checkbox' });
  cb.checked = Boolean(obj[key]);
  cb.addEventListener('change', () => {
    pushSnapshot();
    obj[key] = cb.checked;
    markDirty();
  });
  td.append(cb);
  return td;
}

function rowDeleteBtn(onDelete) {
  const td = el('td', { class: 'col-actions' });
  const btn = el('button', { class: 'btn-icon', title: '删除行' }, '✕');
  btn.addEventListener('click', () => {
    pushSnapshot();
    onDelete();
    markDirty();
  });
  td.append(btn);
  return td;
}

/** 表格行拖拽排序（需每行带 data-idx） */
function bindRowSortable(tbody, arr) {
  if (typeof Sortable === 'undefined') return;
  sortables.push(new Sortable(tbody, {
    handle: '.row-move',
    animation: 150,
    onStart: () => pushSnapshot(),
    onEnd: () => {
      const order = Array.from(tbody.querySelectorAll('tr')).map((tr) => parseInt(tr.dataset.idx, 10));
      const reordered = order.map((i) => arr[i]).filter(Boolean);
      arr.length = 0;
      reordered.forEach((x) => arr.push(x));
      markDirty();
    },
  }));
}

// ─────────────────────────── 视图：基本信息 ───────────────────────────
function renderMeta() {
  $('#f-name').value = flowData.meta.name || '';
  $('#f-title').value = flowData.title || '';
  $('#f-description').value = flowData.meta.description || '';
  $('#f-triggers').value = (flowData.meta.triggers || []).join(', ');
  $('#f-ref-controller').value = flowData.sourceRefs.controller || '';
  $('#f-ref-dto').value = flowData.sourceRefs.dto || '';
  $('#f-ref-frontend').value = flowData.sourceRefs.frontend || '';
  $('#f-business-goal').value = flowData.businessGoal || '';
  $('#f-submit-command').value = flowData.submitCommand || '';
  renderStringList('scenarios');
}

function bindMetaInputs() {
  bindTextInput($('#f-name'), (v) => { flowData.meta.name = v.trim(); });
  bindTextInput($('#f-title'), (v) => { flowData.title = v; });
  bindTextInput($('#f-description'), (v) => { flowData.meta.description = v; });
  bindTextInput($('#f-triggers'), (v) => {
    flowData.meta.triggers = v.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  });
  bindTextInput($('#f-ref-controller'), (v) => { flowData.sourceRefs.controller = v; });
  bindTextInput($('#f-ref-dto'), (v) => { flowData.sourceRefs.dto = v; });
  bindTextInput($('#f-ref-frontend'), (v) => { flowData.sourceRefs.frontend = v; });
  bindTextInput($('#f-business-goal'), (v) => { flowData.businessGoal = v; });
  bindTextInput($('#f-submit-command'), (v) => {
    flowData.submitCommand = v;
    const method = v.match(/\b(GET|POST|PUT|DELETE|PATCH)\b/i);
    const path = v.match(/(?:GET|POST|PUT|DELETE|PATCH)\s+(\S+)/i);
    const body = v.match(/--body\s+'([\s\S]*)'/);
    if (method && path) flowData.endApi = { apiRef: flowData.endApi?.apiRef, method: method[1].toUpperCase(), path: path[1], bodyTemplate: body ? body[1] : '{}', evidenceSource: flowData.endApi?.evidenceSource || 'name-only' };
  });
}

// ─────────────────────────── 视图：可增删文本列表 ───────────────────────────
function renderStringList(key) {
  const container = $(`#list-${key}`);
  if (!container || !flowData) return;
  destroySortables();
  container.innerHTML = '';
  const arr = getStringArray(key);
  arr.forEach((text, idx) => {
    const item = el('div', { class: 'string-list-item' });
    const handle = el('span', { class: 'drag-handle', title: '拖拽排序' }, '⠿');
    const input = el('input', { type: 'text' });
    input.value = text || '';
    bindTextInput(input, (v) => { arr[idx] = v; });
    const del = el('button', { class: 'btn-icon', title: '删除' }, '✕');
    del.addEventListener('click', () => {
      pushSnapshot();
      arr.splice(idx, 1);
      markDirty();
      renderStringList(key);
    });
    item.append(handle, input, del);
    container.append(item);
  });
  if (typeof Sortable !== 'undefined') {
    sortables.push(new Sortable(container, {
      handle: '.drag-handle',
      animation: 150,
      onStart: () => pushSnapshot(),
      onEnd: () => {
        const values = Array.from(container.querySelectorAll('input[type="text"]')).map((i) => i.value);
        arr.length = 0;
        values.forEach((v) => arr.push(v));
        markDirty();
      },
    }));
  }
}

function bindStringListButtons() {
  $$('[data-add-to]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.addTo;
      pushSnapshot();
      getStringArray(key).push('');
      markDirty();
      renderStringList(key);
      const container = $(`#list-${key}`);
      const inputs = container.querySelectorAll('input[type="text"]');
      if (inputs.length) inputs[inputs.length - 1].focus();
    });
  });
}

// ─────────────────────────── 视图：流程步骤 ───────────────────────────
function allStepOptions(excludeId) {
  return flowData.steps
    .filter((s) => s.id !== excludeId)
    .map((s) => ({ value: s.id, label: s.title || s.id }));
}

function allFieldOptions() {
  const opts = [];
  flowData.fieldGroups.forEach((g) => (g.fields || []).forEach((f) => {
    if (f.name) opts.push({ value: f.name, label: f.name });
  }));
  return opts;
}

function allApiOptions() {
  return flowData.apis.filter((a) => a.id).map((a) => ({ value: a.id, label: a.purpose || a.id }));
}

function buildCheckSection(labelText, options, selected, onChange) {
  const wrap = el('div', { class: 'check-section' });
  wrap.append(el('span', { class: 'field-label' }, labelText));
  const group = el('div', { class: 'check-group' });
  if (!options.length) {
    group.append(el('span', { class: 'empty-tip' }, '暂无可选项（请先在对应面板中定义）'));
  } else {
    options.forEach((opt) => {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = selected.includes(opt.value);
      cb.addEventListener('change', () => {
        pushSnapshot();
        onChange(cb.checked, opt.value);
        markDirty();
      });
      group.append(el('label', {}, cb, ` ${opt.label}`));
    });
  }
  wrap.append(group);
  return wrap;
}

function refreshStepBadges(card, step) {
  const badges = card.querySelector(':scope > .step-head .step-badges');
  if (!badges) return;
  badges.innerHTML = '';
  if (step.fields && step.fields.length) badges.append(el('span', { class: 'badge badge-blue' }, `${step.fields.length} 字段`));
  if (step.apis && step.apis.length) badges.append(el('span', { class: 'badge badge-purple' }, `${step.apis.length} 接口`));
  const condTag = card.querySelector(':scope > .step-head .step-cond-tag');
  if (condTag) {
    if (step.condition) { condTag.textContent = '当 ' + step.condition; condTag.classList.remove('hidden'); }
    else { condTag.textContent = ''; condTag.classList.add('hidden'); }
  }
}

function buildStepBody(step, isChild, label) {
  const body = el('div', { class: 'step-body' });
  const grid = el('div', { class: 'form-grid' });

  const titleField = el('label', { class: 'field field-span2' });
  titleField.append(el('span', { class: 'field-label' }, '步骤标题'));
  const titleInput = el('input', { type: 'text', placeholder: '如：选择品牌' });
  titleInput.value = step.title || '';
  titleInput.addEventListener('focus', () => pushSnapshot());
  titleInput.addEventListener('input', () => {
    step.title = titleInput.value;
    const card = titleInput.closest('.step-card');
    const titleText = card.querySelector(':scope > .step-head .step-title-text');
    if (titleText) titleText.textContent = step.title || '（未命名步骤）';
    markDirty();
  });
  titleField.append(titleInput);
  grid.append(titleField);

  const condField = el('label', { class: 'field field-span2' });
  condField.append(el('span', { class: 'field-label' }, '触发条件（condition，留空表示无条件执行）'));
  const condInput = el('input', { type: 'text', placeholder: '如：sampleLocation=WAREHOUSE' });
  condInput.value = step.condition || '';
  condInput.addEventListener('focus', () => pushSnapshot());
  condInput.addEventListener('input', () => {
    step.condition = condInput.value.trim();
    const card = condInput.closest('.step-card');
    card.classList.toggle('conditional', Boolean(step.condition));
    refreshStepBadges(card, step);
    markDirty();
  });
  condField.append(condInput);
  grid.append(condField);

  body.append(grid);

  body.append(buildCheckSection('依赖步骤（dependsOn）', allStepOptions(step.id), step.dependsOn, (checked, value) => {
    if (checked) {
      if (!step.dependsOn.includes(value)) step.dependsOn.push(value);
    } else {
      step.dependsOn = step.dependsOn.filter((v) => v !== value);
    }
  }));

  body.append(buildCheckSection('关联字段（fields）', allFieldOptions(), step.fields, (checked, value) => {
    if (checked) {
      if (!step.fields.includes(value)) step.fields.push(value);
    } else {
      step.fields = step.fields.filter((v) => v !== value);
    }
  }));

  body.append(buildCheckSection('关联接口（apis）', allApiOptions(), step.apis, (checked, value) => {
    if (checked) {
      if (!step.apis.includes(value)) step.apis.push(value);
    } else {
      step.apis = step.apis.filter((v) => v !== value);
    }
  }));

  const contentField = el('label', { class: 'field content-field' });
  contentField.append(el('span', { class: 'field-label' }, '步骤说明（content，支持 Markdown）'));
  const contentTa = el('textarea', { class: 'mono-area', rows: '4' });
  contentTa.value = step.content || '';
  contentTa.addEventListener('focus', () => pushSnapshot());
  contentTa.addEventListener('input', () => {
    step.content = contentTa.value;
    markDirty();
  });
  contentField.append(contentTa);
  body.append(contentField);

  const actions = el('div', { class: 'view-actions' });
  if (!isChild) {
    const addChild = el('button', { class: 'btn' }, '＋ 添加子步骤');
    addChild.addEventListener('click', () => {
      pushSnapshot();
      const child = { id: nextStepId(), title: '', condition: '', dependsOn: [], fields: [], apis: [], content: '', children: [] };
      step.children.push(child);
      expandedSteps.add(step.id);
      markDirty();
      renderSteps();
    });
    actions.append(addChild);
  }
  const copyBtn = el('button', { class: 'btn' }, '⧉ 复制');
  copyBtn.addEventListener('click', () => {
    pushSnapshot();
    const clone = deepClone(step);
    clone.title = (step.title || '') + '（副本）';
    const ids = [];
    assignNewIds(clone, ids);
    const loc = findStepParent(step.id);
    if (loc) loc.arr.splice(loc.index + 1, 0, clone);
    markDirty();
    renderSteps();
  });
  const delBtn = el('button', { class: 'btn btn-danger' }, '✕ 删除');
  delBtn.addEventListener('click', () => {
    if (!confirm(`确定删除步骤「${step.title || label}」吗？`)) return;
    pushSnapshot();
    const loc = findStepParent(step.id);
    if (loc) loc.arr.splice(loc.index, 1);
    expandedSteps.delete(step.id);
    markDirty();
    renderSteps();
  });
  actions.append(copyBtn, delBtn);
  body.append(actions);

  return body;
}

function renderStepCard(step, isChild, label) {
  const card = el('div', {
    class: 'step-card' + (step.condition ? ' conditional' : '') + (expandedSteps.has(step.id) ? ' expanded' : ''),
  });
  card.dataset.stepId = step.id;

  const head = el('div', { class: 'step-head' });
  const handle = el('span', { class: 'drag-handle step-drag', title: '拖拽排序' }, '⠿');
  const num = el('span', { class: 'step-num' }, label);
  const titleText = el('span', { class: 'step-title-text' }, step.title || '（未命名步骤）');
  const badges = el('span', { class: 'step-badges' });
  const condTag = el('span', { class: 'step-cond-tag hidden' });
  const caret = el('span', { class: 'step-caret' }, '▶');
  head.append(handle, num, titleText, badges, condTag, caret);
  refreshStepBadges(card, step);
  head.addEventListener('click', (e) => {
    if (e.target.closest('.step-drag')) return;
    card.classList.toggle('expanded');
    if (card.classList.contains('expanded')) expandedSteps.add(step.id);
    else expandedSteps.delete(step.id);
  });
  card.append(head);
  card.append(buildStepBody(step, isChild, label));

  if (!isChild) {
    const childrenWrap = el('div', { class: 'step-children' });
    (step.children || []).forEach((child, cidx) => {
      childrenWrap.append(renderStepCard(child, true, `${label}${String.fromCharCode(97 + cidx)}`));
    });
    card.append(childrenWrap);
    if (typeof Sortable !== 'undefined') {
      sortables.push(new Sortable(childrenWrap, {
        group: 'sub-steps',
        animation: 150,
        handle: '.step-drag',
        onStart: () => pushSnapshot(),
        onEnd: () => {
          const ids = Array.from(childrenWrap.querySelectorAll(':scope > .step-card')).map((c) => c.dataset.stepId);
          const map = new Map((step.children || []).map((s) => [s.id, s]));
          const reordered = ids.map((id) => map.get(id)).filter(Boolean);
          step.children.length = 0;
          reordered.forEach((s) => step.children.push(s));
          markDirty();
          renderSteps();
        },
      }));
    }
  }
  return card;
}

// ─────────────────────────── 列表底部追加 / 新增高亮 ───────────────────────────
var pendingFlash = null;

function makeAddBar(label, onClick) {
  const bar = el('button', { class: 'add-bar', type: 'button' });
  bar.append(el('span', { class: 'add-bar-icon' }, '＋'));
  bar.append(el('span', { class: 'add-bar-text' }, label.replace(/^＋\s*/, '')));
  bar.addEventListener('click', onClick);
  return bar;
}

function flashAdded(node) {
  if (!node) return;
  try { node.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
  node.classList.add('just-added');
  setTimeout(() => node.classList.remove('just-added'), 1500);
}

function consumeFlash(root) {
  if (!pendingFlash || !root) return;
  const sel = pendingFlash;
  pendingFlash = null;
  const node = root.querySelector(sel);
  if (node) flashAdded(node);
}

function addFieldGroup() {
  const name = prompt('请输入字段分组名称：', '公共信息');
  if (!name || !name.trim()) return;
  pushSnapshot();
  flowData.fieldGroups.push({ group: name.trim(), fields: [] });
  activeFieldGroup = flowData.fieldGroups.length - 1;
  markDirty();
  renderFields();
}

function addField() {
  pushSnapshot();
  if (!flowData.fieldGroups.length) {
    flowData.fieldGroups.push({ group: '默认分组', fields: [] });
    activeFieldGroup = 0;
  }
  const arr = flowData.fieldGroups[activeFieldGroup].fields;
  arr.push({ name: '', type: 'string', required: false, condition: '', source: '', description: '' });
  pendingFlash = 'tr[data-idx="' + (arr.length - 1) + '"]';
  markDirty();
  renderFields();
}

function renderSteps() {
  const container = $('#steps-container');
  if (!container || !flowData) return;
  destroySortables();
  container.innerHTML = '';
  flowData.steps.forEach((step, idx) => {
    container.append(renderStepCard(step, false, String(idx + 1)));
  });
  if (!flowData.steps.length) {
    container.append(el('p', { class: 'view-desc' }, '暂无步骤，点击上方「＋ 添加步骤」开始设计流程。'));
  }
  if (typeof Sortable !== 'undefined') {
    sortables.push(new Sortable(container, {
      group: 'top-steps',
      animation: 150,
      handle: '.step-drag',
      draggable: ':scope > .step-card',
      fallbackOnBody: true,
      swapThreshold: 0.65,
      onStart: () => pushSnapshot(),
      onEnd: () => {
        const ids = Array.from(container.querySelectorAll(':scope > .step-card')).map((c) => c.dataset.stepId);
        const map = new Map(flowData.steps.map((s) => [s.id, s]));
        const reordered = ids.map((id) => map.get(id)).filter(Boolean);
        flowData.steps.length = 0;
        reordered.forEach((s) => flowData.steps.push(s));
        markDirty();
        renderSteps();
      },
    }));
  }
  container.append(makeAddBar('＋ 添加步骤', () => {
    pushSnapshot();
    const step = newStep();
    flowData.steps.push(step);
    expandedSteps.add(step.id);
    pendingFlash = '[data-step-id="' + step.id + '"]';
    markDirty();
    renderSteps();
  }));
  consumeFlash(container);
}

// ─────────────────────────── 视图：字段定义 ───────────────────────────
function renderFields() {
  renderFieldGroupTabs();
  renderFieldTable();
  renderFieldGraph();
}

function renderFieldGroupTabs() {
  const bar = $('#fieldgroup-tabs');
  bar.innerHTML = '';
  flowData.fieldGroups.forEach((g, idx) => {
    const tab = el('button', { class: 'tab' + (idx === activeFieldGroup ? ' active' : '') });
    tab.append(document.createTextNode(g.group || `分组 ${idx + 1}`));
    const rm = el('span', { class: 'tab-remove', title: '删除分组' }, '✕');
    rm.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm(`确定删除字段分组「${g.group}」及其全部字段吗？`)) return;
      pushSnapshot();
      flowData.fieldGroups.splice(idx, 1);
      if (activeFieldGroup >= flowData.fieldGroups.length) {
        activeFieldGroup = Math.max(0, flowData.fieldGroups.length - 1);
      }
      markDirty();
      renderFields();
    });
    tab.append(rm);
    tab.addEventListener('click', () => {
      activeFieldGroup = idx;
      renderFieldGroupTabs();
      renderFieldTable();
    });
    bar.append(tab);
  });
  const addTab = el('button', { class: 'tab tab-add', type: 'button', title: '新建字段分组' }, '＋ 分组');
  addTab.addEventListener('click', () => addFieldGroup());
  bar.append(addTab);
}

function renderFieldTable() {
  const wrap = $('#fields-table-wrap');
  destroySortables();
  wrap.innerHTML = '';
  const group = flowData.fieldGroups[activeFieldGroup];
  if (!group) {
    wrap.append(el('p', { class: 'view-desc empty-inline' }, '还没有字段分组，先创建一个分组，再往里加字段。'));
    wrap.append(makeAddBar('＋ 创建字段分组', () => addFieldGroup()));
    return;
  }
  const table = el('table', { class: 'data-table' });
  table.append(el('thead', {}, el('tr', {},
    el('th', { class: 'col-narrow' }, ''),
    el('th', {}, '字段名'),
    el('th', {}, '类型'),
    el('th', { class: 'col-narrow' }, '必填'),
    el('th', {}, '条件（condition）'),
    el('th', {}, '值来源'),
    el('th', {}, '说明'),
    el('th', { class: 'col-actions' }, ''))));
  const tbody = el('tbody');
  group.fields.forEach((f, idx) => {
    const tr = el('tr');
    tr.dataset.idx = String(idx);
    tr.append(el('td', { class: 'row-move' }, '⠿'));
    tr.append(cellInput(f, 'name', 'brandCode', renderFieldGraph));
    tr.append(cellSelect(f, 'type', FIELD_TYPES));
    tr.append(cellCheckbox(f, 'required'));
    tr.append(cellInput(f, 'condition', 'sampleLocation=WAREHOUSE', renderFieldGraph));
    tr.append(cellInput(f, 'source', '接口 / 固定值'));
    tr.append(cellInput(f, 'description', '业务含义'));
    tr.append(rowDeleteBtn(() => {
      group.fields.splice(idx, 1);
      renderFieldTable();
      renderFieldGraph();
    }));
    tbody.append(tr);
  });
  table.append(tbody);
  wrap.append(table);
  bindRowSortable(tbody, group.fields);
  wrap.append(makeAddBar('＋ 添加字段', () => addField()));
  consumeFlash(wrap);
}

/** 从 condition 中解析依赖的字段名，如 "sampleLocation=WAREHOUSE" -> "sampleLocation" */
function conditionDep(condition) {
  if (!condition) return null;
  const m = /([A-Za-z_][\w.]*)\s*(?:=|!=|==|∈|\bin\b)/.exec(condition);
  return m ? m[1] : null;
}

/** 遍历字段依赖树，返回 [{field, prefix, connector}] */
function walkFieldTree(data) {
  const allFields = [];
  (data.fieldGroups || []).forEach((g) => (g.fields || []).forEach((f) => {
    if (f.name) allFields.push(f);
  }));
  const byName = new Map();
  allFields.forEach((f) => {
    if (!byName.has(f.name)) byName.set(f.name, f);
  });
  const childrenOf = new Map();
  const roots = [];
  allFields.forEach((f) => {
    const dep = conditionDep(f.condition);
    if (dep && byName.has(dep) && dep !== f.name) {
      if (!childrenOf.has(dep)) childrenOf.set(dep, []);
      childrenOf.get(dep).push(f);
    } else {
      roots.push(f);
    }
  });
  const nodes = [];
  const visited = new Set();
  const visit = (f, prefix, connector) => {
    if (visited.has(f.name)) return;
    visited.add(f.name);
    nodes.push({ field: f, prefix, connector });
    const kids = childrenOf.get(f.name) || [];
    const childPrefix = connector === '' ? '' : prefix + (connector.startsWith('└') ? '    ' : '│   ');
    kids.forEach((k, i) => visit(k, childPrefix, i === kids.length - 1 ? '└── ' : '├── '));
  };
  roots.forEach((f) => visit(f, '', ''));
  allFields.forEach((f) => visit(f, '', '')); // 兜底：循环依赖导致未访问到的字段
  return nodes;
}

function fieldGraphText(data) {
  return walkFieldTree(data).map(({ field, prefix, connector }) => {
    const req = field.required ? ' [必填]' : '';
    const cond = field.condition ? `  (${field.condition})` : '';
    return `${prefix}${connector}${field.name}${req}${cond}`;
  }).join('\n');
}

function renderFieldGraph() {
  const graphEl = $('#fields-graph');
  if (!graphEl || !flowData) return;
  const html = walkFieldTree(flowData).map(({ field, prefix, connector }) => {
    const req = field.required ? ' <span class="dep-req">[必填]</span>' : '';
    const cond = field.condition ? `  <span class="dep-cond">(${escapeHtml(field.condition)})</span>` : '';
    return `${escapeHtml(prefix + connector)}<span class="dep-name">${escapeHtml(field.name)}</span>${req}${cond}`;
  }).join('\n');
  graphEl.innerHTML = html || '<span class="dep-cond">暂无字段</span>';
}

// ─────────────────────────── 视图：接口列表 ───────────────────────────
function renderApis() {
  const wrap = $('#apis-table-wrap');
  destroySortables();
  wrap.innerHTML = '';
  const table = el('table', { class: 'data-table' });
  table.append(el('thead', {}, el('tr', {},
    el('th', { class: 'col-narrow' }, ''),
    el('th', {}, 'ID'),
    el('th', {}, '用途'),
    el('th', {}, '方法'),
    el('th', {}, '路径'),
    el('th', {}, '说明'),
    el('th', { class: 'col-actions' }, ''))));
  const tbody = el('tbody');
  flowData.apis.forEach((a, idx) => {
    const tr = el('tr');
    tr.dataset.idx = String(idx);
    tr.append(el('td', { class: 'row-move' }, '⠿'));
    tr.append(cellInput(a, 'id', 'api-1'));
    tr.append(cellInput(a, 'purpose', '获取品牌列表'));
    tr.append(cellSelect(a, 'method', API_METHODS));
    tr.append(cellInput(a, 'path', '/{prefix}/xxx'));
    tr.append(cellInput(a, 'description', ''));
    tr.append(rowDeleteBtn(() => {
      flowData.apis.splice(idx, 1);
      renderApis();
    }));
    tbody.append(tr);
  });
  table.append(tbody);
  wrap.append(table);
  bindRowSortable(tbody, flowData.apis);
  wrap.append(makeAddBar('＋ 添加接口', () => {
    pushSnapshot();
    flowData.apis.push({ id: nextApiId(), purpose: '', method: 'POST', path: '', description: '' });
    pendingFlash = 'tr[data-idx="' + (flowData.apis.length - 1) + '"]';
    markDirty();
    renderApis();
  }));
  consumeFlash(wrap);
}

// ─────────────────────────── 视图：话术模板 ───────────────────────────
function renderSpeech() {
  const container = $('#speech-container');
  container.innerHTML = '';
  flowData.speechTemplates.forEach((t, idx) => {
    const card = el('div', { class: 'speech-card' });
    card.dataset.speechIdx = String(idx);
    const head = el('div', { class: 'card-head' });
    head.append(el('b', {}, `模板 ${idx + 1}`));
    const del = el('button', { class: 'btn btn-danger' }, '✕ 删除');
    del.addEventListener('click', () => {
      if (!confirm('确定删除该话术模板吗？')) return;
      pushSnapshot();
      flowData.speechTemplates.splice(idx, 1);
      markDirty();
      renderSpeech();
    });
    head.append(del);
    card.append(head);

    const grid = el('div', { class: 'form-grid' });
    const nameField = el('label', { class: 'field' });
    nameField.append(el('span', { class: 'field-label' }, '模板名称（name）'));
    const nameInput = el('input', { type: 'text', placeholder: '标准模板 / 批量明细模板' });
    nameInput.value = t.name || '';
    bindTextInput(nameInput, (v) => { t.name = v; });
    nameField.append(nameInput);
    grid.append(nameField);

    const noteField = el('label', { class: 'field' });
    noteField.append(el('span', { class: 'field-label' }, '备注（note）'));
    const noteInput = el('input', { type: 'text', placeholder: '如：方括号 [] 内的片段可省略' });
    noteInput.value = t.note || '';
    bindTextInput(noteInput, (v) => { t.note = v; });
    noteField.append(noteInput);
    grid.append(noteField);
    card.append(grid);

    const taField = el('label', { class: 'field' });
    taField.append(el('span', { class: 'field-label' }, '话术模板（template）'));
    const ta = el('textarea', { class: 'mono-area', rows: '4' });
    ta.placeholder = '为【客户名称】下单【商品名/条码】，【数量】个，用于【用途】。';
    ta.value = t.template || '';
    bindTextInput(ta, (v) => { t.template = v; });
    taField.append(ta);
    card.append(taField);

    container.append(card);
  });
  if (!flowData.speechTemplates.length) {
    container.append(el('p', { class: 'view-desc empty-inline' }, '还没有话术模板，点击下方按钮创建第一个。'));
  }
  container.append(makeAddBar('＋ 添加话术模板', () => {
    pushSnapshot();
    flowData.speechTemplates.push({ name: '', template: '', note: '' });
    pendingFlash = '[data-speech-idx="' + (flowData.speechTemplates.length - 1) + '"]';
    markDirty();
    renderSpeech();
  }));
  consumeFlash(container);
}

// ─────────────────────────── 视图：引导策略 ───────────────────────────
function renderPrefill() {
  const wrap = $('#prefill-table-wrap');
  destroySortables();
  wrap.innerHTML = '';
  const rules = flowData.agentStrategy.prefillRules;
  const table = el('table', { class: 'data-table' });
  table.append(el('thead', {}, el('tr', {},
    el('th', { class: 'col-narrow' }, ''),
    el('th', {}, '字段'),
    el('th', {}, '默认值'),
    el('th', {}, '来源'),
    el('th', { class: 'col-narrow' }, '可改'),
    el('th', { class: 'col-actions' }, ''))));
  const tbody = el('tbody');
  rules.forEach((r, idx) => {
    const tr = el('tr');
    tr.dataset.idx = String(idx);
    tr.append(el('td', { class: 'row-move' }, '⠿'));
    tr.append(cellInput(r, 'field', 'brand'));
    tr.append(cellInput(r, 'defaultValue', '用户有权限的第一个品牌'));
    tr.append(cellInput(r, 'source', 'permission/listAllBrandByUser'));
    tr.append(cellCheckbox(r, 'editable'));
    tr.append(rowDeleteBtn(() => {
      rules.splice(idx, 1);
      renderPrefill();
    }));
    tbody.append(tr);
  });
  table.append(tbody);
  wrap.append(table);
  bindRowSortable(tbody, rules);
  wrap.append(makeAddBar('＋ 添加预填规则', () => {
    pushSnapshot();
    flowData.agentStrategy.prefillRules.push({ field: '', defaultValue: '', source: '', editable: true });
    pendingFlash = 'tr[data-idx="' + (flowData.agentStrategy.prefillRules.length - 1) + '"]';
    markDirty();
    renderPrefill();
  }));
  consumeFlash(wrap);
}

// ─────────────────────────── 视图：错误处理 ───────────────────────────
function renderErrors() {
  const wrap = $('#errors-table-wrap');
  destroySortables();
  wrap.innerHTML = '';
  const table = el('table', { class: 'data-table' });
  table.append(el('thead', {}, el('tr', {},
    el('th', { class: 'col-narrow' }, ''),
    el('th', {}, '错误场景 / 错误码'),
    el('th', {}, '处理方式'),
    el('th', { class: 'col-actions' }, ''))));
  const tbody = el('tbody');
  flowData.errorHandling.forEach((item, idx) => {
    const tr = el('tr');
    tr.dataset.idx = String(idx);
    tr.append(el('td', { class: 'row-move' }, '⠿'));
    tr.append(cellInput(item, 'scenario', 'AUTH_EXPIRED'));
    tr.append(cellInput(item, 'handling', 'anycli auth login 重新登录'));
    tr.append(rowDeleteBtn(() => {
      flowData.errorHandling.splice(idx, 1);
      renderErrors();
    }));
    tbody.append(tr);
  });
  table.append(tbody);
  wrap.append(table);
  bindRowSortable(tbody, flowData.errorHandling);
  wrap.append(makeAddBar('＋ 添加错误场景', () => {
    pushSnapshot();
    flowData.errorHandling.push({ scenario: '', handling: '' });
    pendingFlash = 'tr[data-idx="' + (flowData.errorHandling.length - 1) + '"]';
    markDirty();
    renderErrors();
  }));
  consumeFlash(wrap);
}

// ─────────────────────────── 视图：参考文件 ───────────────────────────
const REF_BLOCKS = [
  ['fields', 'ref-fields'],
  ['examples', 'ref-examples'],
  ['verify', 'ref-verify'],
];

function renderReference() {
  REF_BLOCKS.forEach(([key, id]) => {
    const ta = $(`#${id}`);
    ta.value = flowData.reference[key] || '';
    $(`#${id}-preview`).innerHTML = renderMarkdown(ta.value);
  });
}

function bindReferenceInputs() {
  REF_BLOCKS.forEach(([key, id]) => {
    const ta = $(`#${id}`);
    const preview = $(`#${id}-preview`);
    ta.addEventListener('focus', () => pushSnapshot());
    ta.addEventListener('input', () => {
      if (!flowData) return;
      flowData.reference[key] = ta.value;
      preview.innerHTML = renderMarkdown(ta.value);
      markDirty();
    });
  });
}

// ─────────────────────────── 前端编译器：flow.json → SKILL.md ───────────────────────────

function cleanApiPath(p) {
  return (p || '').replace(/[`'"\u2018\u2019\u201c\u201d]/g, '').trim();
}

function buildApiMap(apis) {
  const m = new Map();
  (apis || []).forEach((a) => { if (a.id) m.set(a.id, a); });
  return m;
}

function apiLabel(id, apiMap) {
  const api = apiMap.get(id);
  return api ? (api.purpose || api.id) : id;
}

function flattenStepsNested(steps) {
  const flat = [];
  let topNum = 0;
  (steps || []).forEach((s) => {
    topNum++;
    flat.push({ step: s, num: String(topNum), level: 0 });
    (s.children || []).forEach((c, j) => {
      flat.push({ step: c, num: topNum + '.' + (j + 1), level: 1 });
    });
  });
  return flat;
}

function normalizeDependsPreview(deps, selfId, knownIds) {
  if (!Array.isArray(deps)) return [];
  const seen = new Set();
  const result = [];
  for (let d of deps) {
    d = String(d).trim();
    if (!d) continue;
    if (/^\d+$/.test(d)) d = 'step-' + d;
    if (d === selfId || seen.has(d) || !knownIds.has(d)) continue;
    seen.add(d);
    result.push(d);
  }
  return result;
}

function stepRefLabelPreview(id, idNumMap, idTitleMap) {
  const num = idNumMap.get(id) || '?';
  const title = idTitleMap.get(id) || id;
  return 'Step ' + num + '\u300c' + title + '\u300d';
}

function getStepApiRefs(step) {
  if (Array.isArray(step.apis) && step.apis.length) return step.apis.filter(Boolean);
  if (Array.isArray(step.apiRefs) && step.apiRefs.length) return step.apiRefs.filter(Boolean);
  if (step.apiRef) return [step.apiRef];
  return [];
}

function getStepFieldRefs(step) {
  if (Array.isArray(step.fields) && step.fields.length) return step.fields.filter(Boolean);
  if (Array.isArray(step.fieldRefs) && step.fieldRefs.length) return step.fieldRefs.filter(Boolean);
  return [];
}

function renderStepsOverviewPreview(steps, apis) {
  const flat = flattenStepsNested(steps);
  const apiMap = buildApiMap(apis);
  const knownIds = new Set(flat.map((e) => e.step.id));
  const idNumMap = new Map(flat.map((e) => [e.step.id, e.num]));
  const idTitleMap = new Map(flat.map((e) => [e.step.id, e.step.title || '']));
  const lines = [];
  for (const { step, num, level } of flat) {
    const condTag = (step.condition || step.conditional) ? ' `条件`' : '';
    const deps = normalizeDependsPreview(step.dependsOn, step.id, knownIds);
    const refs = getStepApiRefs(step);
    const parts = [];
    if ((step.condition || step.conditional) && step.condition) parts.push('当 ' + step.condition);
    if (deps.length) parts.push('依赖 ' + deps.map((d) => stepRefLabelPreview(d, idNumMap, idTitleMap)).join('、'));
    if (refs.length) parts.push('调用 ' + refs.map((r) => '\u300c' + apiLabel(r, apiMap) + '\u300d').join('、'));
    const indent = level === 0 ? '' : '   ';
    const marker = level === 0 ? num + '.' : '-';
    const tail = parts.length ? ' \u2014 ' + parts.join('；') : '';
    lines.push(indent + marker + ' **' + (step.title || '（未命名）') + '**' + condTag + tail);
  }
  return lines.join('\n');
}

function renderStepsDetailPreview(steps, apis) {
  const flat = flattenStepsNested(steps);
  const apiMap = buildApiMap(apis);
  const knownIds = new Set(flat.map((e) => e.step.id));
  const idNumMap = new Map(flat.map((e) => [e.step.id, e.num]));
  const idTitleMap = new Map(flat.map((e) => [e.step.id, e.step.title || '']));
  const blocks = [];
  for (const { step, num, level } of flat) {
    const deps = normalizeDependsPreview(step.dependsOn, step.id, knownIds);
    const refs = getStepApiRefs(step);
    const fields = getStepFieldRefs(step);
    const head = level === 0 ? '### Step ' + num + '\uff1a' + (step.title || '') : '#### Step ' + num + '\uff1a' + (step.title || '');
    const lines = [head, ''];
    const meta = [];
    if ((step.condition || step.conditional) && step.condition) meta.push('- **触发条件**：' + step.condition);
    if (deps.length) meta.push('- **依赖步骤**：' + deps.map((d) => stepRefLabelPreview(d, idNumMap, idTitleMap)).join('、'));
    if (refs.length) {
      meta.push('- **调用接口**：' + refs.map((r) => {
        const api = apiMap.get(r);
        return api ? (api.purpose || api.id) + '（`' + api.method + ' ' + cleanApiPath(api.path) + '`）' : '`' + r + '`';
      }).join('；'));
    }
    if (fields.length) meta.push('- **关联字段**：' + fields.map((f) => '`' + f + '`').join('、'));
    if (meta.length) { lines.push(...meta); lines.push(''); }
    let body = (step.content || '').trim();
    if (body) {
      const title = step.title || '';
      const afterTitle = body.startsWith(title) ? body.slice(title.length).trim() : body;
      if (afterTitle === '' || /^(?:[（(]依赖[^)）]*[)）])+$/.test(afterTitle)) body = '';
    }
    let bodyPrinted = false;
    if (body && body !== (step.title || '').trim()) {
      lines.push(body);
      lines.push('');
      bodyPrinted = true;
    }
    if (meta.length === 0 && !bodyPrinted) {
      lines.push('_（暂无更多配置 — 可在编辑器为此步骤补充触发条件、关联接口 / 字段、步骤说明）_');
      lines.push('');
    }
    blocks.push(lines.join('\n').replace(/\n+$/, ''));
  }
  return blocks.join('\n\n');
}

function compileFlowPreview(data) {
  const out = [];
  const push = (...lines) => out.push(...lines);

  push('---');
  push('name: ' + (data.meta.name || 'flow-unnamed'));
  push('description: >');
  const desc = (data.meta.description || '').trim();
  (desc ? desc.split('\n') : ['']).forEach((l) => push('  ' + l));
  push('type: ' + (data.meta.type || 'flow'));
  const triggers = data.meta.triggers || [];
  if (triggers.length) { push('triggers:'); triggers.forEach((t) => push('  - ' + t)); }
  else push('triggers: []');
  const refs = data.sourceRefs || data.meta.sourceRefs || {};
  if (refs.controller || refs.dto || refs.frontend) {
    push('source_refs:');
    if (refs.controller) push('  controller: ' + refs.controller);
    if (refs.dto) push('  dto: ' + refs.dto);
    if (refs.frontend) push('  frontend: ' + refs.frontend);
  }
  push('---');
  push('<!-- AUTO-GENERATED from flow.json \u2014 请勿手动编辑 -->');
  push('');
  push('# ' + (data.title || data.meta.name || '未命名流程'));

  if ((data.businessGoal || '').trim()) push('', '## 业务目标', '', data.businessGoal.trim());

  const scenarios = (data.scenarios || []).filter(Boolean);
  if (scenarios.length) { push('', '## 适用场景', ''); scenarios.forEach((s) => push('- ' + s)); }

  const prerequisites = (data.prerequisites || []).filter(Boolean);
  if (prerequisites.length) { push('', '## 前置条件', ''); prerequisites.forEach((s) => push('- ' + s)); }

  if ((data.steps || []).length) {
    push('', '## 流程总览', '');
    push(renderStepsOverviewPreview(data.steps, data.apis));
    push('', '## 步骤详情', '');
    push(renderStepsDetailPreview(data.steps, data.apis));
  }

  const graph = fieldGraphText(data);
  if (graph) push('', '## 字段依赖图', '', '```', graph, '```');

  if ((data.speechTemplates || []).length) {
    push('', '## 快速话术模板', '');
    data.speechTemplates.forEach((t) => {
      push('### ' + (t.name || '模板'), '', '```', (t.template || '').trim(), '```', '');
      if (t.note) push('> ' + t.note, '');
    });
  }

  const strategy = data.agentStrategy || {};
  const hasStrategy = (strategy.prefillRules || []).length || (strategy.mustAsk || []).length || (strategy.forbidden || []).length;
  if (hasStrategy) {
    push('', '## Agent 引导策略：智能预填 + 确认修改', '');
    const prefill = (strategy.prefillRules || []).filter(Boolean);
    if (prefill.length) {
      push('### 可预填字段（有合理默认值）', '');
      prefill.forEach((r) => push('- ' + (typeof r === 'string' ? r : r.field + '：' + r.defaultValue)));
      push('');
    }
    const mustAsk = (strategy.mustAsk || []).filter(Boolean);
    if (mustAsk.length) { push('### 必须追问字段（无默认、不可编造）', ''); mustAsk.forEach((s) => push('- ' + s)); push(''); }
    const forbidden = (strategy.forbidden || []).filter(Boolean);
    if (forbidden.length) { push('### 禁止行为', ''); forbidden.forEach((s) => push('- ' + s)); push(''); }
  }

  const sc = data.endApi || data.submitCommand;
  if (sc) {
    push('', '## 流程结束接口调用示例', '', '```bash');
    if (typeof sc === 'string') {
      push(sc.trim());
    } else {
      const body = (sc.bodyTemplate || '').trim();
      const alreadyCommand = /^anycli\s+/i.test(body) || /anycli\s+request/i.test(body);
      if (alreadyCommand) {
        push(body.replace(/^anycli[^\n]*?--body\s+'?\s*\n(?=anycli\s+)/i, ''));
      } else {
        push('anycli request <project> ' + (sc.method || 'POST') + ' ' + cleanApiPath(sc.path) + " --body '");
        push(body);
        push("'");
      }
    }
    push('```');
  }

  if ((data.apis || []).length) {
    push('', '## 辅助接口', '', '| 用途 | 命令/接口 | 说明 |', '|------|-----------|------|');
    data.apis.forEach((a) => {
      push('| ' + (a.purpose || '') + ' | ' + (a.method || '') + ' ' + cleanApiPath(a.path) + ' | ' + (a.description || '') + ' |');
    });
  }

  if ((data.errorHandling || []).length) {
    push('', '## 错误处理', '', '| 错误场景 | 处理方式 |', '|----------|----------|');
    data.errorHandling.forEach((e) => push('| ' + (e.scenario || '') + ' | ' + (e.handling || '') + ' |'));
  }

  const successCriteria = (data.successCriteria || []).filter(Boolean);
  if (successCriteria.length) { push('', '## 成功标准', ''); successCriteria.forEach((s, i) => push((i + 1) + '. ' + s)); }

  const domainKnowledge = (data.domainKnowledge || []).filter(Boolean);
  if (domainKnowledge.length) { push('', '## 领域知识', ''); domainKnowledge.forEach((s) => push('- ' + s)); }

  const ref = data.reference || {};
  const refRows = [
    ['reference/fields.md', '完整字段字典 + 条件规则', ref.fields],
    ['reference/examples.md', '话术示例集（多场景）', ref.examples],
    ['reference/verify.md', 'test 环境验证脚本', ref.verify],
  ].filter((row) => (row[2] || '').trim());
  if (refRows.length) {
    push('', '## 参考文件', '', '| 文件 | 内容 | 何时查阅 |', '|------|------|---------|');
    refRows.forEach(([file, label]) => push('| [' + file + '](./' + file + ') | ' + label + ' | 按需加载 |'));
  }

  push('');
  return out.join('\n');
}

// ─────────────────────────── 预览面板 ───────────────────────────
function updatePreview() {
  if (!flowData) return;
  const md = compileFlowPreview(flowData);
  $('#preview-source-code').textContent = md;
  $('#preview-rendered').innerHTML = renderMarkdown(md);
  $('#preview-empty').classList.add('hidden');
}
const schedulePreview = debounce(updatePreview, 500);

async function copySource() {
  if (!flowData) return;
  const md = compileFlowPreview(flowData);
  try {
    await navigator.clipboard.writeText(md);
    toast('Markdown 源码已复制到剪贴板', 'success');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = md;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('Markdown 源码已复制到剪贴板', 'success');
  }
}

// ─────────────────────────── 全局事件绑定 ───────────────────────────
function onKeydown(e) {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return;
  const key = e.key.toLowerCase();
  if (key === 's') {
    e.preventDefault();
    saveWorkflow();
  } else if (key === 'z' && !e.shiftKey) {
    e.preventDefault();
    undo();
  } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
    e.preventDefault();
    redo();
  }
}

function bindGlobalEvents() {
  $('#btn-reload-list').addEventListener('click', () => {
    loadWorkflowList();
    toast('工作流列表已刷新');
  });
  $('#workflow-select').addEventListener('change', (e) => {
    if (e.target.value) loadWorkflow(e.target.value);
  });
  $('#btn-save').addEventListener('click', saveWorkflow);
  $('#btn-build').addEventListener('click', buildWorkflow);
  $('#btn-compose-generate').addEventListener('click', generateFlowFromSelection);
  $('#btn-open-enhance').addEventListener('click', openEnhance);
  $('#btn-enhance-close').addEventListener('click', () => $('#modal-enhance').classList.add('hidden'));
  $('#btn-enhance-start').addEventListener('click', startEnhance);
  $('#btn-enhance-cancel').addEventListener('click', cancelEnhance);
  $('#btn-enhance-apply').addEventListener('click', applyEnhanceProposal);
  $('#btn-open-compose').addEventListener('click', () => {
    composeSelection = [];
    $('#modal-compose').classList.remove('hidden');
    renderCompose();
  });
  $('#btn-compose-close').addEventListener('click', () => $('#modal-compose').classList.add('hidden'));
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-redo').addEventListener('click', redo);

  $('#btn-toggle-preview').addEventListener('click', () => {
    $('#main').classList.toggle('preview-collapsed');
  });

  const expandBtn = document.querySelector('#btn-expand-preview');
  if (expandBtn) {
    expandBtn.addEventListener('click', () => {
      const main = document.querySelector('#main');
      const expanded = main.classList.toggle('preview-expanded');
      main.classList.remove('preview-collapsed');
      expandBtn.textContent = expanded ? '⤡' : '⤢';
      expandBtn.title = expanded ? '收缩预览面板' : '展开预览面板（加宽一倍）';
    });
  }
  $('#btn-copy-source').addEventListener('click', copySource);

  $$('.preview-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.preview-tab').forEach((t) => t.classList.toggle('active', t === tab));
      const rendered = tab.dataset.ptab === 'rendered';
      $('#preview-rendered').classList.toggle('hidden', !rendered);
      $('#preview-source').classList.toggle('hidden', rendered);
    });
  });

  $$('.nav-item').forEach((item) => {
    item.addEventListener('click', () => switchView(item.dataset.view));
  });
  $$('.nav-group-title').forEach((title) => {
    title.addEventListener('click', () => title.parentElement.classList.toggle('collapsed'));
  });

  // 新建工作流弹窗
  $('#btn-new').addEventListener('click', () => {
    $('#modal-new').classList.remove('hidden');
    $('#new-project').focus();
  });
  $('#btn-new-cancel').addEventListener('click', () => $('#modal-new').classList.add('hidden'));
  $('#modal-new').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) $('#modal-new').classList.add('hidden');
  });
  $('#btn-new-confirm').addEventListener('click', async () => {
    const project = $('#new-project').value.trim();
    const business = $('#new-business').value.trim();
    if (!project || !business) {
      toast('请填写项目组与业务名', 'error');
      return;
    }
    try {
      const created = await api('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, business }),
      });
      $('#modal-new').classList.add('hidden');
      $('#new-project').value = '';
      $('#new-business').value = '';
      await loadWorkflowList();
      $('#workflow-select').value = created.id;
      await loadWorkflow(created.id);
      toast(`已创建：${created.id}`, 'success');
    } catch (err) {
      toast('创建失败: ' + err.message, 'error');
    }
  });

  $$('[data-fieldtab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('[data-fieldtab]').forEach((t) => t.classList.toggle('active', t === tab));
      const isTable = tab.dataset.fieldtab === 'table';
      $('#fields-table-wrap').classList.toggle('hidden', !isTable);
      $('#fields-graph-wrap').classList.toggle('hidden', isTable);
      if (!isTable) renderFieldGraph();
    });
  });

  document.addEventListener('keydown', onKeydown);
  window.addEventListener('beforeunload', (e) => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

// ─────────────────────────── 主题切换 ───────────────────────────
// 与门户 / 技能编辑页共用同一主题 key，三端主题联动
const THEME_KEY = 'anycli-editor-theme';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.querySelector('#btn-theme');
  if (btn) {
    btn.textContent = theme === 'dark' ? '☀' : '☾';
    btn.title = theme === 'dark' ? '切换到浅色主题' : '切换到深色主题';
  }
}

function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next = isDark ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
  applyTheme(next);
}

function initTheme() {
  let stored = null;
  try { stored = localStorage.getItem(THEME_KEY); } catch (e) { /* ignore */ }
  applyTheme(stored === 'dark' ? 'dark' : 'light');
  const btn = document.querySelector('#btn-theme');
  if (btn) btn.addEventListener('click', toggleTheme);
}

// ─────────────────────────── 初始化 ───────────────────────────
/** 从 URL 路径解析工作流 id（支持 /flow/{project}/flows/{name} 深链） */
function flowIdFromLocation() {
  const m = location.pathname.match(/^\/flow\/(.+)$/);
  if (!m) return null;
  let id;
  try {
    id = decodeURIComponent(m[1]);
  } catch {
    id = m[1];
  }
  // 兼容带 skills/ 前缀的入参（anycli flow edit skills/...）
  return id.replace(/^skills\//, '');
}

async function init() {
  initTheme();
  if (window.marked && marked.setOptions) {
    marked.setOptions({ gfm: true, breaks: true });
  }
  bindGlobalEvents();
  bindMetaInputs();
  bindStringListButtons();
  bindReferenceInputs();
  await loadSkillCatalog();
  await loadWorkflowList();
  const select = $('#workflow-select');
  // URL 深链（/flow/{project}/flows/{name}）优先自动加载
  const deepLinkId = flowIdFromLocation();
  const optionIds = Array.from(select.options).map((o) => o.value);
  if (deepLinkId && optionIds.includes(deepLinkId)) {
    select.value = deepLinkId;
    await loadWorkflow(deepLinkId);
  } else if (select.options.length > 1) {
    select.value = select.options[1].value;
    await loadWorkflow(select.value);
  }
}

document.addEventListener('DOMContentLoaded', init);
