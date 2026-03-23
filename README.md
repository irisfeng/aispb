# AISPB

移动端优先的 Spelling Bee 训练 Web App。

当前目标是先服务 `Kaylee` 的初中组备赛，核心体验包括：
- 每日抽词训练
- Bee 风格提示请求：`repeat / definition / sentence / origin`
- 限时拼写与 `start over` 节奏
- 错词本与后续强化复习

## Tech Stack

- `Next.js 16`
- `React 19`
- `TypeScript`
- `Tailwind CSS 4`

## Current Scope

当前仓库已经有第一版可运行骨架：
- 移动端优先首页
- 每日训练入口
- 回合原型：计时器、提示按钮、拼写输入、反馈流
- 错词预览与 momentum 面板
- provider adapter 预留接口

当前仍是 `mock data` 原型，真实词典、TTS、错词持久化还没有接入。

## Local Run

```bash
npm install
npm run dev
```

常用命令：

```bash
npm run lint
npm run typecheck
npm run build
```

## Project Structure

```text
src/app/           Next.js app router entry
src/components/    UI and interaction components
src/lib/           domain types, mock session data, future adapters
tasks/             working notes required by rules.md
```

## Next

1. 用真实词源替换 mock session 数据。
2. 接入 `Merriam-Webster` 词典 adapter。
3. 接入 pronouncer TTS 和音频缓存。
4. 落持久化错词本与每日调度。
