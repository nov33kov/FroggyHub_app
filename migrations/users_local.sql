create table if not exists local_users (
  id bigserial primary key,
  username text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

-- ensure unique index on username
create unique index if not exists local_users_username_key on local_users(username);
