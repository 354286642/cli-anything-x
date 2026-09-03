# 实现方案：在线编辑体系 + API 请求架构升级

## 一、现状确认

### skills.html 页面状态
- ✅ 页面结构完整（DOCTYPE / DATA / PROJECTS / modal / search 均存在）
- ✅ 生成命令正常（`anycli skill docs`）
- ✅ 文件大小 ~62KB，单文件 HTML 无外部依赖
- ⚠️ 当前为纯展示页面，无编辑入口

### 现有 API 请求架构
- `src/core/client.ts` — 单一 `createClient(project)` 工厂，所有请求走 `request()` 方法
- 已有：统一 headers 注入、HTTP 状态码分类、超时控制、verbose 日志
- 缺失：分页聚合、重试、请求/响应拦截器、按 id 调用、操作分级拦截

### flow-editor 现有架构
- `tools/flow-editor/server.mjs` — 纯 Node.js HTTP 服务（无框架依赖）
- API：`GET /api/workflows`（列表）、`GET/PUT /api/workflows/:id`（读写）、`POST /api/workflows/:id/build`（编译）
- 前端：`index.html` + `editor.js` + `editor.css`，SortableJS 拖拽

---

## 二、统一编辑门户

### 目标

将 skills.html 升级为**统一入口门户**，点击 Skill 跳转 Skill 编辑器，点击 Flow 跳转 Flow 编辑器。

### 架构

```
tools/
├── flow-editor/          # 现有（保留）
│   ├── server.mjs
│   ├── index.html
│   ├── editor.js
│   └── editor.css
├── skill-editor/         # 新增
│   ├── server.mjs        # Skill 编辑服务
│   ├── index.html        # 编辑器页面
│   ├── editor.js
│   └── editor.css
└── portal/               # 新增：统一门户
    ├── server.mjs        # 统一服务（代理 + 静态）
    └── index.html        # 门户首页（替代 skills.html 的交互版）
```

### 统一门户设计

```
anycli edit [--port 3200]
```

启动后：
- `http://localhost:3200/` — 门户首页（技能卡片列表，类似 skills.html 但可交互）
- 点击原子 Skill 卡片 → `/skill/{project}/{module}` — Skill 编辑器
- 点击流程 Skill 卡片 → `/flow/{project}/{flowName}` — Flow 编辑器（复用现有）

### 门户首页功能

| 功能 | 说明 |
|------|------|
| 技能卡片列表 | 按项目分组，显示名称/描述/版本/接口数 |
| 搜索过滤 | 跨名称/触发词/命令搜索 |
| 点击跳转 | 原子 Skill → Skill 编辑器；Flow → Flow 编辑器 |
| 状态标记 | 已安装/未安装、版本号、接口分级统计 |
| 快捷操作 | 一键 build、install、validate |

### Skill 编辑器功能

| 功能 | 说明 |
|------|------|
| 接口列表编辑 | 增删改接口（id/summary/method/path/level/params） |
| bodyTemplate 编辑 | JSON 编辑器（语法高亮 + 校验） |
| 枚举管理 | 编辑模块枚举 / 引用共享枚举 |
| 人工字段编辑 | notes / examples / outputFields / customSections |
| 实时预览 | 右侧实时渲染生成的 SKILL.md（Markdown 预览） |
| 保存 | 写入 `apis/{project}/{module}.json` + 自动 build |
| 版本信息 | 显示/编辑模块版本号 |

### Skill 编辑器 API

```
GET  /api/skills                    # 列出所有模块（从 apis/ 扫描）
GET  /api/skills/:project/:module   # 获取模块注册表 JSON
PUT  /api/skills/:project/:module   # 保存模块注册表
POST /api/skills/:project/:module/build  # 触发生成 SKILL.md
GET  /api/enums/:project            # 列出共享枚举
GET  /api/preview/:project/:module  # 预览生成的 SKILL.md（不写入）
```

### 实现要点

- 复用 flow-editor 的 server.mjs 模式（纯 Node.js，无框架）
- 门户 server 做路由分发：`/flow/*` 代理到 flow-editor，`/skill/*` 代理到 skill-editor
- 或者更简单：三个功能合并到一个 server.mjs，按路径前缀分发
- 前端复用 skills.html 的卡片渲染逻辑 + flow-editor 的编辑交互模式

---

## 三、API 请求架构升级（参考 larksuite/cli）

### 飞书 CLI 架构要点（可借鉴）

| 层 | 飞书实现 | anycli 对应 |
|----|---------|-------------|
| `internal/client/` | 统一 APIClient，所有请求单一入口 | `src/core/client.ts`（已有，需增强） |
| `internal/apicatalog/` | API 目录解析（method + path → 具体调用） | `apis/` 注册表 + `skill-builder.ts`（已有） |
| `internal/client/pagination.go` | 自动分页聚合 | **缺失** |
| `internal/client/api_errors.go` | 集中错误分类 | `src/core/errors.ts`（已有，需增强） |
| `internal/output/` | 多格式输出 + jq 过滤 + envelope | `src/core/output.ts`（基础） |
| `internal/cmdpolicy/` | 命令策略（deny/validate/audit） | **缺失** |
| `internal/binding/` | 参数绑定 + secret 解析 | **缺失** |

### 升级方案

#### 3.1 统一请求入口增强（`src/core/client.ts`）

```typescript
// 现有：createClient(project) → { get, post, put, delete, request }
// 升级为：

interface ClientMiddleware {
  onRequest?(ctx: RequestContext): RequestContext | Promise<RequestContext>;
  onResponse?(ctx: ResponseContext): ResponseContext | Promise<ResponseContext>;
  onError?(error: AnycliError, ctx: RequestContext): AnycliError | Promise<AnycliError>;
}

interface RequestContext {
  project: string;
  method: string;
  path: string;
  apiId?: string;        // 按注册表 id 调用时自动填充
  level?: string;        // read/write/dangerous
  headers: Record<string, string>;
  body?: unknown;
  query?: Record<string, unknown>;
  timeout: number;
  retryCount: number;
}
```

新增能力：
- **按 id 调用**：`anycli request demo --api order-list-page --body '{...}'`
  - 从注册表解析 method/path/bodyTemplate
  - 自动校验必填参数
- **中间件链**：请求前/后/错误三阶段拦截
- **重试**：网络错误 / 5xx 自动重试（可配置次数）
- **分页聚合**：`--paginate` 自动翻页合并结果

#### 3.2 操作分级拦截（参考 cmdpolicy）

```typescript
// src/core/policy.ts

interface PolicyRule {
  level: 'write' | 'dangerous';
  action: 'confirm' | 'deny' | 'audit';
  condition?: (ctx: RequestContext) => boolean;
}

// prod 环境下：
// - read: 直接执行
// - write: 需确认（--non-interactive 时拒绝）
// - dangerous: 需确认 + 审计日志
```

审计日志写入 `~/.anycli/audit.log`：
```json
{"ts":"2026-08-02T15:00:00Z","project":"demo","api":"order-get","level":"read","profile":"default","status":200}
```

#### 3.3 目录结构升级

```
src/core/
├── client.ts           # 统一请求客户端（增强：中间件、重试）
├── policy.ts           # 操作策略（分级拦截、审计）  ← NEW
├── pagination.ts       # 分页聚合器              ← NEW
├── errors.ts           # 错误分类（已有，增强）
├── output.ts           # 输出格式化（已有）
├── skill-builder.ts    # 注册表 → SKILL.md（已有）
├── grounding.ts        # 接地校验（已有）
├── discovery.ts        # 自动发现（已有）
├── routing.ts          # 路由表（已有）
├── flow-compiler.ts    # flow 编译（已有）
├── flow-parser.ts      # flow 解析（已有）
├── flow-version.ts     # flow 版本（已有）
└── java-parser.ts      # Java 解析（已有）
```

#### 3.4 按 id 调用（`anycli request` 增强）

```bash
# 现有：按 path 调用
anycli request demo POST /api/order/listForEsPage --body '{"pageNum":1}'

# 新增：按 id 调用（从注册表解析）
anycli request demo --api order-list-page --body '{"pageNum":1}'

# 自动展开 bodyTemplate + 参数校验
anycli request demo --api order-list-page --set data.keyword=美妆

# 分页聚合
anycli request demo --api order-list-page --paginate --body '{"pageSize":100}'
```

实现：
1. `--api <id>` 从 `buildApiIndex()` 解析出 method/path/bodyTemplate
2. `--set key=value` 合并到 bodyTemplate（dot notation）
3. `--paginate` 自动递增 pageNum 直到无更多数据
4. level 为 write/dangerous 时触发 policy 拦截

---

## 四、实施顺序

| 阶段 | 内容 | 预估工作量 |
|------|------|-----------|
| **Phase 1** | 统一门户 + Skill 编辑器 | 2-3 天 |
| Phase 1.1 | portal server + 首页（从 skills.html 数据驱动改为 API 驱动） | 1 天 |
| Phase 1.2 | skill-editor 前端（接口编辑 + JSON 编辑 + 预览） | 1-2 天 |
| **Phase 2** | API 请求架构升级 | 2 天 |
| Phase 2.1 | client 中间件 + 重试 + 按 id 调用 | 1 天 |
| Phase 2.2 | policy 分级拦截 + 审计日志 | 0.5 天 |
| Phase 2.3 | 分页聚合器 | 0.5 天 |
| **Phase 3** | 体验打磨 | 1 天 |
| Phase 3.1 | 门户 ↔ 编辑器 ↔ CLI 联动（编辑器保存后自动 install） | 0.5 天 |
| Phase 3.2 | 编辑器内接口测试（填参数 → 发请求 → 看结果） | 0.5 天 |

---

## 五、技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 编辑器框架 | 原生 JS（无框架） | 与 flow-editor 一致，零依赖，单文件部署 |
| 服务端 | 纯 Node.js http 模块 | 与 flow-editor 一致，无 express 依赖 |
| 门户与编辑器关系 | 合并为一个 server | 减少端口占用，统一入口 |
| JSON 编辑 | CodeMirror CDN 或 textarea + 校验 | 轻量优先，后续可升级 |
| Markdown 预览 | 复用 flow-editor 的 marked.min.js | 已有 vendor 文件 |
| 分页协议 | 读取注册表 bodyTemplate 中的 pageNum/pageSize 字段 | 适配现有后端分页模式 |
| 审计存储 | append-only JSONL 文件 | 简单可靠，无需数据库 |

---

## 六、与现有系统的关系

```
                    ┌─────────────────────────────────┐
                    │     anycli edit (统一门户)        │
                    │  localhost:3200                  │
                    ├────────────┬────────────────────┤
                    │ /skill/*   │  /flow/*           │
                    │ Skill编辑器│  Flow编辑器(现有)    │
                    └─────┬──────┴────────┬───────────┘
                          │               │
                          ▼               ▼
                    apis/*.json      flow.json
                          │               │
                          ▼               ▼
                 anycli skill build  anycli flow build
                          │               │
                          ▼               ▼
                    skills/*/SKILL.md (产物)
                          │
                          ▼
                 anycli request --api <id>  ← 按 id 调用（新增）
                          │
                          ▼
                 src/core/client.ts (统一请求)
                          │
                    ┌─────┼─────┐
                    ▼     ▼     ▼
                 policy  retry  pagination
```
