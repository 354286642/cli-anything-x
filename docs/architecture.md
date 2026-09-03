# 架构设计

## 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                      CLI-Anything-X                          │
├─────────────┬─────────────┬─────────────┬───────────────┤
│  auth       │  config     │  request    │  gen          │
│  认证管理    │  配置管理    │  通用调用    │  代码生成      │
├─────────────┴─────────────┴─────────────┴───────────────┤
│  skill (build/validate/install/docs)  │  flow (build/edit/version)  │
│  Skill 管理                           │  工作流管理                   │
├───────────────────────────────────────┴─────────────────────────────┤
│                        core 核心层                                    │
│  client · config · auth · output · errors                           │
│  skill-builder · grounding · discovery · routing                    │
│  flow-compiler · flow-parser · flow-version · java-parser           │
├─────────────────────────────────────────────────────────────────────┤
│                        数据层                                         │
│  apis/ (接口注册表)  │  skills/ (Skill 产物)  │  ~/.anycli (运行时配置) │
└─────────────────────────────────────────────────────────────────────┘
```

## 自动发现机制

项目不再需要手工在 `src/index.ts` 中 import 注册。启动时自动扫描 `skills/` 目录：

```
skills/
├── anycli/SKILL.md          ← 主入口（保留，不自动注册）
├── _shared/                 ← 共享字典（跳过）
└── demo/                  ← 自动发现为项目
    ├── order/SKILL.md      ← 自动发现为模块
    ├── launch/SKILL.md
    ├── effect/SKILL.md
    └── flows/               ← 标记 hasFlows
```

**新增项目零代码**：只需在 `skills/` 下创建目录和 SKILL.md，CLI 自动识别并注册命令。

发现规则：
- `skills/{project}/` 下含 SKILL.md 的子目录 → 模块
- `_shared`、`anycli` 为保留目录，跳过
- 已存在的同名命令不会被覆盖

## 数据流

### 接口清单模式（原子 Skill）

```
Java Controller ──→ anycli gen ──→ apis/{project}/{module}.json
                                         │
                                         ▼
                                   anycli skill build
                                         │
                                         ▼
                                   skills/{project}/{module}/SKILL.md
                                         │
                                         ▼
                                   anycli skill install → ~/.agents/skills/
```

### 流程模式（流程 Skill）

```
flow-editor (Web) ──→ flow.json
                         │
                         ▼
                   anycli flow build
                         │
                    ┌────┴────┐
                    ▼         ▼
              接地校验    SKILL.md + reference/
              (apis/)         │
                              ▼
                        版本记录 (flow.version.json)
```

### 产物关系

```
apis/ (注册表) ──→ skills/ (SKILL.md) ──→ docs/skills.html (总览页)
                        │
                        └──→ skills/anycli/SKILL.md (路由表)
```

## 目录约定

完整规范见 [DIRECTORY.md](../DIRECTORY.md)，核心要点：

| 目录 | 用途 |
|------|------|
| `apis/` | 接口注册表（单一数据源） |
| `skills/` | Skill 产物（SKILL.md + reference/） |
| `src/core/` | 核心逻辑（纯函数，可单测） |
| `src/commands/` | CLI 命令注册 |
| `tools/flow-editor/` | 可视化流程编辑器 |
| `docs/` | 文档 + 技能总览页 |
| `tests/` | 单元测试 |

## 技术栈

- TypeScript / Node.js >= 18
- Commander.js（CLI 框架）
- Vitest（测试）
- Chalk / Ora / Inquirer（交互体验）
- Conf（配置持久化）
