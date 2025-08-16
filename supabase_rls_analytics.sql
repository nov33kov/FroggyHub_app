-- RLS policies for analytics

-- EVENTS
alter table public.events enable row level security;
create policy "events_owner_or_participant_select" on public.events
  for select using (
    auth.uid() = owner_id or
    auth.uid() in (select user_id from public.participants where event_id = id)
  );
create policy "events_owner_update" on public.events
  for update using (auth.uid() = owner_id);

-- PARTICIPANTS
alter table public.participants enable row level security;
create policy "participants_owner_or_self_select" on public.participants
  for select using (
    auth.uid() = user_id or
    auth.uid() = (select owner_id from public.events e where e.id = participants.event_id)
  );

-- WISHLIST ITEMS
alter table public.wishlist_items enable row level security;
create policy "wishlist_owner_or_participant_select" on public.wishlist_items
  for select using (
    auth.uid() = (select owner_id from public.events e where e.id = wishlist_items.event_id)
    or auth.uid() in (select user_id from public.participants p where p.event_id = wishlist_items.event_id)
  );
create policy "wishlist_take" on public.wishlist_items
  for update using (
    auth.uid() = (select owner_id from public.events e where e.id = wishlist_items.event_id)
    or auth.uid() = taken_by
  ) with check (
    auth.uid() = (select owner_id from public.events e where e.id = wishlist_items.event_id)
    or auth.uid() = taken_by
  );
