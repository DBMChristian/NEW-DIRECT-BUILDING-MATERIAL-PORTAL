-- Admin > Xero (13 Nov 2026): every upload to Xero waits here until it has gone: sales orders (Xero invoices) and
-- purchase orders, each creating, updating or deleting one document. The portal adds to the queue as orders change
-- (from the order steps); "Sync now" sends one straight away; a failure keeps its reason and can be sent again.
create table if not exists public.xero_queue (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('SO', 'PO')),
  action text not null check (action in ('create', 'update', 'delete')),
  ref text not null default '',
  party text not null default '',
  amount numeric(14,2),
  payload jsonb not null default '{}'::jsonb,
  xero_id uuid,
  status text not null default 'waiting' check (status in ('waiting', 'sending', 'failed', 'done')),
  attempts int not null default 0,
  last_error text,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_by text
);
create index if not exists xero_queue_status_idx on public.xero_queue (status, created_at);
alter table public.xero_queue enable row level security;
drop policy if exists "staff read xero queue" on public.xero_queue;
create policy "staff read xero queue" on public.xero_queue for select to authenticated using (public.my_role() in ('admin', 'office'));
select count(*) as queued from public.xero_queue where status <> 'done';
