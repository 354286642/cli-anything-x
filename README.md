# CLI-Anything-X

从后端接口与参数一键生成可执行的 AI 技能（Skill），并支持把多个技能编排成业务流程（Flow）。支持浏览器录制真实操作（Live Lens）自动产出流程型 Skill，通过 agent 直接调用 cli-anything-x 产出的内容即可操作你的业务系统。

> 目前暂只支持从 Java 项目获取接口，其他语言后续支持。

## 特性

- 🔌 **多业务系统接入** — 一个 CLI 统一接入多个业务系统（demo、cli-anything-x 等）
- 📦 **接口注册与自动生成** — 从 Java Controller 解析接口，统一维护参数、枚举、示例和业务补充信息，并生成对应 Skill
- 🧩 **流程 Skill 一键编排与自动完善** — 在流程步骤页组合已有业务能力，自动生成包含字段、前置条件、错误处理和验证资料的流程初稿，并通过接地校验保障可执行
- 🖥️ **统一 Skill 工作台** — 新增项目和 Skill 自动发现，在线完成接口注册、Skill 管理、Flow 编排、预览、编译和导出
- 🧬 **技能强化** — 分析 Java service 链路，补充业务规则、参数校验、调用链路和异常场景
- 📥 **可执行技能包导出** — 支持普通配置版和通过 MCP 动态获取 sessionId 的飞书版，导出自包含技能包供未安装 CLI 的业务方使用
- 👤 **多 Profile** — 支持多环境、多租户和独立会话配置
- 🧪 **Live Lens（测试中）** — 通过浏览器录制操作和网络请求，自动生成流程 Skill

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
anycli auth login           # 浏览器登录（成功后可一键开启每 8 小时定时刷新保活）
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

框架随包自带两个合成内容用于开箱体验：`skills/anycli`（主入口 Skill）与 `skills/demo`（示例项目），它们只读、不随业务数据混在一起。

新用户拉取代码后：

```bash
npm install -g cli-anything-x     # 全局安装（skills/anycli、skills/demo 随包发布）
anycli config init                # 首次运行自动创建 ~/.anycli，交互式完成配置
anycli init <project>             # 一键接入业务系统，生成 ~/.anycli/apis/{project}/、~/.anycli/skills/{project}/
anycli skill install              # 安装技能到 ~/.agents/skills/
```

### 团队协作 / 私有数据仓（指定工作目录）

建一个**私有数据仓**，内容即工作目录（`config.json`、`apis/`、`skills/`、`src/projects/` 平铺在仓库根即可）。克隆到本地后，在 `config.json` 中指定其路径作为工作目录（或设 `ANYCLI_WORKSPACE` 环境变量），即可多机共享同一套业务数据：

```bash
git clone <私有数据仓> /path/to/workspace
anycli config set workspace /path/to/workspace   # 或 export ANYCLI_WORKSPACE=/path/to/workspace
```

`config.json` 含本机会话凭证，建议加入 `.gitignore` 不入库。框架仓保持干净（只含代码与合成示例），业务数据在私有仓独立演进、独立权限。

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
├── auth                              # 认证管理
│   ├── login [--session-id <id>]     # 登录
│   ├── status                        # 登录状态
│   ├── logout                        # 登出
│   └── set-session <id>              # 设置 sessionId（CI/CD）
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
