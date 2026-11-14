-- Take payment (13 Nov 2026), as the previous version: each payment taken on an order is kept (amount, how, reference,
-- the day, who), the order's paid total and its balance owing follow by themselves, and the sales order's history
-- records it. Home's COD balance lists the COD orders still owing.
alter table public.orders add column if not exists paid numeric(14,2) not null default 0;
create table if not exists public.order_payments (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  method text not null check (method in ('Card', 'Cash', 'Bank transfer', 'EFTPOS', 'Cheque', 'Other')),
  ref text not null default '',
  paid_on date not null default current_date,
  by_email text not null default '',
  by_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists order_payments_order_idx on public.order_payments (order_id);
alter table public.order_payments enable row level security;
drop policy if exists "staff read payments" on public.order_payments;
create policy "staff read payments" on public.order_payments for select to authenticated using (public.my_role() <> '');
drop policy if exists "office takes payments" on public.order_payments;
create policy "office takes payments" on public.order_payments for insert to authenticated with check (public.my_role() in ('admin', 'office'));
drop policy if exists "admin removes payments" on public.order_payments;
create policy "admin removes payments" on public.order_payments for delete to authenticated using (public.my_role() = 'admin');

create or replace function public.ev_payments() returns trigger language plpgsql security definer set search_path to '' as $fn$
declare oid bigint := coalesce(new.order_id, old.order_id);
begin
  update public.orders set paid = coalesce((select sum(amount) from public.order_payments where order_id = oid), 0) where id = oid;
  if tg_op = 'INSERT' then
    insert into public.order_events (order_id, part, text, by_email, by_name)
    values (oid, 'so', 'Payment taken: $' || to_char(new.amount, 'FM999,999,990.00') || ' by ' || new.method || coalesce(nullif(' · ' || new.ref, ' · '), '') || ' (paid ' || to_char(new.paid_on, 'DD Mon YYYY') || ')', new.by_email, new.by_name);
  else
    perform public.log_order_event(oid, 'so', '', 'Payment removed: $' || to_char(old.amount, 'FM999,999,990.00') || ' by ' || old.method || coalesce(nullif(' · ' || old.ref, ' · '), ''));
  end if;
  return coalesce(new, old);
end $fn$;
drop trigger if exists ev_payments on public.order_payments;
create trigger ev_payments after insert or delete on public.order_payments for each row execute function public.ev_payments();
select 'ok' as payments;
