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
  rematch_request jsonb,
  turn text,
  last_move bigint,
  resign text,
  reactions jsonb not null default '[]'::jsonb,
  quick_phrase jsonb,
  updated_at timestamptz not null default now()
);

alter table public.games
add column if not exists reactions jsonb not null default '[]'::jsonb;

alter table public.games
add column if not exists quick_phrase jsonb;

alter table public.games
add column if not exists rematch_request jsonb;

update public.games
set reactions = '[]'::jsonb
where reactions is null;

create index if not exists games_state_idx on public.games (game_state);
create index if not exists games_last_move_time_idx on public.games (last_move_time desc);
create index if not exists games_created_at_idx on public.games (created_at desc);
create index if not exists games_players_gin_idx on public.games using gin (players);

create table if not exists public.user_presence (
  uid text primary key,
  is_online boolean not null default false,
  last_seen_at bigint not null default 0,
  manual_status text,
  manual_status_text text,
  manual_status_expires_at bigint,
  updated_at_ms bigint not null default 0
);

create index if not exists user_presence_last_seen_idx on public.user_presence (last_seen_at desc);
create index if not exists user_presence_updated_idx on public.user_presence (updated_at_ms desc);

alter table public.user_presence enable row level security;

drop policy if exists "presence_select_for_authenticated" on public.user_presence;
create policy "presence_select_for_authenticated"
on public.user_presence
for select
to authenticated
using (true);

drop policy if exists "presence_insert_own" on public.user_presence;
create policy "presence_insert_own"
on public.user_presence
for insert
to authenticated
with check (uid = auth.uid()::text);

drop policy if exists "presence_update_own" on public.user_presence;
create policy "presence_update_own"
on public.user_presence
for update
to authenticated
using (uid = auth.uid()::text)
with check (uid = auth.uid()::text);

drop policy if exists "presence_delete_own" on public.user_presence;
create policy "presence_delete_own"
on public.user_presence
for delete
to authenticated
using (uid = auth.uid()::text);

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

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_presence'
  ) then
    alter publication supabase_realtime add table public.user_presence;
  end if;
end $$;

-- Атомарное добавление игрока в комнату (устраняет race condition read-modify-write).
-- Важно: функция работает как SECURITY DEFINER, поэтому явно проверяет, что p_uid = auth.uid().
create or replace function public.join_game_player(
  p_room_id text,
  p_uid text,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_players jsonb;
  v_next_players jsonb;
begin
  if p_room_id is null or p_uid is null then
    raise exception 'room_id и uid обязательны';
  end if;

  if auth.uid() is null or auth.uid()::text <> p_uid then
    raise exception 'uid must match auth.uid()';
  end if;

  select players
  into v_players
  from public.games
  where room_id = p_room_id
  for update;

  if not found then
    raise exception 'game % not found', p_room_id;
  end if;

  if v_players is null then
    v_next_players := jsonb_build_object(
      'white', p_uid,
      'whiteName', coalesce(p_name, 'Игрок')
    );
  elsif v_players->>'white' = p_uid or v_players->>'black' = p_uid then
    return v_players;
  elsif coalesce(v_players->>'black', '') = '' then
    v_next_players := v_players || jsonb_build_object(
      'black', p_uid,
      'blackName', coalesce(p_name, 'Игрок')
    );
  else
    return v_players;
  end if;

  update public.games
  set players = v_next_players
  where room_id = p_room_id;

  return v_next_players;
end;
$$;

revoke all on function public.join_game_player(text, text, text) from public;
grant execute on function public.join_game_player(text, text, text) to authenticated;

-- Атомарное добавление игрока в комнату с приоритетом стороны.
-- p_preferred_color:
--   'w' -> сначала white, затем black
--   'b' -> сначала black, затем white
--   null/другое -> текущее поведение (white, затем black)
create or replace function public.join_game_player_with_color(
  p_room_id text,
  p_uid text,
  p_name text,
  p_preferred_color text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_players jsonb;
  v_next_players jsonb;
  v_first_slot text;
  v_second_slot text;
begin
  if p_room_id is null or p_uid is null then
    raise exception 'room_id и uid обязательны';
  end if;

  if auth.uid() is null or auth.uid()::text <> p_uid then
    raise exception 'uid must match auth.uid()';
  end if;

  v_first_slot := case when p_preferred_color = 'b' then 'black' else 'white' end;
  v_second_slot := case when v_first_slot = 'white' then 'black' else 'white' end;

  select players
  into v_players
  from public.games
  where room_id = p_room_id
  for update;

  if not found then
    raise exception 'game % not found', p_room_id;
  end if;

  if v_players is null then
    if v_first_slot = 'white' then
      v_next_players := jsonb_build_object(
        'white', p_uid,
        'whiteName', coalesce(p_name, 'Игрок')
      );
    else
      v_next_players := jsonb_build_object(
        'black', p_uid,
        'blackName', coalesce(p_name, 'Игрок')
      );
    end if;
  elsif v_players->>'white' = p_uid or v_players->>'black' = p_uid then
    return v_players;
  elsif coalesce(v_players->>v_first_slot, '') = '' then
    if v_first_slot = 'white' then
      v_next_players := v_players || jsonb_build_object(
        'white', p_uid,
        'whiteName', coalesce(p_name, 'Игрок')
      );
    else
      v_next_players := v_players || jsonb_build_object(
        'black', p_uid,
        'blackName', coalesce(p_name, 'Игрок')
      );
    end if;
  elsif coalesce(v_players->>v_second_slot, '') = '' then
    if v_second_slot = 'white' then
      v_next_players := v_players || jsonb_build_object(
        'white', p_uid,
        'whiteName', coalesce(p_name, 'Игрок')
      );
    else
      v_next_players := v_players || jsonb_build_object(
        'black', p_uid,
        'blackName', coalesce(p_name, 'Игрок')
      );
    end if;
  else
    return v_players;
  end if;

  update public.games
  set players = v_next_players
  where room_id = p_room_id;

  return v_next_players;
end;
$$;

revoke all on function public.join_game_player_with_color(text, text, text, text) from public;
grant execute on function public.join_game_player_with_color(text, text, text, text) to authenticated;


create or replace function public.resolve_takeback_atomic(
  p_room_id text,
  p_uid text,
  p_action text,
  p_fen_after_undo text default null,
  p_pgn_after_undo text default null
)
returns public.games
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
  v_color text;
  v_turn_after_undo text;
begin
  if auth.uid() is null or auth.uid()::text <> p_uid then
    raise exception 'Auth uid mismatch';
  end if;

  select *
  into v_game
  from public.games
  where room_id = p_room_id
  for update;

  if not found then
    raise exception 'Game not found';
  end if;

  if v_game.game_state = 'game_over' then
    raise exception 'Game already finished';
  end if;

  if v_game.players->>'white' = p_uid then
    v_color := 'w';
  elsif v_game.players->>'black' = p_uid then
    v_color := 'b';
  else
    raise exception 'Not a player';
  end if;

  if p_action = 'request' then
    if v_game.takeback_request is not null then
      raise exception 'Takeback already requested';
    end if;

    update public.games
    set
      takeback_request = jsonb_build_object(
        'from', v_color,
        'fromUid', p_uid,
        'timestamp', floor(extract(epoch from now()) * 1000)
      ),
      version = coalesce(version, 0) + 1
    where room_id = p_room_id
    returning * into v_game;

    return v_game;
  end if;

  if p_action = 'reject' then
    if v_game.takeback_request is null then
      raise exception 'No takeback request';
    end if;

    if v_game.takeback_request->>'fromUid' = p_uid
       or v_game.takeback_request->>'from' = v_color then
      raise exception 'Cannot reject own takeback request';
    end if;

    update public.games
    set
      takeback_request = null,
      version = coalesce(version, 0) + 1
    where room_id = p_room_id
    returning * into v_game;

    return v_game;
  end if;

  if p_action = 'accept' then
    if v_game.takeback_request is null then
      raise exception 'No takeback request';
    end if;

    if v_game.takeback_request->>'fromUid' = p_uid
       or v_game.takeback_request->>'from' = v_color then
      raise exception 'Cannot accept own takeback request';
    end if;

    if p_fen_after_undo is null or p_pgn_after_undo is null then
      raise exception 'Missing undo state';
    end if;

    v_turn_after_undo := split_part(p_fen_after_undo, ' ', 2);

    if v_turn_after_undo not in ('w', 'b') then
      raise exception 'Invalid undo turn';
    end if;

    update public.games
    set
      fen = p_fen_after_undo,
      pgn = p_pgn_after_undo,
      turn = v_turn_after_undo,
      takeback_request = null,
      draw_request = null,
      version = coalesce(version, 0) + 1,
      last_move_time = floor(extract(epoch from now()) * 1000)
    where room_id = p_room_id
    returning * into v_game;

    return v_game;
  end if;

  raise exception 'Invalid action';
end;
$$;

revoke all on function public.resolve_takeback_atomic(
  text, text, text, text, text
) from public;

grant execute on function public.resolve_takeback_atomic(
  text, text, text, text, text
) to authenticated;


create or replace function public.resign_game_atomic(
  p_room_id text,
  p_uid text,
  p_player_color text
)
returns public.games
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
  v_message text;
begin
  if auth.uid() is null or auth.uid()::text <> p_uid then
    raise exception 'Auth uid mismatch';
  end if;

  select *
  into v_game
  from public.games
  where room_id = p_room_id
  for update;

  if not found then
    raise exception 'Game not found';
  end if;

  if v_game.game_state = 'game_over' then
    raise exception 'Game already finished';
  end if;

  if v_game.players->>'white' <> p_uid
     and v_game.players->>'black' <> p_uid then
    raise exception 'Not a player';
  end if;

  if p_player_color not in ('w', 'b') then
    raise exception 'Invalid player color';
  end if;

  if (p_player_color = 'w' and v_game.players->>'white' <> p_uid)
     or (p_player_color = 'b' and v_game.players->>'black' <> p_uid) then
    raise exception 'Color mismatch';
  end if;

  if p_player_color = 'w' then
    v_message := 'Черные победили (сдача)';
  else
    v_message := 'Белые победили (сдача)';
  end if;

  update public.games
  set
    game_state = 'game_over',
    message = v_message,
    resign = p_player_color,
    draw_request = null,
    takeback_request = null,
    version = coalesce(version, 0) + 1,
    last_move_time = floor(extract(epoch from now()) * 1000)
  where room_id = p_room_id
  returning * into v_game;

  return v_game;
end;
$$;

revoke all on function public.resign_game_atomic(text, text, text) from public;

grant execute on function public.resign_game_atomic(text, text, text) to authenticated;
