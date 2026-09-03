# 技能总览页

一键生成可视化 HTML 页面，按模块浏览全部 Skill，命令即点即拷。

## 使用

```bash
# 生成（默认输出到 docs/skills.html）
anycli skill docs

# 生成并自动打开浏览器
anycli skill docs --open

# 自定义输出路径
anycli skill docs -o docs/skills.html
```

> `anycli gen` 和 `anycli skill build` 执行完成后会自动刷新该页面。

## 页面能力

- 🗂 **按模块切换** — 顶部标签页按项目分组，每个模块独立强调色
- 🔍 **全局搜索** — 跨技能名 / 命令 / 触发词过滤，`/` 聚焦、`Esc` 清空
- 📋 **命令即点即拷** — 卡片内每条命令点击即复制到剪贴板
- 🪟 **详情弹框** — 点击技能名称弹出完整 SKILL.md（Markdown 渲染）
- 📋 **快捷复制技能名** — 名称旁的复制按钮一键复制技能标识
- 🌓 **深 / 浅主题** — 一键切换并记忆偏好
- 📊 **统计概览** — 模块 / 技能 / 命令 / 已安装数量

## 技术实现

- 单文件 HTML（数据内嵌、内置 Markdown 渲染、无外部依赖）
- 可直接双击打开或部署到任意静态托管
- 数据来源：扫描 `skills/` 下所有 SKILL.md 的 frontmatter + 正文

