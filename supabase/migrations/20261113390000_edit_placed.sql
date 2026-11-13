-- Edit SO / PO / Load on a placed order (13 Nov 2026). begin_edit opens the order for its form to write its lines, loads
-- and POs again (the lock on placed orders lets them through while it is open); end_edit closes it: new POs get their
-- numbers (PO-2005-n), a note says who changed what, and what is in Xero is updated (or made, for a new PO).
alter table public.orders add column if not exists editing boolean not null default false;

create or replace function public.order_child_locked() returns trigger
language plpgsql security definer set search_path to '' as $fn$
declare oid bigint; st text; ed boolean;
begin
  if tg_table_name in ('order_lines', 'order_loads', 'order_pos') then oid := coalesce(new.order_id, old.order_id);
  elsif tg_table_name = 'order_load_items' then select l.order_id into oid from public.order_loads l where l.id = coalesce(new.load_id, old.load_id);
  elsif tg_table_name = 'order_po_items' then select p.order_id into oid from public.order_pos p where p.id = coalesce(new.po_id, old.po_id); end if;
  select status, editing into st, ed from public.orders where id = oid;
  if st is not null and st <> 'draft' and not coalesce(ed, false) then raise exception 'This order is placed: press Edit to change it.'; end if;
  return coalesce(new, old);
end $fn$;

create or replace function public.begin_edit(p_id bigint) returns void
language plpgsql security definer set search_path to '' as $fn$
begin
  if public.my_role() not in ('admin', 'office') then raise exception 'Only the office edits orders.'; end if;
  update public.orders set editing = true where id = p_id and status in ('placed', 'quote');
  if not found then raise exception 'This order cannot be edited (cancelled, or not placed).'; end if;
end $fn$;

create or replace function public.end_edit(p_id bigint, p_part text, p_save boolean) returns jsonb
language plpgsql security definer set search_path to '' as $fn$
declare o public.orders; num text; k int; p record; lines jsonb; qid bigint; q jsonb := '[]'::jsonb; x record; who text := coalesce(auth.jwt() ->> 'email', '');
begin
  if public.my_role() not in ('admin', 'office') then raise exception 'Only the office edits orders.'; end if;
  update public.orders set editing = false where id = p_id returning * into o;
  if o.id is null or not p_save then return jsonb_build_object('xero', q); end if;
  num := regexp_replace(coalesce(o.number, ''), '\D', '', 'g');
  insert into public.order_notes (order_id, text, by_email, by_name)
    values (p_id, 'Edited the ' || case p_part when 'so' then 'sales order' when 'po' then 'purchase orders' when 'load' then 'loads' else 'order' end, who, coalesce((select name from public.staff where email = lower(who)), who));
  /* a new PO gets the next number of the order */
  select count(*) into k from public.order_pos where order_id = p_id and number is not null;
  for p in select * from public.order_pos where order_id = p_id and number is null order by sort loop
    update public.order_pos set number = 'PO-' || num || case when k = 0 then '' else '-' || k end, status = case when p.send then 'sent' else 'to_send' end where id = p.id; k := k + 1;
  end loop;
  if o.kind <> 'order' or not o.upload_xero then return jsonb_build_object('xero', q); end if;
  /* Xero: the invoice again (update when it is there), each PO again (update, or make a new one) */
  select coalesce(jsonb_agg(jsonb_build_object('ItemCode', nullif(g.code, ''), 'Description', g.name, 'Quantity', g.qty, 'UnitAmount', g.price, 'AccountCode', g.acct, 'TaxType', g.tax) order by g.s), '[]'::jsonb)
    into lines from (select l.code, l.name, l.price, sum(l.qty) as qty, min(l.sort + case when l.is_charge then 1000 else 0 end) as s, coalesce(max(pr.xero_sales_account), '200') as acct, coalesce(max(pr.xero_tax_type), 'OUTPUT') as tax
      from public.order_lines l left join public.products pr on pr.id = l.product_id where l.order_id = p_id and l.qty > 0 group by l.code, l.name, l.price) g;
  select * into x from public.xero_queue where ref = 'INV-' || num and kind = 'SO' and action = 'create' and status = 'done' and xero_id is not null order by id desc limit 1;
  if x.id is not null then
    insert into public.xero_queue (kind, action, ref, party, amount, payload, xero_id, created_by)
    values ('SO', 'update', 'INV-' || num, o.customer_name, o.total, jsonb_build_object('LineAmountTypes', 'Exclusive', 'LineItems', lines, 'Reference', o.number || coalesce(nullif(' · ' || o.their_po, ' · '), '')), x.xero_id, who) returning id into qid;
    q := q || to_jsonb(qid);
  end if;
  for p in select * from public.order_pos where order_id = p_id and status <> 'cancelled' order by sort loop
    select * into x from public.xero_queue where ref = p.number and kind = 'PO' and action = 'create' order by id desc limit 1;
    insert into public.xero_queue (kind, action, ref, party, amount, payload, xero_id, created_by)
    select 'PO', case when x.id is not null and x.status = 'done' and x.xero_id is not null then 'update' else 'create' end, p.number, p.supplier_name, round(coalesce(sum(g.qty * g.uc), 0), 2),
      jsonb_build_object('Contact', jsonb_build_object('Name', p.supplier_name), 'Reference', o.number, 'Date', to_char(now() at time zone 'Australia/Sydney', 'YYYY-MM-DD'), 'Status', 'DRAFT',
        'PurchaseOrderNumber', p.number, 'LineAmountTypes', 'Exclusive',
        'LineItems', coalesce(jsonb_agg(jsonb_build_object('ItemCode', nullif(g.code, ''), 'Description', g.name, 'Quantity', g.qty, 'UnitAmount', g.uc) order by g.s), '[]'::jsonb)),
      case when x.id is not null and x.status = 'done' then x.xero_id end, who
    from (select l.code, l.name, coalesce(i.unit_cost, pr.xero_cost_price, 0) as uc, sum(i.qty) as qty, min(l.sort + case when l.is_charge then 1000 else 0 end) as s
      from public.order_po_items i join public.order_lines l on l.id = i.line_id left join public.products pr on pr.id = l.product_id where i.po_id = p.id
      group by l.code, l.name, coalesce(i.unit_cost, pr.xero_cost_price, 0)) g
    returning id into qid;
    /* a PO still waiting in the queue: the old one is replaced by this */
    if x.id is not null and x.status in ('waiting', 'failed') then update public.xero_queue set status = 'done', last_error = 'Replaced by an edit', sent_at = now(), sent_by = who where id = x.id; end if;
    q := q || to_jsonb(qid);
  end loop;
  return jsonb_build_object('xero', q);
end $fn$;
revoke all on function public.begin_edit(bigint) from public, anon;
revoke all on function public.end_edit(bigint, text, boolean) from public, anon;
grant execute on function public.begin_edit(bigint) to authenticated;
grant execute on function public.end_edit(bigint, text, boolean) to authenticated;
select 'ok' as edit_placed;
