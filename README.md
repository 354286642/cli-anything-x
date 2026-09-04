# CLI-Anything-X

从后端接口与参数一键生成可执行的 AI 技能（Skill），并支持把多个技能编排成业务流程（Flow）。支持浏览器录制真实操作（Live Lens）自动产出流程型 Skill，通过 agent 直接调用 cli-anything-x 产出的内容即可操作你的业务系统。

> 目前暂只支持从 Java 项目获取接口，其他语言后续支持。

## 特性

- 🔌 **多业务系统接入** — 一个 CLI 统一接入多个业务系统（demo、cli-anything-x 等）
- 📦 **接口注册与自动生成** — 从 Java Controller 解析接口，统一维护参数、枚举、示例和业务补充信息，并生成对应 Skill
- 🧩 **流程 Skill 一键编排与自动完善** — 在流程步骤页组合已有业务能力，自动生成包含字段、前置条件、错误处理和验证资料的流程初稿，并通过接地校验保障可执行
- 🖥️ **统一 Skill 工作台** — 新增项目和 Skill 自动发现，在线完成接口注册、Skill 管理、Flow 编排、预览、编译和导出
- 🧬 **技能强化** — 分析 Java service 链路，补充业务规则、参数校验、调用链路和异常场景
- 📥 **可执行技能包导出** — 导出自包含技能包供未安装 CLI 的业务方使用（普通配置版通用可用；另有飞书版，见文末说明）
- 👤 **多 Profile** — 支持多环境、多租户和独立会话配置
- 🧪 **Live Lens（测试中）** — 通过浏览器录制操作和网络请求，自动生成流程 Skill

> **飞书版导出说明**：通过 MCP 动态获取 sessionId 的飞书版，需要企业自建 MCP 凭证服务并接入飞书登录链路，属企业内部/私有化场景的可选能力，并非所有环境都具备该配置；通用场景请使用普通配置版。

## 安装

```bash
# 全局安装（anycli 命令常驻 PATH，Agent Skill 可直接调用）
npm install -g cli-anything-x

# 本地开发
cd cli-anything-x && npm install && npm run build && npm link
```

## 快速开始

```bash
anycli config init          # 选择环境（默认正式）、输出格式
anycli auth login           # 选择授权方式（session-id / bearer-token）并浏览器授权，可配置凭证自动刷新
anycli init cli-anything-x   # 一键接入新业务系统（配置 + 注册表 + Skill 一步到位）
anycli skill install        # 安装 Skill 到 ~/.agents/skills/
anycli request cli-anything-x POST /api/example --body '{}'  # 调用业务接口
```

> 已有项目添加接口：`anycli gen`；已有项目添加 Profile 配置：`anycli config add-project`

## 框架与业务数据（Workspace）

`cli-anything-x` 是**框架**：它本身不含任何业务数据。业务数据——配置 `config.json`、接口注册表 `apis/`、AI Skill 与流程 `skills/`、专属命令 `src/projects/`——统一放在一个**工作目录（Workspace）**里，框架通过它读取数据。

**工作目录解析优先级**：`ANYCLI_WORKSPACE` 环境变量 > `~/.anycli/config.json` 的 `workspace` 字段 > `~/.anycli`（默认）。

### 默认工作目录（~/.anycli）

默认工作目录就是 `~/.anycli`，框架首次运行自动创建，配置与产出天然在一起：

```
~/.anycli（默认 Workspace，配置与产出统一）
├── config.json                  # 配置（Profile、网关、登录 URL、认证）
├── apis/{project}/{module}.json # 接口注册表
├── skills/{project}/            # 生成的 Skill 与流程
└── src/projects/                # 专属命令（可选）
```

### 团队协作 / 私有数据仓（指定工作目录）

建一个**私有数据仓**，内容即工作目录（`config.json`、`apis/`、`skills/`、`src/projects/` 平铺在仓库根即可）。克隆到本地后，在 `config.json` 中指定其路径作为工作目录（或设 `ANYCLI_WORKSPACE` 环境变量），即可多机共享同一套业务数据：

```bash
git clone <私有数据仓> /path/to/workspace
anycli config set workspace /path/to/workspace   # 或 export ANYCLI_WORKSPACE=/path/to/workspace
```

`config.json` 含本机会话凭证，建议加入 `.gitignore` 不入库。框架仓保持干净（只含代码与合成示例），业务数据在私有仓独立演进、独立权限。

## 配置文件（config.json）

配置存在工作目录根的 `config.json`（默认 `~/.anycli/config.json`）。整个 CLI 只有一份配置，按 Profile 分环境；每个 Profile 独立保存环境、网关、登录地址与授权。

> JSON 本身不支持注释，下面的 `#` 只是说明性标注，实际文件中不要写入。

```json
{
  "activeProfile": "default",                        # 当前生效的 Profile 名
  "defaultFormat": "json",                           # 输出格式 json | table | text
  "workspace": "C:\\code\\my-data",                  # 可选：指定其他目录为工作目录（团队/私有数据仓形态）
  "profiles": {
    "test": {                                        # Profile 名，切换环境即切换 Profile
      "env": "test",                                 # 环境标识 test | prod | dev
      "gatewayUrl": "https://api.example.com",       # 网关地址（整个 Profile 一份，项目默认请求基址）
      "loginUrl": "https://login.example.com",       # 浏览器授权登录页地址
      "sessionId": "xxx",                            # session-id 凭证（auth login 写入，勿手填）
      "sessionUpdatedAt": 1788396782368,             # 凭证刷新时间戳（毫秒，auth refresh 自动写入，勿手填）
      "auth": {
        "type": "session-id",                        # 授权方式：session-id | bearer-token（整套一套，跟随 Profile）
        "token": "xxx",                              # bearer-token 凭证（仅 bearer-token 方式用）
        "refreshUrl": "https://api.example.com/user/refresh",  # 凭证刷新接口（必须完整 URL，不配置则不自动刷新）
        "refreshIntervalMs": 28800000,               # 刷新间隔（毫秒，8 小时 = 28800000）
        "extraHeaders": {                            # 可选：仅【刷新接口】用的静态请求头（如租户头）
          "x-tenant-id": "demo-service"
        },
        "credentialStore": "file",                   # 凭证存储：file（config.json，默认）| keychain（系统钥匙串）
        "warnInsecureHttp": true                     # 传输安全：http 明文 URL 是否提示风险（默认 true，false 关闭提示）
      },
      "projects": {                                  # 业务系统接入
        "demo": {
          "prefix": "demo-service",                  # 网关路由前缀（请求 URL = 网关 + / + prefix + 路径）
          "auth": {
            "extraHeaders": {                        # 可选：每次【业务请求】附加的静态请求头（如多租户标识）
              "x-tenant-id": "demo-service",
              "x-ext-tenant-id": "demo-service"
            }
          }
          # 一般不写 baseUrl：默认走 Profile gatewayUrl；仅当项目需独立网关/直连独立服务时才写
          # "baseUrl": "https://gateway.example.com"
        }
      }
    }
  }
}
```

**请求基址与 URL 拼接**

- 项目请求 URL 统一为：`网关 + / + prefix + 路径`（如 `https://api.example.com/demo-service/api/order/list`）。
- 网关默认取 Profile 级 `gatewayUrl`（整个环境一份，所有项目共用）；`config add-project` 不会重复写入 `baseUrl`。
- 项目级 `baseUrl` 是**可选覆盖**：仅当某个项目不跟大部队走同一个网关（如直连独立服务、on-prem 内网地址）时才写，未写时自动用 `gatewayUrl`。

**授权方式与凭证**

- 整个 CLI 只保留一套授权（session-id / bearer-token），跟随当前 Profile 环境，不按项目细分。
- 用 `anycli auth login` 选择授权方式并写入凭证（`sessionId` / `auth.token`）；也可 `anycli config set auth-type session-id|bearer-token` 切换。
- 凭证自动刷新：`auth.refreshUrl`（必须完整 URL，含协议与域名）与间隔 `auth.refreshIntervalMs` 由用户自填；刷新接口返回体约定 `{ success, data: { sessionId | token } }`。刷新成功后 `sessionUpdatedAt` 会自动写入最近刷新时间戳。

**凭证存储（credentialStore）**

- 新建 Profile 时，`config.json` 会默认写入 `credentialStore: "file"` 与 `warnInsecureHttp: true`，可直接改文件或用 `config set` 调整。
- `file`（默认）：凭证明文存于本地 `config.json`，配置简单、跨机器可移植；`.gitignore` 已排除，适合个人使用。
- `keychain`：凭证存入**系统钥匙串**（Windows Credential Manager / macOS Keychain / Linux libsecret），`config.json` 不再落明文；依赖 `@napi-rs/keyring`（可选依赖，安装失败自动降级回 `file` 并提示）。切换：`anycli config set auth.credential-store keychain`（或 `file`）。
  - 钥匙串条目按「工作目录 + Profile + 凭证类型」隔离（service=`anycli`），多项目/多环境互不串用。
  - 注意：`keychain` 下凭证不在 `config.json` 中，备份/迁移环境需重新 `anycli auth login`。
- `keychain` 写入失败时自动降级为 `file` 并给出警告，凭证不会丢失。

**传输安全（warnInsecureHttp）**

- 默认 `true`：当 `gatewayUrl` / `loginUrl` / `refreshUrl` / 业务请求基址为 `http://` 明文时，CLI 会输出一次风险提示，提醒生产环境应使用 https。
- 仅内网开发环境确需 http 时，可关闭提示：`anycli config set auth.warn-insecure-http false`。

**请求头（两个 extraHeaders 的区分）**

- **项目 `auth.extraHeaders`**：每次**业务请求**附加的静态请求头（如多租户标识 `x-tenant-id` / `x-ext-tenant-id`），框架不硬编码任何业务 Header。
- **`Profile.auth.extraHeaders`**：仅**凭证刷新接口**请求附加的静态请求头（如刷新接口也需要租户头时）；与业务请求无关。
- 兼容遗留字段：项目顶层 `tenantId` / `extTenantId` 仍可读取，等价于项目 `extraHeaders` 里的 `x-tenant-id` / `x-ext-tenant-id`；新配置建议直接用 `extraHeaders`。

**团队协作 / 私有数据仓**

- 本机 `config.json` 含个人凭证（sessionId / token），务必加入 `.gitignore` 不入库。
- 需要共享的"环境 + 项目 + 租户头"模板可放私有仓（如 `config/company.json`），个人凭证留本地，参见上节「团队协作 / 私有数据仓」。

## 文档

| 文档 | 内容 |
|------|------|
| [接口注册表](docs/api-registry.md) | 注册表 schema、目录结构、合并策略、与 flow 的关系 |
| [Skill 构建](docs/skill-build.md) | `anycli skill build` / `validate`，从注册表生成 SKILL.md |
| [工作流管理](docs/flow.md) | flow 创建/编辑/编译/接地校验/版本管理 |
| [代码生成](docs/gen.md) | `anycli gen` 从 Java Controller 解析接口 |
| [架构设计](docs/architecture.md) | 自动发现、数据流、目录约定、技术栈 |
| [多 Profile](docs/profile.md) | 多环境/多租户隔离、认证、配置文件 |
| [技能总览页](docs/skill-docs.md) | 可视化 HTML 页面生成与使用 |
| [统一编辑器](docs/editor.md) | 在线编辑门户（Skill + Flow 可视化编辑 + 接口测试） |
| [Live Lens](docs/live-lens.md) | 测试中的浏览器录制功能：抓取操作与网络请求并生成流程 Skill |
| [Rich Skill 方案](docs/proposal-rich-skill-gen.md) | 行为剧本 Skill 设计与生成规范 |
| [目录规范](DIRECTORY.md) | skills/ 目录组织与命名规范 |
| [流程规范](FLOW-SPEC.md) | flow.json 编写规范与接地要求 |

## 命令总览

```
anycli
├── auth                              # 认证管理（整个 CLI 一套，跟随 Profile）
│   ├── login [--type session-id|bearer-token]  # 选择授权方式并浏览器授权
│   ├── login --session-id <id> / --token <t>   # 直接设置凭证（CI/CD）
│   ├── token [project]               # 交互输入 bearer-token（Profile 级；project 已废弃）
│   ├── refresh                       # 手动触发一次凭证刷新（session-id / token）
│   ├── scheduler install|uninstall   # 定时自动刷新（间隔取 Profile.auth.refreshIntervalMs）
│   ├── status / logout               # 状态 / 登出
│
├── config                            # 配置管理
│   ├── init                          # 初始化配置
│   ├── add-project                   # 交互式接入新业务模块
│   ├── list / set / get              # 查看/设置
│   └── profile                       # Profile 管理（create/delete/list/show）
│
├── request <project> [method] [path] # 通用接口调用
│   ├── --set <key=value>             # 设置 body 字段（dot notation） ← NEW
│   ├── --paginate                    # 自动分页聚合 ← NEW
│   └── --yes                         # 跳过确认（write/dangerous） ← NEW
│
├── skill                             # Skill 管理
│   ├── build [project] [module]      # 从注册表生成 SKILL.md ← NEW
│   ├── validate [project]            # 校验注册表格式 ← NEW
│   ├── install [--force]             # 安装到 ~/.agents/skills/
│   ├── list                          # 已安装列表
│   ├── uninstall                     # 卸载
│   └── docs [--open]                 # 生成技能总览页
│
├── flow                              # 工作流管理
│   ├── list                          # 列出所有工作流
│   ├── init <project> <business>     # 创建新工作流骨架
│   ├── record <project> <business>   # Live Lens 录制浏览器操作并生成工作流（测试中）
│   ├── enrich <flow-path>             # 以流程结束接口反向补全 Flow
│   ├── enhance <flow-path>            # enrich 的同义入口（--end-api / --apply）
│   ├── edit [path]                   # 启动 Web 可视化编辑器
│   │                                  #   流程步骤页可从项目/Skill/API 目录导入并生成流程初稿
│   ├── build [path] [--all]          # 编译 flow.json → SKILL.md（含接地校验）
│   ├── import <skill-md-path>        # 导入现有 SKILL.md 为 flow.json
│   ├── version <path>                # 查看版本信息 ← NEW
│   └── history <path>                # 查看编辑历史 ← NEW
│
├── gen                               # 交互式创建子模块 / 添加接口
│
├── init <project> [--source <path>]  # 一键接入新业务系统（配置+注册表+Skill） ← NEW
│
├── edit [--port <port>]              # 启动统一编辑器（门户 + Skill/Flow 在线编辑 + 强化 + 技能包下载） ← NEW
│
├── {project}                         # 自动发现的业务项目（如 demo）
│
└── 全局选项
    --format <json|table|text>        # 输出格式（默认 json）
    --env <test|prod>                 # 环境
    --profile <name>                  # 指定 Profile
    --verbose                         # 打印请求调试日志
    --non-interactive                 # 禁止交互
    --quiet                           # 静默模式
```

## 开发

```bash
npm install                 # 安装依赖
npx tsx src/index.ts --help # 开发模式（免编译）
npm run build               # 编译
npm test                    # 运行测试（vitest）
npm link                    # 本地全局链接
```

## 技术栈

TypeScript / Node.js >= 18 / Commander.js / Vitest / Chalk / Inquirer / Conf

## License

MIT
