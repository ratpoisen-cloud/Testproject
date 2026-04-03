-- Supabase schema for Firebase -> Supabase migration (MVP)
-- Запускайте в Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.games (
  room_id text primary key,
  players jsonb,
  pgn text not null default '',
  fen text not null default 'start',
  game_state text not null default 'active' check (game_state in ('active', 'game_over')),
  message text,
  last_move_time bigint,
  created_at bigint not null,
  takeback_request jsonb,
  draw_request jsonb,
  turn text,
  last_move bigint,
  resign text,
  updated_at timestamptz not null default now()
);

create index if not exists games_state_idx on public.games (game_state);
create index if not exists games_last_move_time_idx on public.games (last_move_time desc);
create index if not exists games_created_at_idx on public.games (created_at desc);
create index if not exists games_players_gin_idx on public.games using gin (players);

create or replace function public.set_games_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_games_updated_at on public.games;
create trigger trg_games_updated_at
before update on public.games
for each row
execute function public.set_games_updated_at();

alter table public.games enable row level security;

-- MVP policy: пользователь может читать/менять только свои партии (или нераспределенные).
-- Если нужна более строгая модель, перенесите проверку в RPC-функции.
drop policy if exists "games_select_for_players" on public.games;
create policy "games_select_for_players"
on public.games
for select
to authenticated
using (
  players is null
  or players->>'white' = auth.uid()::text
  or players->>'black' = auth.uid()::text
);

drop policy if exists "games_insert_for_authenticated" on public.games;
create policy "games_insert_for_authenticated"
on public.games
for insert
to authenticated
with check (
  players is null
  or players->>'white' = auth.uid()::text
  or players->>'black' = auth.uid()::text
);

drop policy if exists "games_update_for_players" on public.games;
create policy "games_update_for_players"
on public.games
for update
to authenticated
using (
  players is null
  or players->>'white' = auth.uid()::text
  or players->>'black' = auth.uid()::text
)
with check (
  players is null
  or players->>'white' = auth.uid()::text
  or players->>'black' = auth.uid()::text
);

drop policy if exists "games_delete_for_players" on public.games;
create policy "games_delete_for_players"
on public.games
for delete
to authenticated
using (
  players is null
  or players->>'white' = auth.uid()::text
  or players->>'black' = auth.uid()::text
);

-- Realtime (idempotent для повторного запуска)
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'games'
  ) then
    alter publication supabase_realtime add table public.games;
  end if;
end $$;
