-- New Order with its three tabs (13 Nov 2026), as the previous portal: Build SO (what the customer buys: one invoice),
-- Build PO (what Direct orders: one PO per supplier, or from Penrith stock), Build Load (how it goes out: each truck or
-- pick-up and what is on it). A load can carry several materials; a product can be split over loads and POs.
alter table public.order_loads alter column category set default '';
create table if not exists public.order_load_items (
  load_id bigint not null references public.order_loads(id) on delete cascade,
  line_id bigint not null references public.order_lines(id) on delete cascade,
  qty numeric(14,3) not null default 0,
  primary key (load_id, line_id)
);
create table if not exists public.order_pos (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  supplier_id bigint references public.suppliers(id),
  supplier_name text not null default '',
  portal text not null default '',
  deliver_to text not null default 'site' check (deliver_to in ('site', 'penrith')),
  notes text not null default '',
  status text not null default 'to_send' check (status in ('to_send', 'sent', 'confirmed', 'cancelled')),
  number text,
  sort int not null default 0
);
create table if not exists public.order_po_items (
  po_id bigint not null references public.order_pos(id) on delete cascade,
  line_id bigint not null references public.order_lines(id) on delete cascade,
  qty numeric(14,3) not null default 0,
  primary key (po_id, line_id)
);
alter table public.order_lines add column if not exists from_stock boolean not null default false;
alter table public.order_load_items enable row level security;
alter table public.order_pos enable row level security;
alter table public.order_po_items enable row level security;
do $do$ declare t text; begin
  foreach t in array array['order_load_items', 'order_pos', 'order_po_items'] loop
    execute format('drop policy if exists "staff read %1$s" on public.%1$s', t);
    execute format('create policy "staff read %1$s" on public.%1$s for select to authenticated using (public.my_role() <> '''')', t);
    execute format('drop policy if exists "office writes %1$s" on public.%1$s', t);
    execute format('create policy "office writes %1$s" on public.%1$s for all to authenticated using (public.my_role() in (''admin'', ''office'')) with check (public.my_role() in (''admin'', ''office''))', t);
  end loop;
end $do$;
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('order_load_items', 'order_pos', 'order_po_items')) as tables;
