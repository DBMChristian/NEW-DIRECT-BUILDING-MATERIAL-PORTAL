-- Products (13 Nov 2026): more price lists besides Builder, Installer and Online. Each extra list is a column on the
-- Products page; a product's price on it is kept in product_prices (empty = the Xero price is used).
create table if not exists public.price_lists (
  id bigint generated always as identity primary key,
  name text not null unique check (length(btrim(name)) between 1 and 40),
  sort int not null default 100,
  created_by text,
  created_at timestamptz not null default now()
);
create table if not exists public.product_prices (
  product_id bigint not null references public.products(id) on delete cascade,
  list_id bigint not null references public.price_lists(id) on delete cascade,
  price numeric(14,4) not null,
  updated_at timestamptz not null default now(),
  primary key (product_id, list_id)
);
alter table public.price_lists enable row level security;
alter table public.product_prices enable row level security;
drop policy if exists "staff read price lists" on public.price_lists;
create policy "staff read price lists" on public.price_lists for select to authenticated using (public.my_role() <> '');
drop policy if exists "admin edits price lists" on public.price_lists;
create policy "admin edits price lists" on public.price_lists for all to authenticated using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
drop policy if exists "staff read product prices" on public.product_prices;
create policy "staff read product prices" on public.product_prices for select to authenticated using (public.my_role() <> '');
drop policy if exists "admin edits product prices" on public.product_prices;
create policy "admin edits product prices" on public.product_prices for all to authenticated using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
select count(*) as tables from information_schema.tables where table_schema = 'public' and table_name in ('price_lists', 'product_prices');
