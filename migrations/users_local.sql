create table if not exists users_local (
  id bigserial primary key,
  nickname text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

-- ensure unique index on nickname
create unique index if not exists users_local_nickname_key on users_local(nickname);
