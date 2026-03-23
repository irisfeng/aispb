# AISPB

移动端优先的 Spelling Bee 训练 Web App。

当前先聚焦初中组备赛场景，核心体验包括：
- 每日抽词训练
- Bee 风格提示请求：`repeat / definition / sentence / origin`
- 限时口头拼读与 `start over` 节奏
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
- 回合原型：计时器、提示按钮、口头拼读输入、反馈流
- 浏览器端错词本与进度持久化
- 浏览器语音识别答题流，浏览器不支持时自动降级到手工 fallback
- 火山豆包语音 pronouncer 通道，未配置时自动回退到浏览器 speech synthesis
- 环境变量驱动的 Merriam-Webster 词典通道，未配置时自动回退到本地 seed 数据
- provider adapter 结构，便于后续接入真实服务

当前仍未接入云端存储和生产级 coach provider。

## Local Run

```bash
npm install
npm run dev
```

如需启用真实词典与 pronouncer：

```bash
cp .env.example .env
```

然后填写：

```bash
MW_DICTIONARY_API_KEY=your_key_here
MW_DICTIONARY_TYPE=collegiate
VOLC_SPEECH_APP_ID=your_speech_app_id
VOLC_SPEECH_ACCESS_TOKEN=your_speech_access_token
VOLC_SPEECH_SPEAKER=en_female_dacey_uranus_bigtts
```

如果你需要显式回退到旧版 `SAMI` 短文本 TTS，再额外填写：

```bash
VOLC_ACCESSKEY=your_access_key
VOLC_SECRETKEY=your_secret_key
VOLC_SPEECH_APP_KEY=your_legacy_app_key
VOLC_SPEECH_USE_LEGACY=true
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
2. 给 pronouncer 加上音频缓存与更细的发音人配置。
3. 接入生产级 coach provider。
4. 把浏览器端 notebook 升级为可同步的持久化数据层。
