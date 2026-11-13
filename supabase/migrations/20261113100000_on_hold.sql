-- Customers (13 Nov 2026): On hold, Yes or No (Direct's own; a sync never changes it).
alter table public.customers add column if not exists on_hold boolean not null default false;
select count(*) as customers, count(*) filter (where on_hold) as on_hold from public.customers;
