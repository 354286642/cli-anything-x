---
name: anycli
description: >
  cli-anything-x 主入口（命令名 anycli）。企业级 Agent-Friendly 命令行工具，统一操作多个业务系统。
  本 Skill 负责：认证、配置、全局选项说明，以及路由到各子 Skill。
triggers:
  - anycli
  - 登录
  - 配置
  - auth
  - config
  - sessionId
---

# cli-anything-x 主入口

## 概述

cli-anything-x（命令名 `anycli`）是统一业务系统接入框架：一个 CLI 接入多个业务系统（`{project}` 维度），
让 AI Agent 能直接通过命令行操作后端 API。各业务系统的接口注册表、认证策略、Profile 均由配置与
Workspace 数据承载，框架本体不绑定任何特定业务。

## Skill 组织规范（Agent 扩展指南）

本 CLI 的 Skill 以「项目」为顶层维度组织，区分「原子 Skill」与「流程 Skill」两类，
并通过 `_shared/` 沉淀共享字典。新增模块/流程时必须遵守。
完整目录约定见仓库根目录 `DIRECTORY.md`；流程编写规范见根目录 `FLOW-SPEC.md`。

### 目录结构

```
skills/
├── anycli/SKILL.md                        ← 你正在看的文件（主入口 + 公共能力）
├── _shared/                               ← 跨项目共享字典（预留）
└── {project}/                             ← 项目=顶层维度（如 demo、cli-anything-x）
    ├── {module}/SKILL.md                  ← 原子 Skill：{module} 模块接口字典
    ├── _shared/                           ← 模块内共享字典
    │   └── {name}-enums.md
    └── flows/                             ← 流程 Skill（业务剧本）
        └── {business}/
            ├── SKILL.md                   ← 流程主线（目标/话术/步骤/决策）
            └── reference/                 ← 流程独有资料（按需加载）
                ├── fields.md
                ├── examples.md
                └── verify.md
```

### 命名规范（name 与路径解耦）

- 目录：`skills/{project}/{module}/SKILL.md`，项目为顶层维度（demo、cli-anything-x...）。
- frontmatter `name`：逻辑 id，不随目录变化。
  - 原子 Skill：`{project}-{module}`，如 `demo-order`。
  - 流程 Skill：`flow-{project}-{business}`，如 `flow-demo-create-sample`，并带 `type: flow`。
- 流程目录用「动词-名词」语义命名，如 `flows/create-sample-requirement/`。

### 三层范式（拆分原则）

| 层 | 位置 | 放什么 |
|----|------|--------|
| 执行主线 | `SKILL.md` | 目标、话术模板、有序步骤、决策规则、成功标准；Agent 执行时必读 |
| 流程独有资料 | `{flow}/reference/*.md` | 字段词典、话术示例、校验清单等，体量大、按需加载 |
| 共享字典 | `_shared/*.md` | 多个 Skill/流程复用的枚举、字段词典 |

拆分判据：

- 单个 SKILL.md 建议不超过 ~200 行；超出则把「参考资料」下沉到 `reference/`。
- 枚举/字段词典被 ≥2 处复用 → 提到 `_shared/`；仅单流程使用 → 放 `reference/`。
- 确定性步骤进 SKILL.md；需要 Agent 判断的领域规则用自然语言写清。

### 何时新建 Skill

| 条件 | 动作 |
|------|------|
| 新项目接入 | 新建 `skills/{project}/{module}/SKILL.md` |
| 现有模块命令超过 15 个 | 拆分为子模块目录 |
| 一个业务流程需串联多个原子命令 | 新建 `skills/{project}/flows/{business}/SKILL.md`（流程 Skill） |
| 模块有独立触发词和场景 | 独立为一个原子 Skill |

### 原子 Skill 模板

```markdown
---
name: {project}-{module}
description: >
  一句话描述模块能力。
triggers:
  - 触发词1
  - 触发词2
---

# {模块中文名}

## 命令列表
| 命令 | 说明 |
|------|------|

## 常见场景
### 场景：xxx
1. 步骤...

## 错误处理
| 错误码 | 处理 |
|--------|------|
```

### 流程 Skill 模板

```markdown
---
name: flow-{project}-{business}
description: >
  业务流程：一句话描述要达成的业务目标。
type: flow
triggers:
  - 触发词1
---

# {业务流程名}

## 业务目标 / 适用场景
## 标准话术模板（可预填 + 用户可改）
## 前置条件
## 有序步骤（每步映射到原子命令）
## 字段依赖与决策规则
## 错误处理
## 成功标准
```

## 认证（所有项目共用）

认证采用可插拔的 AuthStrategy，按项目在配置中指定类型；内置 `session-id` 与 `bearer-token` 两种，
后续可扩展 oauth2 / api-key 等。

### 登录

```bash
anycli auth login                    # 交互式登录（按项目配置的策略）
anycli auth login --session-id <id>  # 直接设置 session-id
anycli auth token <project>          # 交互输入 bearer-token 并写入配置（--token <t> 直传）
anycli auth set-session <id>         # 脚本/CI 用（session-id）
```

### 检查状态 / 登出

```bash
anycli auth status
anycli auth logout
```

### 环境变量（CI/CD）

```bash
export ANYCLI_SESSION_ID=xxx
anycli request cli-anything-x POST /api/example --body '{}'
```

## 配置

```bash
anycli config init       # 交互式初始化（Profile、网关、登录 URL、认证）
anycli config list       # 查看当前配置
anycli config set <key> <value>
anycli config profile    # Profile 管理（create/delete/list/show）
```

### Profile 与环境

配置按 Profile 组织，每个 Profile 独立保存 `env`、`gatewayUrl`、`loginUrl`，切换环境即切换 Profile：

```bash
anycli config profile create test
anycli config profile create prod
anycli config profile show
```

### 请求 Headers（自动携带）

| Header | 说明 | 来源 |
|--------|------|------|
| 认证头 | 按项目 AuthStrategy 注入（如 x-session-id / Authorization: Bearer） | `auth` 配置 |
| 自定义头 | 由 `auth.extraHeaders` 配置（如租户标识 x-tenant-id / x-ext-tenant-id） | `auth` 配置 |

> 具体项目需要固定附加的请求头（如多租户标识），在项目配置的 `auth.extraHeaders` 中声明，
> 框架不会硬编码任何业务 Header。

## 通用接口调用（request）

当某个接口尚未封装成专属命令时，可用 `request` 直接调用任意已配置项目的后端接口，**无需为每个项目单独写命令**。
project 仅作为参数传入，用于解析该系统的请求前缀与认证/租户配置，差异由配置承担。

```bash
anycli request <project> <method> <path> [--body <json>] [--query <json>] [--timeout <ms>] [--format <format>]
```

| 参数 / 选项 | 说明 |
|-------------|------|
| project | 已配置的项目名（如 demo），决定请求前缀与认证/租户配置 |
| method | GET \| POST \| PUT \| DELETE |
| path | 接口路径 |
| --body <json> | 请求体 JSON（POST/PUT 用） |
| --query <json> | 查询参数 JSON（拼到 URL） |
| --timeout <ms> | 超时毫秒，默认 30000 |
| --format | 输出格式 json \| table \| text |

### 示例

```bash
# POST 带请求体
anycli request demo POST /api/example --body '{}'

# GET 带查询参数
anycli request demo GET /api/example/getDetail --query '{"id":"123"}'
```

> 多数接口直接在各自 Skill 里以「接口清单」登记（路径/方式/参数），通过 `request` 调用，无需专属命令；
> 仅当接口需要分页聚合、参数校验、输出重塑等真实逻辑时，才单独封装为专属命令。

## 全局选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| --format json\|table\|text | 输出格式 | json |
| --env test\|prod | 环境 | test |
| --profile <name> | 指定 Profile | 当前激活 |
| --verbose | 打印请求调试日志 | false |
| --non-interactive | 禁止交互提示 | false |
| --quiet | 静默模式 | false |

## 输出格式

成功：
```json
{ "success": true, "data": { ... } }
```

失败：
```json
{ "success": false, "error": { "code": "AUTH_EXPIRED", "message": "...", "hint": "anycli auth login" } }
```

## 退出码

| 码 | 含义 |
|----|------|
| 0 | 成功 |
| 1 | 通用错误 |
| 2 | 参数错误 |
| 3 | 认证错误 |
| 4 | 权限不足 |
| 5 | 资源不存在 |
| 6 | 网络错误 |

## 子 Skill 路由

| 用户意图 | 加载 Skill |
|----------|-----------|
| 临时调用接口、未封装接口、验证新接口（request 命令） | 本 Skill (anycli) |
| 登录、配置、认证 | 本 Skill (anycli) |
| 属于某业务项目的接口操作 | 对应项目的原子 / 流程 Skill（`{project}-{module}` / `flow-{project}-{business}`） |
