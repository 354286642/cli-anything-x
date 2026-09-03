# Skill 构建

从接口注册表（`apis/`）自动生成 SKILL.md，与 flow.json → SKILL.md 的编译模型同构。

## 核心理念

```
apis/{project}/{module}.json  ──→  skills/{project}/{module}/SKILL.md
         (数据源)                        (编译产物)
```

- SKILL.md 头部标记 `<!-- AUTO-GENERATED from apis/ registry -->`
- 人工补充内容写入注册表的 `customSections` 字段，生成器原样输出
- 每次 build 后自动刷新路由表和技能总览页

## 命令

### 构建单个模块

```bash
anycli skill build demo order
# ✓ 已生成: skills/demo/order/SKILL.md (v1.0.0)
```

### 构建项目下所有模块

```bash
anycli skill build demo
# ✓ 已构建 demo 下 3 个模块
```

### 构建所有项目

```bash
anycli skill build
# ✓ 已构建 3 个模块
```

### 预览模式（不写入文件）

```bash
anycli skill build demo order --dry-run
```

### 校验注册表

```bash
anycli skill validate
# ✓ 校验通过：1 个项目，7 个接口

anycli skill validate demo
```

校验内容：
- `module` / `version` 字段存在且格式正确
- `apis` 数组非空
- 每个接口有 `id` / `method` / `path` / `level`
- `level` 值为 `read` / `write` / `dangerous`
- 无重复 id

## 生成规则

| 注册表字段 | 生成到 SKILL.md 的位置 |
|-----------|----------------------|
| `module` / `version` / `description` / `triggers` | YAML frontmatter |
| `apis[]` | 接口清单表格 + 每个接口的详情 section |
| `apis[].bodyTemplate` / `queryTemplate` | JSON 代码块 |
| `apis[].bodyParams` / `queryParams` | 参数表格 |
| `apis[].notes` | `> ⚠️` 提示块 |
| `apis[].examples` | bash 代码块 |
| `apis[].outputFields` | 输出字段说明段落 |
| `enums` / `enumRefs` | 枚举表格 section |
| `customSections` | 原样输出为独立 section |

## 版本管理

- 模块版本在注册表 `version` 字段维护（semver）
- 接口变更时手动 bump 模块版本
- 每个接口有 `version` 字段标记引入版本
- SKILL.md frontmatter 中包含 `version` 字段

## 与其他命令的关系

| 命令 | 作用 |
|------|------|
| `anycli gen` | 从 Java Controller 解析接口 → 写入注册表 → 自动 build |
| `anycli skill build` | 从注册表生成 SKILL.md |
| `anycli flow build` | 从 flow.json 生成流程 SKILL.md（接地校验引用注册表） |
| `anycli skill docs` | 从所有 SKILL.md 生成技能总览页 |
