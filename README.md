# FroggyHub

## Database schema
The `supabase.sql` file contains migrations for the project. It creates the following tables with Row Level Security (RLS):

- **profiles** – user profiles linked to `auth.users`. Only the owner can read or modify their profile.
- **events** – events owned by a profile. Policies allow owners to manage their events and participants to read them.
- **participants** – relation between users and events. Users can access only rows for themselves.
- **wishlist_items** – wishlist entries for an event. Owners can edit their own items, and participants may reserve gifts.
- **cookie_consents** – stores a boolean consent flag per user.

Run the script against your Supabase project to set up the database and policies:

```sql
psql "$SUPABASE_DB_URL" < supabase.sql
```

## Netlify functions
Two serverless functions use the service role key (`SUPABASE_SERVICE_ROLE_KEY`) to interact with Supabase:

- `api/join-by-code.js` – joins the current user to an event by code.
- `api/event-by-code.js` – returns event information, participants and wishlist.

Configure the connection credentials in `netlify.toml` or the Netlify dashboard:

```toml
[build.environment]
SUPABASE_URL = "..."
SUPABASE_SERVICE_ROLE_KEY = "..."
```

The former `SUPABASE_SERVICE_KEY` name is still accepted as a fallback for older deployments.

## Secondary sync (Neon)

A scheduled Netlify function copies changed rows from the primary Supabase database
into a secondary Neon instance for read-only analytics. The replica may lag by up to
one hour.

### Configuration

Set the following environment variables in Netlify:

- `SUPABASE_DB_URL` – connection string to the primary database (read/write).
- `RW_NEON_URL` – Neon database URL with write access for the sync process.
- `DATABASE_URL` – connection string for application queries.
- `SYNC_BATCH_LIMIT` – maximum rows per batch (default: `2000`).
- `SYNC_TABLES` – comma separated list of tables to replicate
  (`profiles,events,participants,wishlist_items,cookie_consents`).

### Full initial load

To backfill the replica from scratch set `FULL_SYNC=true` in the environment and
trigger the `sync-secondary` function. After the first successful run disable the
flag so that subsequent runs only transfer new or updated rows.

### Validation

Compare `count(*)` for each table between the primary and secondary databases.

### Limitations

Cascade deletes are not synchronised. Use `deleted_at` columns and filter on
`where deleted_at is null` in analytics queries.

## Cookie consent
A simple banner is rendered at the bottom of the page asking the visitor to accept or decline cookies. The choice is stored in `localStorage` and synchronised with the `cookie_consents` table when the user is authenticated. Declining removes optional scripts such as analytics.

## Development
1. Install dependencies: `npm install`.
2. Run tests and lint: `npm test`.
3. Start local development with Netlify: `npm run dev`.

## Regional connectivity & proxy

Some regions block direct access to `*.supabase.co`. The app can automatically fall back to a proxied endpoint.

- `PROXY_SUPABASE_URL` points to `/supabase` which is proxied to the original project through Netlify `_redirects`.
- On start the client performs a quick health probe to `SUPABASE_URL`. If it fails within 1500 ms, the client re‑initialises with the proxy URL and stores the choice in `sessionStorage`.
- Auth, REST, Storage and Functions requests are proxied; Realtime can also be proxied through an optional edge function.
- The proxy must not expose a `SERVICE_ROLE` key – only the anonymous key is used in the browser.
- To disable the proxy, remove the fallback code and the `/supabase` rules when regional restrictions are not an issue.

## Email confirmation

- Enable at **Project Settings → Auth → Email confirmations** in Supabase.
- When enabled, a session is not created until the user clicks the link in the email.
- **Redirect URLs** must include `https://froggyhubapp.netlify.app` and preview domains.
- Emails may arrive with a delay – the UI must not wait for the session.

## Testing checklist
- Apply the SQL migrations.
- Create users and profiles, create an event, join via code from another user.
- Verify wishlist reservations and RLS rules for non-participants.
- Check that cookie consent is saved and synced after sign in/out.
- Removing an event should cascade to participants and wishlist items.
- Creating an event while logged out shows a warning and does not throw errors.
- Creating an event right after logging in succeeds and sets `owner_id` to the current user.
- After the session expires, clicking “Сгенерировать код” should prompt the user to sign in again.

## Auth smoke tests

- Password login on the direct Supabase domain leads to the lobby.
- When `supabase.co` is blocked, the first login attempt fails, the client switches to `/supabase` and the second attempt succeeds.
- Sign-up with email confirmation enabled shows a “Check your inbox” message; after confirming, the session is established.
- Logging in via email link (OTP) creates a session without a password.
- Reloading the page preserves the session (`persistSession=true`).
- Reset password flow sends email and successfully updates the password.
- Resend confirmation email works when the initial link expires.
- `autoRefreshToken` keeps the session alive for over an hour during activity.
- Throttling limits password attempts and falls back to OTP after repeated failures.
- Logout clears session, temp data and proxy mode.
- Registration with confirmation **OFF** creates a session immediately, upserts profile and redirects to the lobby.
- Registration with confirmation **ON** shows the “Check your inbox” screen and a “Resend” button without hanging.
- Mobile users in restricted regions hit a timeout first, switch to the proxy and complete registration or email delivery.
- Cancelling during “Регистрируем…” returns the UI to idle state.

## Быстрый чек авторизации

- Переключение «Регистрация» → кнопка кликается, активируется только при валидных полях.
- Логин: при неверном пароле — кнопка возвращается из «Входим…».
- Таймаут сети → кнопка не зависает, срабатывает прокси‑ретрай один раз.
- Баннер cookies скрыт → форма кликабельна.
- На мобиле вкладки меняются, всё кликается.

## Event flow smoke check

- Создание события с валидными полями возвращает код за 2–3 с.
- При сетевой ошибке показывается понятное сообщение, кнопка не зависает.
- Неверный код при присоединении даёт аккуратную ошибку и активирует кнопку.
- При отключённой сети запрос тайм‑аутится через 15 с, выполняется один ретрай и выводится сообщение.
- Повторный клик во время запроса игнорируется.
- Все сообщения дублируются в `aria-live` блоках.

## Username auth smoke check

- Регистрация по нику и паролю: 409 при дубликате, иначе успешный вход.
- Вход по нику/паролю показывает только свои данные (RLS работает).
- Выход очищает токен и скрывает приватные экраны.
- Повторная попытка создать аккаунт с тем же ником возвращает 409 и кнопку в idle.
