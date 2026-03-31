# 多用户认证设计文档

**日期:** 2026-03-31
**方案:** Supabase (PostgreSQL + Auth)
**范围:** 用户注册/登录、数据隔离、旧数据迁移

---

## 1. 概述

为 AISPB 添加多用户支持，使用 Supabase Auth 实现昵称+PIN 登录，PostgreSQL 存储用户进度，RLS 策略保证数据隔离。通过邀请码控制注册。

## 2. 用户需求

- **用户规模:** 家庭/小圈子 (<10人)
- **登录方式:** 昵称 + 4-6位 PIN 码
- **注册控制:** 邀请码 (env: `INVITE_CODE`)
- **数据迁移:** 现有进度自动迁移到第一个登录用户
- **公网访问:** aispb.vercel.app 公开可达

## 3. 认证架构

### 3.1 Supabase Auth + 昵称映射

利用 Supabase Auth 的 email/password 模式：
- 昵称映射为 `{nickname}@aispb.local` 作为 email
- PIN 作为 password (Supabase 会 hash)
- Supabase 管理 session、JWT、refresh token
- 前端用 `@supabase/ssr` 管理 cookie-based session

### 3.2 注册流程

1. 用户输入昵称、PIN(4-6位)、邀请码
2. 前端调 `/api/auth/register`
3. 后端校验邀请码 (`INVITE_CODE` 环境变量)
4. 校验通过 → `supabase.auth.signUp({ email: nickname@aispb.local, password: pin })`
5. 在 `user_settings` 表插入默认设置
6. 返回 session

### 3.3 登录流程

1. 用户输入昵称、PIN
2. 前端调 `/api/auth/login`
3. `supabase.auth.signInWithPassword({ email: nickname@aispb.local, password: pin })`
4. 返回 session

### 3.4 退出流程

1. 前端调 `/api/auth/logout`
2. `supabase.auth.signOut()`
3. 清除本地 session cookie
4. 跳转到登录页

## 4. 数据库 Schema

```sql
-- 用户设置
create table user_settings (
  user_id uuid references auth.users primary key,
  daily_goal integer not null default 50,
  round_duration_seconds integer not null default 60,
  pronouncer_enabled boolean not null default true,
  word_bank text not null default 'spbcn-middle',
  updated_at timestamptz not null default now()
);

-- 用户进度
create table user_progress (
  user_id uuid references auth.users not null,
  word_id text not null,
  seen_count integer not null default 0,
  correct_count integer not null default 0,
  wrong_count integer not null default 0,
  current_streak integer not null default 0,
  review_count integer not null default 0,
  last_result text,
  last_seen_on text,
  due_on text,
  known_at text,
  primary key (user_id, word_id)
);

-- RLS
alter table user_settings enable row level security;
alter table user_progress enable row level security;

create policy "Users can CRUD own settings"
  on user_settings for all using (auth.uid() = user_id);

create policy "Users can CRUD own progress"
  on user_progress for all using (auth.uid() = user_id);
```

## 5. 数据同步策略

### 5.1 取代 Vercel KV

新的 `supabase-sync.ts` 替代 `kv-sync.ts`:
- `loadSettingsFromSupabase(userId)` — 从 `user_settings` 表读取
- `saveSettingsToSupabase(userId, settings)` — upsert 到 `user_settings`
- `loadProgressFromSupabase(userId)` — 从 `user_progress` 读取，转换为 `ProgressMap`
- `saveProgressToSupabase(userId, progress)` — batch upsert 到 `user_progress`

### 5.2 localStorage 保持为离线缓存

- 保留现有 localStorage 读写，作为离线缓存和快速启动
- localStorage key 加用户前缀: `aispb:{userId}:settings:v1`, `aispb:{userId}:progress:v1`
- 登录后从 Supabase 同步到 localStorage
- 每次变更先写 localStorage 再异步写 Supabase

### 5.3 旧数据迁移

- 首次登录后检查 localStorage 中是否存在无前缀的旧数据 (`aispb:settings:v1`, `aispb:progress:v1`)
- 如有，迁移到当前用户的 Supabase 表 + 新 localStorage key
- 迁移后删除旧 key
- 只迁移一次，用 `aispb:migrated` flag 标记

## 6. UI 变更

### 6.1 认证页面 (`auth-screen.tsx`)

全屏页面，两个 tab：Login / Register

**Login tab:**
- 昵称输入框
- PIN 输入框 (数字键盘, type="tel")
- "Sign in" 按钮

**Register tab:**
- 昵称输入框 (2-20字符, 字母数字)
- PIN 输入框 (4-6位数字)
- 邀请码输入框
- "Create account" 按钮

样式与现有 app 一致 (panel, setting-chip 风格)

### 6.2 主应用变更

- 顶部显示当前用户昵称
- Settings 面板底部添加 "Sign out" 按钮
- 数据流从 KV → Supabase

## 7. 环境变量

```env
# Supabase (必须)
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# 邀请码 (必须)
INVITE_CODE=bee2026

# Supabase Service Role Key (仅注册 API 需要)
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

## 8. 向后兼容

- 如果 Supabase 未配置 (无 env vars)，app 降级为现有行为 (localStorage only, 无登录)
- 不删除 Vercel KV 代码，但新用户默认走 Supabase
- 登录页只在 Supabase 配置后显示

## 9. 文件变更清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `src/lib/supabase.ts` | 新增 | Supabase client (browser + server) |
| `src/lib/supabase-sync.ts` | 新增 | 数据同步层，替代 kv-sync |
| `src/app/api/auth/register/route.ts` | 新增 | 注册 API (邀请码校验) |
| `src/app/api/auth/login/route.ts` | 新增 | 登录 API |
| `src/app/api/auth/logout/route.ts` | 新增 | 退出 API |
| `src/components/auth-screen.tsx` | 新增 | 登录/注册 UI |
| `src/components/aispb-app.tsx` | 修改 | 集成 auth 状态、用户显示、数据源切换 |
| `src/lib/storage.ts` | 修改 | localStorage key 加用户前缀 |
| `supabase/migrations/001_init.sql` | 新增 | 数据库 schema |
| `package.json` | 修改 | 添加 supabase 依赖 |
| `.env.example` | 修改 | 添加 Supabase + INVITE_CODE 变量 |

## 10. 不在范围内

- OAuth 第三方登录 (Google/WeChat)
- 密码找回 (PIN 忘了直接联系管理员)
- 管理员后台 (直接 Supabase dashboard 操作)
- 排行榜/社交功能
