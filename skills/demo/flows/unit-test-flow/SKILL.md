---
name: flow-demo-unit-test-flow
description: >
  单元测试意图
type: flow
triggers:
  - 自动执行 unit-test-flow
  - unit-test-flow
---
<!-- AUTO-GENERATED from flow.json — 请勿手动编辑 -->

# unit-test-flow 自动录制工作流
## 业务目标

单元测试意图
## 适用场景

- 原系统 unit-test-flow 自动化流程
## 前置条件

- 保持本地 Profile 会话有效
## 流程总览

   - **步骤 1: POST /user/api/customer/enable**

## 步骤详情

#### Step ?.1：步骤 1: POST /user/api/customer/enable

调用接口 POST /user/api/customer/enable。
## Agent 引导策略：智能预填 + 确认修改

## 流程结束接口调用示例

```bash
anycli request <project> POST /user/api/customer/enable --body '
{"id":10086}
'
```
## 辅助接口

| 用途 | 命令/接口 | 说明 |
|------|------|------|
| POST /user/api/customer/enable | POST /user/api/customer/enable | Live Lens 自动捕获接口 (https://api.example.com/user/api/customer/enable) |
## 成功标准

- 链路上所有接口响应成功且符合契约
## 领域知识

- 本流程通过 Live Lens 于 2026-09-03T06:18:51.980Z 捕获产出。
## 参考文件

本流程的详细内容按模块拆分到 `reference/` 目录，Agent 按需查阅：

| 文件 | 内容 | 何时查阅 |
|------|------|---------|
