create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create index recipes_owner_id_idx on public.recipes (owner_id);

alter table public.recipes enable row level security;

create policy "recipes_select_own"
  on public.recipes for select
  using (owner_id = auth.uid() and public.has_active_subscription());

create policy "recipes_insert_own"
  on public.recipes for insert
  with check (owner_id = auth.uid() and public.has_active_subscription());

create policy "recipes_update_own"
  on public.recipes for update
  using (owner_id = auth.uid() and public.has_active_subscription())
  with check (owner_id = auth.uid());

create policy "recipes_delete_own"
  on public.recipes for delete
  using (owner_id = auth.uid() and public.has_active_subscription());

create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  qty numeric not null
);

create index recipe_ingredients_recipe_id_idx on public.recipe_ingredients (recipe_id);
create index recipe_ingredients_product_id_idx on public.recipe_ingredients (product_id);

alter table public.recipe_ingredients enable row level security;

-- recipe_ingredients has no owner_id of its own: ownership is derived from
-- the parent recipe, which is itself scoped to auth.uid() by its own RLS.
create policy "recipe_ingredients_select_own"
  on public.recipe_ingredients for select
  using (
    public.has_active_subscription()
    and exists (
      select 1 from public.recipes r
      where r.id = recipe_ingredients.recipe_id and r.owner_id = auth.uid()
    )
  );

create policy "recipe_ingredients_insert_own"
  on public.recipe_ingredients for insert
  with check (
    public.has_active_subscription()
    and exists (
      select 1 from public.recipes r
      where r.id = recipe_ingredients.recipe_id and r.owner_id = auth.uid()
    )
    and exists (
      select 1 from public.products p
      where p.id = recipe_ingredients.product_id and p.owner_id = auth.uid()
    )
  );

create policy "recipe_ingredients_update_own"
  on public.recipe_ingredients for update
  using (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_ingredients.recipe_id and r.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_ingredients.recipe_id and r.owner_id = auth.uid()
    )
  );

create policy "recipe_ingredients_delete_own"
  on public.recipe_ingredients for delete
  using (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_ingredients.recipe_id and r.owner_id = auth.uid()
    )
  );
