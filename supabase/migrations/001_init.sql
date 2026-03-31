-- User settings (one row per user)
create table user_settings (
  user_id uuid references auth.users on delete cascade primary key,
  daily_goal integer not null default 50,
  round_duration_seconds integer not null default 60,
  pronouncer_enabled boolean not null default true,
  word_bank text not null default 'spbcn-middle',
  updated_at timestamptz not null default now()
);

-- User word progress (one row per user per word)
create table user_progress (
  user_id uuid references auth.users on delete cascade not null,
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

-- Enable Row Level Security
alter table user_settings enable row level security;
alter table user_progress enable row level security;

-- RLS policies: users can only access their own data
create policy "Users can select own settings"
  on user_settings for select using (auth.uid() = user_id);
create policy "Users can insert own settings"
  on user_settings for insert with check (auth.uid() = user_id);
create policy "Users can update own settings"
  on user_settings for update using (auth.uid() = user_id);

create policy "Users can select own progress"
  on user_progress for select using (auth.uid() = user_id);
create policy "Users can insert own progress"
  on user_progress for insert with check (auth.uid() = user_id);
create policy "Users can update own progress"
  on user_progress for update using (auth.uid() = user_id);
