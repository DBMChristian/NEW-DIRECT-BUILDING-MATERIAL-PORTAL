-- A placed order cannot lose or gain lines, loads or POs from a draft save (13 Nov 2026): adding or deleting them is
-- refused once the order is no longer a draft. Updates (booking, PO numbers, portal numbers) are still allowed.
create or replace function public.order_child_locked() returns trigger
language plpgsql security definer set search_path to '' as $fn$
declare oid bigint; st text;
begin
  if tg_table_name in ('order_lines', 'order_loads', 'order_pos') then oid := coalesce(new.order_id, old.order_id);
  elsif tg_table_name = 'order_load_items' then select l.order_id into oid from public.order_loads l where l.id = coalesce(new.load_id, old.load_id);
  elsif tg_table_name = 'order_po_items' then select p.order_id into oid from public.order_pos p where p.id = coalesce(new.po_id, old.po_id); end if;
  select status into st from public.orders where id = oid;
  if st is not null and st <> 'draft' then raise exception 'This order is placed: its lines, loads and POs can no longer be added or deleted from the form.'; end if;
  return coalesce(new, old);
end $fn$;
do $do$ declare t text; begin
  foreach t in array array['order_lines', 'order_loads', 'order_pos', 'order_load_items', 'order_po_items'] loop
    execute format('drop trigger if exists %1$s_locked on public.%1$s', t);
    execute format('create trigger %1$s_locked before insert or delete on public.%1$s for each row execute function public.order_child_locked()', t);
  end loop;
end $do$;
-- ORD-2001: its POs lost their numbers to a draft save after placing; they get them back (PO-2001, PO-2001-1 …)
update public.order_pos p set number = 'PO-2001' || case when r.k = 0 then '' else '-' || r.k end, status = case when p.send then 'sent' else 'to_send' end
from (select id, row_number() over (order by sort) - 1 as k from public.order_pos where order_id = 6) r
where p.id = r.id and p.order_id = 6 and p.number is null;
select number, supplier_name, portal, send from public.order_pos where order_id = 6 order by sort;
