# 方案：从"接口清单"升级为"完整 Skill"自动生成

## 一、问题分析

### 当前 anycli Skill 的内容

```
SKILL.md = 接口清单表格 + 参数模板 + 示例命令
```

本质上是一份 **API 目录**，告诉 Agent "有哪些接口可以调"。

### 飞书 CLI Skill 的内容（对比）

```
SKILL.md = 路由优先级 + 命令选择表 + 执行原则 + 错误决策树 + 处理链 + 范围边界
references/ = 每个命令的深度文档（参数来源、字段联动、表单结构）
affordance/ = 每个命令的使用指南（何时用/何时不用/前置条件/坑）
```

本质上是一份 **行为剧本**，告诉 Agent "怎么思考、怎么选、怎么避坑、出错怎么办"。

### 差距总结

| 维度 | anycli 现状 | 飞书 CLI | 差距 |
|------|------------|---------|------|
| 路由决策 | 无（靠 anycli 主 Skill 路由表） | SKILL.md 内嵌路由优先级 + 判定规则 | 大 |
| 命令选择 | 接口清单平铺 | "想做什么 → 用哪个命令 → 读哪个 reference" 表格 | 大 |
| 执行原则 | 无 | 先拿最小信息再执行、已知对象直达动作、不盲目重试 | 大 |
| 错误处理 | 简单错误码表 | 决策树（错误码 → 判断 → 动作） | 中 |
| 处理链 | 常见场景（手写） | 明确命令序列（A → B → C） | 中 |
| 范围边界 | 无 | "不在本 skill 范围"明确声明 | 中 |
| 参数深度 | bodyTemplate + 参数表 | reference 文件：字段来源、联动规则、表单结构 | 中 |
| 使用指南 | 无 | Avoid when / Prerequisites / Tips | 大 |

---

## 二、升级后的 Skill 结构

```
skills/{project}/{module}/
├── SKILL.md                    # 主文件（行为剧本）
└── references/                 # 深度文档（按需加载）
    ├── {module}-{api-id}.md    # 每个接口的深度使用指南
    └── ...
```

### SKILL.md 新结构（生成器自动产出）

```markdown
---
name: demo-order
version: 1.0.0
description: >
  ...
triggers: [...]
---

<!-- AUTO-GENERATED -->

# Demo - 订单管理

## 路由优先级（何时用本 Skill）

出现以下语义时优先走本模块：
- 订单 / 搜索订单 / 订单广场 / 粉丝 / 选人
- 订单详情 / 订单列表 / 投放选人

**判定规则：** 只要最终动作是搜索订单、查看订单详情、投放选人，就归本模块。
非订单相关（投放计划、效果数据）走对应模块。

## 选哪个接口

| 想做什么 | 接口 | 按需读取 reference |
|---------|------|-------------------|
| 搜索订单（按条件筛选） | `order-list-page` | [reference](references/order-list-page.md) |
| 查看订单完整详情 | `order-get` | [reference](references/order-get.md) |
| 投放选人（精简列表） | `order-select-list-page` | [reference](references/order-select-list-page.md) |

## 处理链

- 搜索订单并查看详情：`order-list-page` → 取 orderPlatformId → `order-get`
- 投放选人：`order-select-list-page`（注意 platform 是单值不是数组）

## 执行原则

1. **先搜索再查详情** — 不要跳过搜索直接调详情（需要 orderPlatformId）
2. **注意字段不一致** — 列表返回 fansNum，详情返回 fansNums
3. **select 接口 platform 必填** — 是单个字符串，不是数组，否则报错
4. **不要盲目翻页** — 先确认搜索条件是否合理，再决定是否翻页

## 错误处理

| 错误码 / 现象 | 判断 | 动作 |
|--------------|------|------|
| AUTH_EXPIRED | Session 过期 | `anycli auth login` |
| FORBIDDEN | 无权限 | 检查用户角色，不要重试 |
| NOT_FOUND | 订单不存在 | 检查 orderPlatformId 是否正确 |
| 「所属平台错误或为空」 | select 未传 platform | 补 data.platform（单值） |

## 不在本模块范围

- 投放计划管理 → `demo-launch`
- 效果数据 / ROI → `demo-effect`
- 样品 / 样品 → `demo-sample` 或流程 `flow-demo-create-sample`

## 接口参数速查

（保留现有接口清单表格 + bodyTemplate，作为快速参考）
...
```

### references/{api-id}.md 新结构（每个接口一份）

```markdown
# order-list-page

订单搜索（订单广场 ES 搜索）

## 何时用

- 按关键词/平台/地区/粉丝数筛选订单
- 获取 orderPlatformId 用于后续查详情

## Avoid when

- 只需要精简列表用于投放选人 → 用 `order-select-list-page`
- 已有 orderPlatformId 只需查详情 → 用 `order-get`

## Prerequisites

- 已登录（`anycli auth status`）
- 知道目标平台（见平台枚举）

## 参数

| 字段 | 类型 | 必填 | 说明 | 来源 |
|------|------|------|------|------|
| pageNum | int | 是 | 页码 | 从 1 开始 |
| data.keyword | string | 否 | 关键词 | 用户提供 |
| data.platformList | string[] | 否 | 平台数组 | 见平台枚举 |
| data.minOrderFansNum | int | 否 | 最小粉丝数 | 用户提供 |

## Tips

- 粉丝数字段在列表中是 `fansNum`，在详情中是 `fansNums`，注意区分
- keyword 支持英文逗号分隔多个关键词
- 不传 platformList 时返回全平台结果

## 输出关键字段

`data.data.list[]`：
- `accountName` — 昵称
- `orderPlatformId` — 平台订单ID（用于查详情的入参）
- `fansNum` — 粉丝数
- `platform` — 平台

## Examples

**抖音美妆订单**
```bash
anycli request demo POST /api/order/listForEsPage --body '{"pageNum":1,"pageSize":20,"data":{"keyword":"美妆","platformList":["DOU_YIN"]}}'
```

**小红书订单，粉丝 10w-100w**
```bash
anycli request demo POST /api/order/listForEsPage --body '{"pageNum":1,"pageSize":20,"data":{"platformList":["XIAO_HONG_SHU"],"minOrderFansNum":100000,"maxOrderFansNum":1000000}}'
```
```

---

## 三、注册表 Schema 扩展

在现有 `apis/{project}/{module}.json` 基础上，新增字段：

```json
{
  "module": "demo-order",
  "version": "1.0.0",
  
  "routing": {
    "priority": "出现以下语义时优先走本模块",
    "keywords": ["订单", "搜索订单", "粉丝", "选人"],
    "rule": "只要最终动作是搜索订单、查看订单详情、投放选人，就归本模块。",
    "exclude": ["投放计划 → demo-launch", "效果数据 → demo-effect"]
  },
  
  "principles": [
    "先搜索再查详情 — 不要跳过搜索直接调详情（需要 orderPlatformId）",
    "注意字段不一致 — 列表返回 fansNum，详情返回 fansNums",
    "select 接口 platform 必填 — 是单个字符串，不是数组"
  ],
  
  "chains": [
    { "name": "搜索订单并查看详情", "steps": ["order-list-page", "order-get"] },
    { "name": "投放选人", "steps": ["order-select-list-page"] }
  ],
  
  "apis": [
    {
      "id": "order-list-page",
      "summary": "订单搜索",
      "method": "POST",
      "path": "/api/order/listForEsPage",
      "level": "read",
      
      "avoidWhen": [
        "只需要精简列表用于投放选人 → 用 order-select-list-page",
        "已有 orderPlatformId 只需查详情 → 用 order-get"
      ],
      "prerequisites": ["已登录", "知道目标平台"],
      "tips": [
        "粉丝数字段在列表中是 fansNum，在详情中是 fansNums",
        "keyword 支持英文逗号分隔多个关键词"
      ],
      "paramSources": {
        "data.keyword": "用户提供",
        "data.platformList": "见平台枚举",
        "data.minOrderFansNum": "用户提供"
      },
      
      "bodyParams": [...],
      "bodyTemplate": {...},
      "examples": [...],
      "outputFields": "..."
    }
  ]
}
```

新增字段（均为可选，向后兼容）：

| 字段 | 位置 | 说明 |
|------|------|------|
| `routing` | 模块级 | 路由优先级、判定规则、排除项 |
| `principles` | 模块级 | 执行原则列表 |
| `chains` | 模块级 | 处理链（命令序列） |
| `apis[].avoidWhen` | 接口级 | 何时不该用这个接口 |
| `apis[].prerequisites` | 接口级 | 前置条件 |
| `apis[].tips` | 接口级 | 使用提示/坑 |
| `apis[].paramSources` | 接口级 | 参数来源说明 |

---

## 四、生成器升级

`skill-builder.ts` 的 `buildSkillMd()` 升级为生成完整行为剧本：

1. **路由优先级 section** — 从 `routing` 字段生成
2. **命令选择表** — 从 `apis[]` 自动生成（想做什么 → 接口 → reference 链接）
3. **处理链 section** — 从 `chains` 字段生成
4. **执行原则 section** — 从 `principles` 字段生成
5. **错误处理** — 从 `customSections` 或新增 `errorHandling` 字段生成
6. **范围边界** — 从 `routing.exclude` 生成
7. **接口参数速查** — 保留现有表格（向后兼容）
8. **references/ 目录** — 每个接口生成一份深度文档

新增 `buildReferenceMd(api, module)` 函数，生成 `references/{api-id}.md`。

---

## 五、代码生成（anycli gen）升级

从 Java Controller 解析后，除了现有的 method/path/params/bodyTemplate，还可以：

### 自动推断（机器可做）

| 内容 | 推断来源 |
|------|---------|
| `routing.keywords` | 模块名 + 接口描述中的关键词 |
| `chains` | 接口间的参数依赖（A 的输出是 B 的输入） |
| `apis[].prerequisites` | 参数 required=true 的字段 |
| `apis[].paramSources` | 参数名匹配其他接口的输出字段 |

### 需要人工补充（AI 辅助）

| 内容 | 说明 |
|------|------|
| `routing.rule` | 判定规则（自然语言） |
| `principles` | 执行原则（需要业务理解） |
| `apis[].avoidWhen` | 何时不该用（需要对比分析） |
| `apis[].tips` | 坑/注意事项（需要经验） |

### 建议的生成流程

```
anycli gen
  ├─ 解析 Java Controller → 机器字段（method/path/params/template）
  ├─ 自动推断 → routing.keywords / chains / prerequisites / paramSources
  ├─ 生成 SKILL.md 骨架（路由/选择表/处理链/原则 留空占位）
  ├─ 生成 references/{api-id}.md 骨架（Avoid/Tips 留空占位）
  └─ 提示用户补充人工字段（或通过 AI 辅助填充）
```

可选：`anycli gen --ai` 模式，调用 LLM 根据接口信息自动填充 principles / avoidWhen / tips。

---

## 六、与飞书 affordance 的对应

| 飞书概念 | anycli 对应 | 存放位置 |
|---------|------------|---------|
| `affordance/{domain}.md` | SKILL.md 中的路由/选择表/原则 | 注册表 `routing` + `principles` |
| `### Avoid when` | `apis[].avoidWhen` | 注册表接口级 |
| `### Prerequisites` | `apis[].prerequisites` | 注册表接口级 |
| `### Tips` | `apis[].tips` | 注册表接口级 |
| `### Examples` | `apis[].examples` | 注册表接口级（已有） |
| `### Skills` (reference) | `references/{api-id}.md` | 生成产物 |
| 处理链 | `chains` | 注册表模块级 |
| 错误决策树 | `errorHandling`（扩展现有） | 注册表模块级 |

---

## 七、实施计划

| 阶段 | 内容 | 工作量 |
|------|------|--------|
| **Phase A** | Schema 扩展 + 生成器升级（SKILL.md 新结构 + references/） | 1 天 |
| **Phase B** | 迁移 demo-order 为新格式（手工补充 routing/principles/tips） | 0.5 天 |
| **Phase C** | anycli gen 升级（自动推断 keywords/chains/prerequisites） | 1 天 |
| **Phase D**（可选） | `--ai` 模式（LLM 辅助填充人工字段） | 1 天 |

Phase A + B 完成后即可看到效果：生成的 SKILL.md 从"接口清单"变为"行为剧本"。

---

## 八、向后兼容

- 注册表新字段全部可选，旧格式 JSON 仍可正常 build
- 生成器检测到无 `routing` 字段时，退化为现有格式（接口清单模式）
- 现有 SKILL.md 不受影响，只有重新 build 才会升级为新格式
- flow 的接地校验不受影响（仍然按 api id 解析）
