create extension if not exists pgcrypto;

create table public.local_users (
  id uuid primary key default gen_random_uuid(),
  username citext not null unique,
  password_hash text not null,
  created_at timestamptz not null default now(),
  last_login timestamptz
);
alter table public.local_users enable row level security;
create policy "me_select" on public.local_users
  for select using (auth.uid() = id);
revoke insert, update, delete on public.local_users from anon, authenticated;

-- profiles
create table public.profiles (
  id uuid primary key references public.local_users(id) on delete cascade,
  nickname text not null,
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;
create policy "profiles owner" on public.profiles
  for all using (auth.uid() = id);
create unique index profiles_nickname_key on public.profiles(nickname);

-- events
create table public.events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.local_users(id) on delete cascade,
  join_code text unique not null,
  title text not null,
  event_at timestamptz,
  created_at timestamptz default now()
);
alter table public.events enable row level security;
create policy "events insert" on public.events
  for insert with check (auth.uid() = owner_id);
create policy "events select" on public.events
  for select using (
    auth.uid() = owner_id
    or exists(select 1 from public.participants p where p.event_id = id and p.user_id = auth.uid())
  );
create policy "events update" on public.events
  for update using (auth.uid() = owner_id);
create policy "events delete" on public.events
  for delete using (auth.uid() = owner_id);

-- participants
create table public.participants (
  event_id uuid references public.events(id) on delete cascade,
  user_id  uuid references public.local_users(id) on delete cascade,
  joined_at timestamptz default now(),
  primary key(event_id, user_id)
);
alter table public.participants enable row level security;
create policy "self participant" on public.participants
  for all using (auth.uid() = user_id);

create policy "participants owner select" on public.participants
  for select using (
    auth.uid() = (select owner_id from public.events e where e.id = participants.event_id)
  );

-- wishlist_items
create table public.wishlist_items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  owner_id uuid not null references public.local_users(id) on delete cascade,
  title text not null,
  url text,
  reserved_by uuid references public.local_users(id),
  created_at timestamptz default now()
);
alter table public.wishlist_items enable row level security;
create policy "view event wishlist" on public.wishlist_items
  for select using (
    event_id in (
      select event_id from public.participants where user_id = auth.uid()
      union select id from public.events where owner_id = auth.uid()
    )
  );
create policy "insert own wishlist items" on public.wishlist_items
  for insert with check (owner_id = auth.uid());
create policy "update own wishlist items" on public.wishlist_items
  for update using (owner_id = auth.uid());
create policy "reserve wishlist items" on public.wishlist_items
  for update using (
    event_id in (
      select event_id from public.participants where user_id = auth.uid()
      union select id from public.events where owner_id = auth.uid()
    )
  );

-- cookie_consents
create table public.cookie_consents (
  user_id uuid primary key references public.local_users(id) on delete cascade,
  consented boolean not null default false,
  updated_at timestamptz default now()
);
alter table public.cookie_consents enable row level security;
create policy "cookie owner" on public.cookie_consents
  for all using (auth.uid() = user_id);

-- RPC to change password
create or replace function public.local_set_password(new_pass text)
returns void
language sql
security definer
as $$
  update public.local_users
  set password_hash = crypt(new_pass, gen_salt('bf', 12))
  where id = auth.uid();
$$;
grant execute on function public.local_set_password(text) to authenticated;
