-- Customers (13 Nov 2026): what each customer has in Xero, from their sales invoices, read at each customer sync:
-- awaiting approval (submitted), awaiting payment (owing, and the overdue part of it), and invoiced (approved and paid,
-- all time). Xero's figures, never typed here; not part of the history.
alter table public.customers add column if not exists xero_awaiting_approval numeric(14,2) not null default 0;
alter table public.customers add column if not exists xero_awaiting_payment numeric(14,2) not null default 0;
alter table public.customers add column if not exists xero_overdue numeric(14,2) not null default 0;
alter table public.customers add column if not exists xero_invoiced numeric(14,2) not null default 0;
alter table public.customers add column if not exists xero_balances_at timestamptz;
select count(*) as customers from public.customers;
