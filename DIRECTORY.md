# CLI-Anything-X 目录约定

本文档定义 `cli-anything-x` 的目录组织规范。所有新增项目、模块、流程 Skill 必须遵守。
流程 Skill 的编写规范另见根目录 `FLOW-SPEC.md`。

## 1. 顶层结构

```
cli-anything-x/
├── src/                    # TypeScript 源码
│   ├── core/               # 核心框架（auth/client/config/output/errors/java-parser/skill-docs）
│   ├── commands/           # 全局命令（auth/config/skill/gen）
│   ├── projects/           # 业务项目源码（命令实现）
│   │   └── {project}/{module}/index.ts
│   └── index.ts            # CLI 入口
├── skills/                 # AI Agent Skills（本规范核心，见 §2）
├── docs/                   # 技能总览页（skills.html，anycli skill docs 生成）
├── bin/anycli.js           # npx 入口
├── DIRECTORY.md            # 本文件
├── FLOW-SPEC.md            # 流程 Skill 编写规范
├── package.json
└── tsconfig.json
```

`src/projects/` 与 `skills/` 通过「项目名 + 模块名」对应（**仅限专属命令模式**）：如 `src/projects/demo/sample/` 的命令对应 `skills/demo/sample/SKILL.md`。接口清单模式的原子 Skill 无 src 实现（见 §2.2、§2.6）。
`src/projects/demo/order/` 的命令对应 `skills/demo/order/SKILL.md`。

## 2. skills 目录规范（核心）

### 2.1 项目 = 顶层维度

`skills/` 下第一层目录即「项目」（demo、acme、cli-anything-x...），项目内再分模块。

```
skills/
├── anycli/SKILL.md                 # 主入口（认证/配置/组织规范/路由），固定存在
├── _shared/                        # 跨项目共享字典（预留，被 >=2 个项目复用时启用）
└── demo/                         # 项目
    ├── order/SKILL.md             # 原子 Skill
    ├── launch/SKILL.md
    ├── sample/SKILL.md
    ├── effect/SKILL.md
    ├── _shared/                    # 模块内共享字典（被 demo 内 >=2 处复用）
    │   └── sample-enums.md
    └── flows/                      # 流程 Skill（业务剧本）
        └── create-sample-requirement/
            ├── SKILL.md
            └── reference/
                ├── fields.md
                ├── examples.md
                └── verify.md
```

### 2.2 两类 Skill

| 类型 | 定位 | 目录 | frontmatter |
|------|------|------|-------------|
| 原子 Skill | 一组相关接口的能力字典（接口路径/方式/参数） | `{project}/{module}/SKILL.md` | `name: {project}-{module}` |
| 流程 Skill | 串联多个接口调用的业务剧本（达成某业务目标） | `{project}/flows/{business}/SKILL.md` | `name: flow-{project}-{business}` + `type: flow` |

原子 Skill 是「词汇」，流程 Skill 是「篇章」；流程 Skill 通过引用原子接口落地，不重复实现。

#### 原子 Skill 的两种实现模式

按「是否有专属 TS 命令」分两种模式，**优先用接口清单模式**：

| 模式 | 调用方式 | src 实现 | 适用 |
|------|----------|----------|------|
| 接口清单模式（默认） | 通用命令 `anycli request {project} <METHOD> <path>` | 无（不写 TS） | 薄壳接口：拼 body -> POST -> 输出，无特殊逻辑。新增接口默认走这个，零代码、无需编译 |
| 专属命令模式 | 专属命令 `anycli {project} {module} {action}` | `src/projects/{project}/{module}/index.ts` | 接口需要分页聚合、参数校验、输出重塑、多步编排等真实逻辑 |

判据：这个接口除了「拼 body -> POST -> 输出」还干别的吗？

- 否 -> 接口清单模式（skill 里登记接口即可）。
- 是 -> 专属命令模式（写 TS）。

> 接口路径与参数只在 skill 维护一份，避免 skill 与 TS 双重维护导致漂移。
> `anycli gen` 当前产出专属命令模式代码；接口清单模式暂由手工 / Agent 辅助编写。
> 参考样板：`skills/demo/order/SKILL.md`（接口清单模式）。

### 2.3 name 与路径解耦

- frontmatter `name` 是 Skill 的逻辑 id，**不随目录层级变化**，是 Agent 路由与 `anycli skill list` 展示的依据。
- 目录路径承载「项目 / 模块 / 流程」的物理组织，可重构而不影响逻辑 id。
- 命名规则：
  - 原子：`{project}-{module}`，如 `demo-order`。
  - 流程：`flow-{project}-{business}`，如 `flow-demo-create-sample`；目录用「动词-名词」语义命名，如 `flows/create-sample-requirement/`。

### 2.4 三层范式与拆分原则

| 层 | 位置 | 放什么 | 加载时机 |
|----|------|--------|----------|
| 执行主线 | `SKILL.md` | 目标、话术模板、有序步骤、决策规则、成功标准 | Agent 执行时必读 |
| 流程独有资料 | `{flow}/reference/*.md` | 字段字典、话术示例集、验证脚本等体量大的内容 | 按需加载 |
| 共享字典 | `_shared/*.md` | 被多处复用的枚举、字段词典 | 按需加载 |

拆分判据：

- 单个 `SKILL.md` 建议 <= ~200 行；超出则把「参考资料」下沉到 `reference/`。
- 枚举 / 字段词典被 **>=2 处**复用 -> 提到 `_shared/`；仅单流程使用 -> 放 `reference/`。
- `_shared/` 分层：
  - `demo/_shared/`：仅 demo 内复用（如 `sample-enums.md`）。
  - `skills/_shared/`：跨项目复用（预留，启用时在此建目录）。
- 确定性步骤写进 `SKILL.md`；需 Agent 判断的领域规则用自然语言写清规则与边界。

### 2.5 相对链接约定

`SKILL.md` 引用同包资料用相对路径，迁移目录时须同步修正：

- flow 引用自己的 reference：`reference/fields.md`
- flow 引用模块共享字典：`../../_shared/sample-enums.md`（`flows/{x}/` -> 上两级到 `demo/`）
- 原子 Skill 引用模块共享字典：`../_shared/sample-enums.md`

### 2.6 接口清单式原子 Skill 编写规范

接口清单模式的原子 Skill 不写 TS，`SKILL.md` 即「接口字典 + 调用模板」，Agent 照着模板用 `anycli request` 调用。参考样板：`skills/demo/order/SKILL.md`。

#### frontmatter

```yaml
---
name: {project}-{module}
description: >
  一句话描述模块能力，并注明「接口清单 + 通用 request 调用」模式。
triggers:
  - 触发词1
  - 触发词2
---
```

#### 固定章节

1. **概述** — 一句话说明本模块统一用 `anycli request {project} ...` 调用，无专属命令。
2. **接口清单** — 表格：接口名 / 方式 / 路径 / 用途。
3. **公共枚举** — 跨接口复用的枚举（如平台 platform）：值 / 含义。
4. **逐接口说明** — 每个接口一节，含：
   - 调用命令：`anycli request {project} <METHOD> <path> --body/--query '<模板>'`
   - body / query 模板：JSON 代码块，给出可用默认值
   - 参数表：字段 / 类型 / 说明，标注必填与枚举
   - 输出关键字段：路径 + 字段含义（如 `data.data.list[]`：`accountName` 昵称 …）
   - 示例：1-3 条真实可跑的 request 命令
5. **常见场景** — 多接口串联示例（如「搜索 -> 取 ID -> 查详情」）。
6. **错误处理** — 错误码 / 业务报错 -> 处理动作。

#### 编写要求（接地）

- 接口路径、参数名、枚举值必须与**后端 DTO 一致**，并以真实环境 `anycli request` 跑通为准，不照抄旧命令。
- 参数走 body 还是 query 须写清（如订单详情走 query `orderPlatformId`）。
- 必填字段与易错点显式标注（如 select 必须传**单个** `data.platform`，传 `platformList` 会报「所属平台错误或为空」）。
- 示例命令必须可直接复制运行。

## 3. src 目录规范

```
src/projects/{project}/{module}/index.ts   # 模块命令注册
src/projects/{project}/index.ts            # 项目聚合（.description() 提供项目组描述）
```

- 模块命令数 > 15 个时拆分子模块。
- 项目 `index.ts` 的 `.description('...')` 会被技能总览页读取为项目组描述。

> 接口清单模式的原子 Skill **没有** `src/projects/` 条目（不写 TS）；仅专属命令模式才有 `src/projects/{project}/{module}/index.ts`。

## 4. 工具链行为

| 命令 | 行为（方案 B） |
|------|----------------|
| `anycli gen` | 生成命令到 `src/projects/{project}/{module}/`，生成/更新 `skills/{project}/{module}/SKILL.md`，向 `skills/anycli/SKILL.md` 路由表追加一行；**不再自动改写主 Skill 的目录结构图**（目录图手工维护） |
| `anycli skill install [--force]` | 以「项目目录」为单位整树递归拷贝到 `~/.agents/skills/`，保留内部层级（含 `_shared/`、`flows/`）；同时清理旧版扁平目录（`demo-*`、`flows`）。不带 `--force` 时跳过已存在的项目目录 |
| `anycli skill list` | 递归扫描源码 `skills/`，按项目分组，读取 frontmatter `name` 作为逻辑名，并标注每个 Skill 的安装状态 |
| `anycli skill docs` | 递归收集所有 `SKILL.md`，按项目分组生成 `docs/skills.html`；流程 Skill 归入所属项目组 |
| `anycli skill uninstall` | 以「项目目录」为单位 `rmSync` 删除 `~/.agents/skills/` 下对应树，并清理旧版扁平目录 |

> 旧版（方案 A）为扁平 `{project}-{module}/` 目录。方案 B 把项目提为顶层维度，
> install/uninstall 会自动清理旧扁平目录，无需手工迁移已安装技能。

## 5. 新增检查清单

新增原子 Skill（接口清单模式，默认）：

- [ ] `skills/{project}/{module}/SKILL.md`，frontmatter `name: {project}-{module}`，符合 §2.6 章节
- [ ] 每个接口已用 `anycli request` 在真实环境跑通，参数与后端 DTO 一致
- [ ] 无 `src/projects/` 条目（不写 TS）
- [ ] `anycli skill install --force` 后 `anycli skill list` 可见且 `installed: true`
- [ ] 路由表（`skills/anycli/SKILL.md`）已登记

新增原子 Skill（专属命令模式，仅当有真实逻辑）：

- [ ] `src/projects/{project}/{module}/index.ts` 实现并已在项目 `index.ts` 注册
- [ ] `skills/{project}/{module}/SKILL.md`，frontmatter `name: {project}-{module}`
- [ ] `anycli skill install --force` 后 `anycli skill list` 可见且 `installed: true`
- [ ] 路由表已登记（`anycli gen` 自动追加，或手工）

新增流程 Skill（详见根目录 `FLOW-SPEC.md`）：

- [ ] `skills/{project}/flows/{business}/SKILL.md`，frontmatter `name: flow-{project}-{business}` + `type: flow`
- [ ] 每步映射到真实存在的原子接口（专属命令或 request 调用，接地，无幻觉命令）
- [ ] 体量大的字段/示例/校验已下沉 `reference/`
- [ ] 复用枚举/字典已放 `_shared/`
- [ ] 路由表已手工登记
- [ ] `anycli skill docs` 中归入正确项目组
