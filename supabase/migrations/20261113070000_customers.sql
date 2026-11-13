-- Admin > Customers (13 Nov 2026): every Xero contact, pulled from Xero (button, and every 30 minutes with the products),
-- with what Direct keeps on top: COD or account, the customer's price list, and the team's notes (shown on every order).
-- A sync only changes the Xero columns; terms, price list and notes are Direct's.
create table if not exists public.customers (
  id bigint generated always as identity primary key,
  xero_contact_id uuid unique,
  name text not null default '',
  first_name text not null default '',
  last_name text not null default '',
  email text not null default '',
  phone text not null default '',
  mobile text not null default '',
  street text not null default '',
  suburb text not null default '',
  state text not null default '',
  postcode text not null default '',
  account_number text not null default '',
  abn text not null default '',
  is_customer boolean not null default false,
  is_supplier boolean not null default false,
  xero_status text not null default 'ACTIVE',
  in_xero boolean not null default true,
  terms text not null default 'cod' check (terms in ('cod', 'account')),
  price_list text not null default 'builder',
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customers_name_idx on public.customers (lower(name));
alter table public.customers enable row level security;
drop policy if exists "staff read customers" on public.customers;
create policy "staff read customers" on public.customers for select to authenticated using (public.my_role() <> '');
drop policy if exists "office edits customers" on public.customers;
create policy "office edits customers" on public.customers for update to authenticated using (public.my_role() in ('admin', 'office')) with check (public.my_role() in ('admin', 'office'));

create table if not exists public.customer_notes (
  id bigint generated always as identity primary key,
  customer_id bigint not null references public.customers(id) on delete cascade,
  text text not null check (length(btrim(text)) > 0),
  by_email text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customer_notes_customer_idx on public.customer_notes (customer_id);
alter table public.customer_notes enable row level security;
drop policy if exists "staff read customer notes" on public.customer_notes;
create policy "staff read customer notes" on public.customer_notes for select to authenticated using (public.my_role() <> '');
drop policy if exists "office writes customer notes" on public.customer_notes;
create policy "office writes customer notes" on public.customer_notes for all to authenticated using (public.my_role() in ('admin', 'office')) with check (public.my_role() in ('admin', 'office'));

-- the every-30-minutes job now syncs the products and the customers
select cron.unschedule(jobid) from cron.job where jobname = 'xero-items-sync';
select cron.schedule('xero-items-sync', '*/30 * * * *', $job$
  select net.http_post(
    url := 'https://qnfuifckyfhiuvqyvkvf.supabase.co/functions/v1/xero',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', (select value from public.app_secrets where name = 'xero_cron_key')),
    body := '{"action":"sync_all"}'::jsonb,
    timeout_milliseconds := 120000);
$job$);
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('customers', 'customer_notes')) as tables,
       (select command like '%sync_all%' from cron.job where jobname = 'xero-items-sync') as job_syncs_both;
