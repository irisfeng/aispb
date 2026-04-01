# 四项功能设计文档

**日期:** 2026-04-01
**范围:** 算法优化 + 快速浏览 + 弱词复习 + 自判按钮

---

## 功能 1: 答对就不再见

### 目标
比赛备战场景下，答对的词不需要复习，最大化覆盖面。

### 改动
修改 `src/lib/session-engine.ts` 的 `applyDrillResult` 函数：

**现有逻辑（答对时）：**
```
连对 1次 → dueOn = 2天后
连对 2次 → dueOn = 5天后，reviewCount -1
连对 4次 → dueOn = 7天后
```

**新逻辑（答对时）：**
```
答对 → knownAt = todayKey, dueOn = null
```

一次答对即标记为已掌握。`createDrillPlan` 已有 `knownAt` 跳过逻辑，无需额外改动。

**答错逻辑不变：**
```
答错 → reviewCount +1 (max 3), dueOn = 明天, currentStreak = 0
```

### 影响
- 覆盖速度大幅提升：dailyGoal=100 时，每天净新词约 70-80
- 已掌握的词在 triage 里标记为 known，不再出现在计划中

---

## 功能 2: 快速浏览模式

### 目标
不用拼写，快速扫过新词，标记认识/不认识，4 分钟扫 50 个词。

### UI 入口
READY 页面新增 "Quick browse" 按钮，在 "Begin today's drill" 下方。

### 流程
1. 点击 "Quick browse" 按钮
2. 从词库中抽取未见过 + 未标记 knownAt 的词，取 50 个
3. 逐词展示：显示单词 + 发音（如有 TTS）
4. 用户点 **"Know it ✓"** 或 **"Don't know ✗"**
   - Know it → `knownAt = todayKey`，永不再见
   - Don't know → 不做标记，留在词库中等待正式练习
5. 浏览完毕显示统计：X known / Y to practice
6. 回到 READY 页面

### 实现
- 新状态 `browseActive: boolean`, `browseWords: DrillWord[]`, `browseIndex: number`, `browseStats: { known: number, unknown: number }`
- 不走 DrillPlan 流程，不调 `applyDrillResult`，直接操作 progress 的 `knownAt`
- 只改 `aispb-app.tsx`

---

## 功能 3: 随时复习弱词

### 目标
登录后不开始新任务就能复习历史错词；完成今日任务后也能复习。

### 数据源
`wrongCount > 0 && !knownAt` 的词，优先 due 词（`reviewCount > 0 && dueOn <= today`），上限 **30 词**。

### UI 入口
1. **READY 页面** — "Begin today's drill" 下方，"Review weak words (N)" 按钮
2. **Session Complete 页面** — 错词区域下方，同样按钮

显示条件：有弱词时才显示，按钮标注数量。

### 行为
新函数 `startWeakReviewDrill()`：
- 从 notebookEntries 中筛选弱词
- 优先 due 词排前面
- 取前 30 个
- 构建合成 `DrillPlan`（`isReviewDrill: true`），用 `settings` 而非 `activePlan.settings`
- 无计时器，复用现有 review drill UI

### 不依赖 activePlan
与现有 `startReviewDrill`（依赖 `sessionMisses` + `activePlan`）独立。

---

## 功能 4: "I'm correct" 自判按钮

### 目标
ASR 因停顿经常识别错误，学生实际拼对了但被判错。提供手动纠正入口。

### 触发条件
判定为 **incorrect** 后显示（不在 correct 或 timeout 时显示）。

### UI
在 incorrect 反馈区域，答案显示旁边添加醒目按钮：
```
[ I'm correct ✓ ]
```
按钮样式：绿色/accent 色背景，足够大方便手机点击。

### 行为
点击后：
1. 用 `correct` 结果重新调用 `applyDrillResult`，覆盖之前的 incorrect 结果
2. 从 `sessionMisses` 数组中移除该词
3. `sessionCorrectCount +1`, `sessionMissCount -1`
4. UI 切换为绿色 ✓ 反馈
5. 正常等待进入下一词

### 注意
- 每个判错只能点一次（点完按钮消失）
- 不改变已过去的词（只对当前词有效）

---

## 文件变更清单

| 文件 | 变更 | 功能 |
|------|------|------|
| `src/lib/session-engine.ts` | 修改 `applyDrillResult` | 功能 1 |
| `src/components/aispb-app.tsx` | 快速浏览 UI + 弱词复习按钮 + 自判按钮 + 入口 | 功能 2, 3, 4 |

---

## 不在范围内

- dailyGoal 选项扩展（300/500）— 后续评估
- 跨词库复习（只复习当前选中词库的弱词）
- 快速浏览的 TTS 自动播放（用户可手动点击听发音）
