-- Profiles: one row per account, 1:1 with auth.users, holds subscription state.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  subscription_status text not null default 'canceled'
    check (subscription_status in ('trialing', 'active', 'past_due', 'canceled')),
  subscription_plan text
    check (subscription_plan in ('monthly', 'yearly')),
  stripe_customer_id text,
  created_at timestamptz not null default now()
);

create unique index profiles_username_idx on public.profiles (lower(username));
create unique index profiles_stripe_customer_id_idx on public.profiles (stripe_customer_id) where stripe_customer_id is not null;

alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  using (id = auth.uid());

create policy "profiles_update_own"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- Subscription fields must never be changed by the account owner directly:
-- only the Stripe webhook (running as service_role) may update them.
create function public.protect_subscription_columns()
returns trigger
language plpgsql
as $$
begin
  if auth.role() <> 'service_role' then
    if new.subscription_status is distinct from old.subscription_status
       or new.subscription_plan is distinct from old.subscription_plan
       or new.stripe_customer_id is distinct from old.stripe_customer_id then
      raise exception 'subscription fields can only be updated by the billing system';
    end if;
  end if;
  return new;
end;
$$;

create trigger protect_subscription_columns
  before update on public.profiles
  for each row execute function public.protect_subscription_columns();

-- Auto-create a profile row whenever a new auth.users row is created.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper used by RLS policies on business tables to gate access behind an
-- active subscription. security definer + fixed search_path avoids RLS
-- recursion and search_path hijacking.
create function public.has_active_subscription()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and subscription_status in ('trialing', 'active')
  );
$$;

grant execute on function public.has_active_subscription() to authenticated;
