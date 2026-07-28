create table public.history (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  product_name text not null,
  type text not null check (type in ('entree', 'sortie')),
  qty numeric not null,
  unit text not null,
  note text,
  created_at timestamptz not null default now()
);

create index history_owner_id_created_at_idx on public.history (owner_id, created_at desc);
create index history_product_id_idx on public.history (product_id);

alter table public.history enable row level security;

create policy "history_select_own"
  on public.history for select
  using (owner_id = auth.uid() and public.has_active_subscription());

create policy "history_insert_own"
  on public.history for insert
  with check (owner_id = auth.uid() and public.has_active_subscription());

-- History is an append-only audit trail: no update policy.
-- Deletion is allowed only so an account can be fully purged by its owner.
create policy "history_delete_own"
  on public.history for delete
  using (owner_id = auth.uid());
