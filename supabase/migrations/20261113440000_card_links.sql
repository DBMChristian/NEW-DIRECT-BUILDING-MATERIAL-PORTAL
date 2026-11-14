-- Card payment links (13 Nov 2026), as the previous portal: each Stripe link made for an order (its amount and card
-- surcharge, live or closed, paid when), and the surcharge settings brought across (1.8% until 30 Sep 2026: no surcharge
-- after that day unless the date is moved).
create table if not exists public.order_card_links (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  link_id text not null unique,
  url text not null,
  amount numeric(14,2) not null,
  surcharge numeric(14,2) not null default 0,
  active boolean not null default true,
  paid_at timestamptz,
  by_email text not null default '',
  by_name text not null default '',
  created_at timestamptz not null default now()
);
alter table public.order_card_links enable row level security;
drop policy if exists "staff read card links" on public.order_card_links;
create policy "staff read card links" on public.order_card_links for select to authenticated using (public.my_role() <> '');
insert into public.settings (key, value) values ('card_surcharge_pct', '1.8'), ('surcharge_until', '2026-09-30'), ('portal_url', 'https://portal.directbuildingmaterial.com.au') on conflict (key) do nothing;
select key, value from public.settings where key in ('card_surcharge_pct', 'surcharge_until');
