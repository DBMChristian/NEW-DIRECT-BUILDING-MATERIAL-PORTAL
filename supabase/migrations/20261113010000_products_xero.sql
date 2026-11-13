-- Step 7a (13 Nov 2026): products and their prices, pulled from Xero; the link to Xero itself.
--  * products: every Xero item (code, name, description, Xero's sales and purchase prices, sold/purchased), plus what
--    Direct adds on top (category, unit, the builder / installer / retail price lists). A sync never touches Direct's own
--    columns; an item gone from Xero is kept and marked "not in Xero".
--  * private.xero_link: the one Xero connection (tokens), read and written only by the xero function (service role).
--  * xero_sync_runs: each sync, who ran it and what it changed.
create table if not exists public.products (
  id bigint generated always as identity primary key,
  code text not null unique,
  name text not null default '',
  description text not null default '',
  category text not null default '',
  unit text not null default 'each',
  xero_item_id uuid unique,
  xero_sales_price numeric(14,4),
  xero_cost_price numeric(14,4),
  xero_sales_account text,
  xero_tax_type text,
  is_sold boolean not null default true,
  is_purchased boolean not null default false,
  in_xero boolean not null default true,
  price_builder numeric(14,4),
  price_installer numeric(14,4),
  price_retail numeric(14,4),
  active boolean not null default true,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists products_name_idx on public.products (lower(name));
alter table public.products enable row level security;
drop policy if exists "staff read products" on public.products;
create policy "staff read products" on public.products for select to authenticated using (public.my_role() <> '');
drop policy if exists "admin edits products" on public.products;
create policy "admin edits products" on public.products for update to authenticated using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

create table if not exists public.xero_sync_runs (
  id bigint generated always as identity primary key,
  kind text not null default 'items',
  by_email text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  added int not null default 0,
  updated int not null default 0,
  gone int not null default 0,
  error text
);
alter table public.xero_sync_runs enable row level security;
drop policy if exists "staff read sync runs" on public.xero_sync_runs;
create policy "staff read sync runs" on public.xero_sync_runs for select to authenticated using (public.my_role() <> '');

-- the Xero connection: RLS on and no policies, and no grants, so only the xero function (service role) reads or writes it
create table if not exists public.xero_link (
  id int primary key default 1 check (id = 1),
  tenant_id text, tenant_name text,
  access_token text, refresh_token text, expires_at timestamptz,
  connected_by text, connected_at timestamptz, updated_at timestamptz not null default now()
);
create table if not exists public.xero_oauth_state (
  state text primary key, by_email text not null, return_to text not null, created_at timestamptz not null default now()
);
alter table public.xero_link enable row level security;
alter table public.xero_oauth_state enable row level security;
revoke all on public.xero_link, public.xero_oauth_state from anon, authenticated;

select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('products', 'xero_sync_runs')) as public_tables,
       (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('xero_link', 'xero_oauth_state')) as xero_tables;
