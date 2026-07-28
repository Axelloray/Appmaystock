create table public.products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  base_unit text not null
    check (base_unit in ('kg', 'g', 'L', 'mL', 'unité', 'sac', 'carton', 'botte', 'caisse', 'boîte', 'pièce', 'plaque')),
  stock numeric not null default 0,
  threshold numeric not null default 0,
  photo_url text,
  price_ht numeric,
  price_ttc numeric,
  vat_rate numeric not null default 20
    check (vat_rate in (0, 2.1, 5.5, 10, 20)),
  supplier_name text,
  supplier_email text,
  created_at timestamptz not null default now()
);

create index products_owner_id_idx on public.products (owner_id);
create index products_owner_supplier_idx on public.products (owner_id, supplier_name);

alter table public.products enable row level security;

create policy "products_select_own"
  on public.products for select
  using (owner_id = auth.uid() and public.has_active_subscription());

create policy "products_insert_own"
  on public.products for insert
  with check (owner_id = auth.uid() and public.has_active_subscription());

create policy "products_update_own"
  on public.products for update
  using (owner_id = auth.uid() and public.has_active_subscription())
  with check (owner_id = auth.uid());

create policy "products_delete_own"
  on public.products for delete
  using (owner_id = auth.uid() and public.has_active_subscription());
