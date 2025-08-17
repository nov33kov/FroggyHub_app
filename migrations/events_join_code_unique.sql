-- ensure unique index on events.join_code
create unique index if not exists events_join_code_key on events(join_code);
