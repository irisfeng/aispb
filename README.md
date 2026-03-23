# AISPB

移动端优先的 Spelling Bee 训练 Web App。

当前先聚焦初中组备赛场景，核心体验包括：
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
- 本地每日抽题与设置项：`5 / 10 / 20` 词，`60 / 90` 秒
- 回合原型：计时器、提示按钮、拼写输入、反馈流
- 浏览器端错词本与进度持久化
- 浏览器 speech synthesis pronouncer fallback
- provider adapter 结构，便于后续接入真实服务

当前仍未接入真实外部服务，`Merriam-Webster`、正式 TTS、云端存储还在后续阶段。

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
src/lib/           domain types, word bank, session engine, adapters
tasks/             working notes required by rules.md
```

## Next

1. 用真实词源替换 mock session 数据。
2. 接入 `Merriam-Webster` 词典 adapter。
3. 接入正式 pronouncer TTS 和音频缓存。
4. 把浏览器端 notebook 升级为可同步的持久化数据层。
