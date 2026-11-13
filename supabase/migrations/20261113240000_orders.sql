-- New Order (13 Nov 2026): orders, their loads (one per material: delivery or pick-up, site, day, time, the questions)
-- and their lines (products and the additional charges), as the previous portal's form keeps them.
create sequence if not exists public.order_no_seq start 2001;
create table if not exists public.orders (
  id bigint generated always as identity primary key,
  number text unique,                          -- ORD-2001 when placed (quotes: QUO-2001); drafts have none
  kind text not null default 'order' check (kind in ('order', 'quote')),
  status text not null default 'draft' check (status in ('draft', 'placed', 'quote', 'cancelled')),
  customer_id bigint references public.customers(id),
  customer_name text not null default '',
  terms text not null default 'cod',
  price_list text not null default 'builder',
  contact_name text not null default '',
  contact_phone text not null default '',
  email text not null default '',
  their_po text not null default '',
  instructions text not null default '',
  subtotal numeric(14,2) not null default 0,
  gst numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  created_by text not null default '',
  created_by_name text not null default '',
  placed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.order_loads (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  category text not null,
  fulfil text not null default 'delivery' check (fulfil in ('delivery', 'pickup')),
  site_address text not null default '',
  want_date date,
  want_time text not null default 'Any time',
  answers jsonb not null default '{}'::jsonb,  -- waffle pods: location, hours, scrap, gate, trailer; concrete: plant, pour…
  status text not null default 'pending' check (status in ('pending', 'on_hold', 'booked', 'delivered', 'cancelled')),
  booked_date date,
  booked_time text,
  sort int not null default 0
);
create table if not exists public.order_lines (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  load_id bigint references public.order_loads(id) on delete cascade,
  product_id bigint references public.products(id),
  code text not null default '',
  name text not null default '',
  unit text not null default 'each',
  qty numeric(14,3) not null default 0,
  price numeric(14,4) not null default 0,
  list_price numeric(14,4),
  price_reason text not null default '',
  is_charge boolean not null default false,
  charge_key text not null default '',
  sort int not null default 0
);
create index if not exists order_loads_order_idx on public.order_loads (order_id);
create index if not exists order_lines_order_idx on public.order_lines (order_id);
alter table public.orders enable row level security;
alter table public.order_loads enable row level security;
alter table public.order_lines enable row level security;
do $do$ declare t text; begin
  foreach t in array array['orders', 'order_loads', 'order_lines'] loop
    execute format('drop policy if exists "staff read %1$s" on public.%1$s', t);
    execute format('create policy "staff read %1$s" on public.%1$s for select to authenticated using (public.my_role() <> '''')', t);
    execute format('drop policy if exists "office writes %1$s" on public.%1$s', t);
    execute format('create policy "office writes %1$s" on public.%1$s for all to authenticated using (public.my_role() in (''admin'', ''office'')) with check (public.my_role() in (''admin'', ''office''))', t);
  end loop;
end $do$;

-- placing: the number (ORD-… or QUO-…), the status, and the invoice to the Xero queue (orders only)
create or replace function public.place_order(p_id bigint) returns jsonb
language plpgsql security definer set search_path to '' as $fn$
declare o public.orders; n text; c public.customers; lines jsonb;
begin
  if public.my_role() not in ('admin', 'office') then raise exception 'Only the office places orders.'; end if;
  select * into o from public.orders where id = p_id for update;
  if o.id is null then raise exception 'No such order.'; end if;
  if o.status <> 'draft' then return jsonb_build_object('number', o.number, 'already', true); end if;
  if o.customer_id is null then raise exception 'Choose the company.'; end if;
  if not exists (select 1 from public.order_lines where order_id = p_id and not is_charge) then raise exception 'Add at least one product.'; end if;
  if exists (select 1 from public.order_lines l where l.order_id = p_id and l.list_price is not null and abs(l.price - l.list_price) >= 0.005 and length(btrim(l.price_reason)) < 3) then
    raise exception 'Give the reason for every changed price.'; end if;
  n := (case when o.kind = 'quote' then 'QUO-' else 'ORD-' end) || nextval('public.order_no_seq');
  update public.orders set number = n, status = case when o.kind = 'quote' then 'quote' else 'placed' end, placed_at = now(), updated_at = now() where id = p_id;
  if o.kind = 'order' then
    select * into c from public.customers where id = o.customer_id;
    select coalesce(jsonb_agg(jsonb_build_object('ItemCode', nullif(l.code, ''), 'Description', l.name, 'Quantity', l.qty, 'UnitAmount', l.price,
      'AccountCode', coalesce(p.xero_sales_account, '200'), 'TaxType', coalesce(p.xero_tax_type, 'OUTPUT')) order by l.sort), '[]'::jsonb)
      into lines from public.order_lines l left join public.products p on p.id = l.product_id where l.order_id = p_id and l.qty > 0;
    insert into public.xero_queue (kind, action, ref, party, amount, payload, created_by)
    values ('SO', 'create', n, o.customer_name, o.total,
      jsonb_build_object('Type', 'ACCREC', 'Status', 'DRAFT', 'Contact', jsonb_build_object('ContactID', c.xero_contact_id), 'Reference', n || coalesce(nullif(' · ' || o.their_po, ' · '), ''),
        'Date', to_char(now() at time zone 'Australia/Sydney', 'YYYY-MM-DD'), 'LineAmountTypes', 'Exclusive', 'LineItems', lines),
      coalesce(auth.jwt() ->> 'email', ''));
  end if;
  return jsonb_build_object('number', n);
end $fn$;
revoke all on function public.place_order(bigint) from public, anon;
grant execute on function public.place_order(bigint) to authenticated;
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('orders', 'order_loads', 'order_lines')) as tables;
