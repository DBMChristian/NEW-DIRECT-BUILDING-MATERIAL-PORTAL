-- Upload to Xero, Yes or No, on the placed order too (13 Nov 2026). No: nothing of the order goes to Xero, edits
-- included. Switching to Yes uploads it straight away: INV-n and every PO (made, or updated when already there); from then
-- on every saved edit updates them by itself (end_edit).
create or replace function public.upload_pos(p_id bigint) returns jsonb
language plpgsql security definer set search_path to '' as $fn$
declare o public.orders; p record; x record; qid bigint; q jsonb := '[]'::jsonb; who text := coalesce(auth.jwt() ->> 'email', '');
begin
  select * into o from public.orders where id = p_id;
  for p in select * from public.order_pos where order_id = p_id and status <> 'cancelled' and number is not null order by sort loop
    select * into x from public.xero_queue where ref = p.number and kind = 'PO' and action in ('create', 'update') order by id desc limit 1;
    if x.id is not null and x.status in ('waiting', 'failed') and x.action = 'create' then update public.xero_queue set status = 'done', last_error = 'Replaced by an edit', sent_at = now(), sent_by = who where id = x.id; end if;
    select * into x from public.xero_queue where ref = p.number and kind = 'PO' and action = 'create' and status = 'done' and xero_id is not null order by id desc limit 1;
    insert into public.xero_queue (kind, action, ref, party, amount, payload, xero_id, created_by)
    select 'PO', case when x.id is not null then 'update' else 'create' end, p.number, p.supplier_name, round(coalesce(sum(g.qty * g.uc), 0), 2),
      jsonb_build_object('Contact', jsonb_build_object('Name', p.supplier_name), 'Reference', o.number, 'Date', to_char(now() at time zone 'Australia/Sydney', 'YYYY-MM-DD'), 'Status', 'DRAFT',
        'PurchaseOrderNumber', p.number, 'LineAmountTypes', 'Exclusive',
        'LineItems', coalesce(jsonb_agg(jsonb_build_object('ItemCode', nullif(g.code, ''), 'Description', g.name, 'Quantity', g.qty, 'UnitAmount', g.uc) order by g.s), '[]'::jsonb)),
      x.xero_id, who
    from (select l.code, l.name, coalesce(i.unit_cost, pr.xero_cost_price, 0) as uc, sum(i.qty) as qty, min(l.sort + case when l.is_charge then 1000 else 0 end) as s
      from public.order_po_items i join public.order_lines l on l.id = i.line_id left join public.products pr on pr.id = l.product_id where i.po_id = p.id
      group by l.code, l.name, coalesce(i.unit_cost, pr.xero_cost_price, 0)) g
    returning id into qid;
    q := q || to_jsonb(qid);
  end loop;
  return q;
end $fn$;
revoke all on function public.upload_pos(bigint) from public, anon, authenticated;

create or replace function public.set_upload_xero(p_id bigint, p_on boolean) returns jsonb
language plpgsql security definer set search_path to '' as $fn$
declare o public.orders; q jsonb := '[]'::jsonb; so jsonb; who text := coalesce(auth.jwt() ->> 'email', '');
begin
  if public.my_role() not in ('admin', 'office') then raise exception 'Only the office changes this.'; end if;
  select * into o from public.orders where id = p_id;
  if o.id is null or o.status <> 'placed' or o.kind <> 'order' then raise exception 'Only a placed order goes to Xero.'; end if;
  update public.orders set upload_xero = p_on where id = p_id;
  insert into public.order_notes (order_id, text, by_email, by_name)
    values (p_id, 'Upload to Xero: ' || case when p_on then 'Yes' else 'No' end, who, coalesce((select name from public.staff where email = lower(who)), who));
  if not p_on then return jsonb_build_object('xero', q); end if;
  so := public.upload_so(p_id);
  q := q || to_jsonb((so ->> 'id')::bigint);
  q := q || public.upload_pos(p_id);
  return jsonb_build_object('xero', q);
end $fn$;
revoke all on function public.set_upload_xero(bigint, boolean) from public, anon;
grant execute on function public.set_upload_xero(bigint, boolean) to authenticated;
select 'ok' as upload_switch;

/* a saved edit: with Upload to Xero Yes, the invoice and every PO go to Xero (updated, or made when not there yet) */
create or replace function public.end_edit(p_id bigint, p_part text, p_save boolean) returns jsonb
language plpgsql security definer set search_path to '' as $fn$
declare o public.orders; num text; k int; p record; q jsonb := '[]'::jsonb; who text := coalesce(auth.jwt() ->> 'email', '');
begin
  if public.my_role() not in ('admin', 'office') then raise exception 'Only the office edits orders.'; end if;
  update public.orders set editing = false where id = p_id returning * into o;
  if o.id is null or not p_save then return jsonb_build_object('xero', q); end if;
  num := regexp_replace(coalesce(o.number, ''), '\D', '', 'g');
  insert into public.order_notes (order_id, text, by_email, by_name)
    values (p_id, 'Edited the order', who, coalesce((select name from public.staff where email = lower(who)), who));
  select count(*) into k from public.order_pos where order_id = p_id and number is not null;
  for p in select * from public.order_pos where order_id = p_id and number is null order by sort loop
    update public.order_pos set number = 'PO-' || num || case when k = 0 then '' else '-' || k end, status = case when p.send then 'sent' else 'to_send' end where id = p.id; k := k + 1;
  end loop;
  if o.kind <> 'order' or o.status <> 'placed' or not o.upload_xero then return jsonb_build_object('xero', q); end if;
  q := q || to_jsonb((public.upload_so(p_id) ->> 'id')::bigint);
  q := q || public.upload_pos(p_id);
  return jsonb_build_object('xero', q);
end $fn$;
select 'ok' as end_edit;
