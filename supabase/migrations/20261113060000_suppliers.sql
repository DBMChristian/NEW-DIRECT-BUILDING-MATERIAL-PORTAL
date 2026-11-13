-- Admin > Suppliers (13 Nov 2026): who Direct orders from, through which portal, for which materials, and the emails a
-- purchase order goes to (To) and is copied to (CC). Two suppliers to start:
--  * Discount Building Material Pty Ltd: Concrete through OrderConcrete; every other material except Wafflepods through
--    OrderSteel;
--  * Styrofoam Industries: Wafflepods through OrderPods.
create table if not exists public.suppliers (
  id bigint generated always as identity primary key,
  name text not null unique check (length(btrim(name)) > 0),
  active boolean not null default true,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.supplier_routes (
  id bigint generated always as identity primary key,
  supplier_id bigint not null references public.suppliers(id) on delete cascade,
  portal text not null default '' check (portal in ('', 'OrderConcrete', 'OrderSteel', 'OrderPods')),
  categories text[] not null default '{}',
  email_to text[] not null default '{}',
  email_cc text[] not null default '{}',
  active boolean not null default true,
  sort int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.suppliers enable row level security;
alter table public.supplier_routes enable row level security;
drop policy if exists "staff read suppliers" on public.suppliers;
create policy "staff read suppliers" on public.suppliers for select to authenticated using (public.my_role() <> '');
drop policy if exists "admin edits suppliers" on public.suppliers;
create policy "admin edits suppliers" on public.suppliers for all to authenticated using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
drop policy if exists "staff read supplier routes" on public.supplier_routes;
create policy "staff read supplier routes" on public.supplier_routes for select to authenticated using (public.my_role() <> '');
drop policy if exists "admin edits supplier routes" on public.supplier_routes;
create policy "admin edits supplier routes" on public.supplier_routes for all to authenticated using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

insert into public.suppliers (name) values ('Discount Building Material Pty Ltd'), ('Styrofoam Industries') on conflict (name) do nothing;
insert into public.supplier_routes (supplier_id, portal, categories, email_to, sort)
select s.id, r.portal, r.categories, r.email_to, r.sort from public.suppliers s
join (values
  ('Discount Building Material Pty Ltd', 'OrderConcrete', array['Concrete'], array['concrete@discountbuildingmaterial.com.au'], 1),
  ('Discount Building Material Pty Ltd', 'OrderSteel', array['Rediwall', 'Reinforcement', 'Hebel', 'Bricks', 'NRG', 'Bluedeck', 'Others'], array['sales@discountbuildingmaterial.com.au'], 2),
  ('Styrofoam Industries', 'OrderPods', array['Wafflepods'], array['orders@styrofoamindustries.com.au'], 1)
) as r(supplier, portal, categories, email_to, sort) on r.supplier = s.name
where not exists (select 1 from public.supplier_routes x where x.supplier_id = s.id and x.portal = r.portal);
select s.name, r.portal, array_to_string(r.categories, ', ') as materials, array_to_string(r.email_to, ', ') as email_to
  from public.supplier_routes r join public.suppliers s on s.id = r.supplier_id order by s.name, r.sort;
