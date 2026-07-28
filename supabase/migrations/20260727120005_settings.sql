create table public.settings (
  owner_id uuid primary key references public.profiles (id) on delete cascade,
  gerant_email text,
  comptable_email text
);

alter table public.settings enable row level security;

create policy "settings_select_own"
  on public.settings for select
  using (owner_id = auth.uid());

create policy "settings_insert_own"
  on public.settings for insert
  with check (owner_id = auth.uid());

create policy "settings_update_own"
  on public.settings for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "settings_delete_own"
  on public.settings for delete
  using (owner_id = auth.uid());
