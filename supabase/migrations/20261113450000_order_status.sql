-- The order's status (13 Nov 2026), as the previous version: Open, Working On It, Booked, On Hold, Cancelled, Completed.
-- A placed order starts Working On It. Booked sends the booking confirmation (email, and SMS when asked) once by itself;
-- after that it is resent by hand. Every change goes in the sales order's history.
alter table public.orders add column if not exists order_status text not null default 'Working On It';
alter table public.orders drop constraint if exists orders_order_status_check;
alter table public.orders add constraint orders_order_status_check check (order_status in ('Open', 'Working On It', 'Booked', 'On Hold', 'Cancelled', 'Completed'));
alter table public.orders add column if not exists booking_sent_at timestamptz;
update public.orders set order_status = 'Cancelled' where status = 'cancelled' and order_status <> 'Cancelled';

create or replace function public.ev_order_status() returns trigger language plpgsql security definer set search_path to '' as $fn$
begin
  if old.order_status is distinct from new.order_status and new.status <> 'draft' then
    perform public.log_order_event(new.id, 'so', new.number, 'Status: ' || old.order_status || ' → ' || new.order_status); end if;
  if old.status <> 'cancelled' and new.status = 'cancelled' and new.order_status <> 'Cancelled' then
    update public.orders set order_status = 'Cancelled' where id = new.id; end if;
  return new;
end $fn$;
drop trigger if exists ev_order_status on public.orders;
create trigger ev_order_status after update of order_status, status on public.orders for each row execute function public.ev_order_status();
select order_status, count(*) from public.orders where status <> 'draft' group by 1;
