-- Home > COD balance (13 Nov 2026): each unpaid sales invoice from Xero (awaiting approval or awaiting payment), read at
-- every customer sync, so Home lists the orders with money still owing rather than just a total per customer.
create table if not exists public.xero_invoices (
  xero_invoice_id uuid primary key,
  number text not null default '',
  reference text not null default '',
  xero_contact_id uuid,
  customer_name text not null default '',
  status text not null default '',
  invoice_date date,
  due_date date,
  total numeric(14,2) not null default 0,
  amount_due numeric(14,2) not null default 0,
  synced_at timestamptz not null default now()
);
create index if not exists xero_invoices_contact_idx on public.xero_invoices (xero_contact_id);
alter table public.xero_invoices enable row level security;
drop policy if exists "staff read xero invoices" on public.xero_invoices;
create policy "staff read xero invoices" on public.xero_invoices for select to authenticated using (public.my_role() in ('admin', 'office'));
select count(*) as invoices from public.xero_invoices;
