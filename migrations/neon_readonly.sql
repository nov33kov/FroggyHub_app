-- role for read-only access
-- роль для чтения
create role app_ro login password '<GENERATE_STRONG_PASSWORD>';

-- revoke write permissions by default
-- запрет на запись по умолчанию
revoke all on schema public from app_ro;
revoke all on all tables in schema public from app_ro;
revoke all on all sequences in schema public from app_ro;

-- allow usage of schema
-- право использования схемы
grant usage on schema public to app_ro;

-- allow read on existing tables
-- чтение всех существующих таблиц
grant select on all tables in schema public to app_ro;

-- auto grants for future tables
-- авто-гранты для будущих таблиц
alter default privileges in schema public grant select on tables to app_ro;
