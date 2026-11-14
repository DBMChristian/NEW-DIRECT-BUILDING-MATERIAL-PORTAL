-- The sales order's own Upload to Xero (13 Nov 2026): makes INV-n in Xero (or updates it when it is there), for an
-- order placed without uploading too; the history says who did it (the person who pressed, not "Portal").
create or replace function public.upload_so(p_id bigint) returns jsonb
language plpgsql security definer set search_path to '' as $fn$
declare o public.orders; c public.customers; num text; lines jsonb; contact jsonb; x record; qid bigint; who text := coalesce(auth.jwt() ->> 'email', '');
begin
  if public.my_role() not in ('admin', 'office') then raise exception 'Only the office uploads to Xero.'; end if;
  select * into o from public.orders where id = p_id;
  if o.id is null or o.status <> 'placed' or o.kind <> 'order' then raise exception 'Only a placed order goes to Xero.'; end if;
  num := regexp_replace(o.number, '\D', '', 'g');
  select * into c from public.customers where id = o.customer_id;
  contact := case when c.xero_contact_id is not null then jsonb_build_object('ContactID', c.xero_contact_id) else jsonb_strip_nulls(jsonb_build_object('Name', c.name, 'EmailAddress', nullif(c.email, ''))) end;
  select coalesce(jsonb_agg(jsonb_build_object('ItemCode', nullif(g.code, ''), 'Description', g.name, 'Quantity', g.qty, 'UnitAmount', g.price, 'AccountCode', g.acct, 'TaxType', g.tax) order by g.s), '[]'::jsonb)
    into lines from (select l.code, l.name, l.price, sum(l.qty) as qty, min(l.sort + case when l.is_charge then 1000 else 0 end) as s, coalesce(max(pr.xero_sales_account), '200') as acct, coalesce(max(pr.xero_tax_type), 'OUTPUT') as tax
      from public.order_lines l left join public.products pr on pr.id = l.product_id where l.order_id = p_id and l.qty > 0 group by l.code, l.name, l.price) g;
  select * into x from public.xero_queue where ref = 'INV-' || num and kind = 'SO' and action = 'create' order by id desc limit 1;
  if x.id is not null and x.status = 'done' and x.xero_id is not null then
    insert into public.xero_queue (kind, action, ref, party, amount, payload, xero_id, created_by)
    values ('SO', 'update', 'INV-' || num, o.customer_name, o.total, jsonb_build_object('LineAmountTypes', 'Exclusive', 'LineItems', lines, 'Reference', o.number || coalesce(nullif(' · ' || o.their_po, ' · '), '')), x.xero_id, who) returning id into qid;
  elsif x.id is not null and x.status in ('waiting', 'failed') then
    update public.xero_queue set payload = payload || jsonb_build_object('LineItems', lines, 'Contact', contact) where id = x.id; qid := x.id;
  else
    insert into public.xero_queue (kind, action, ref, party, amount, payload, created_by)
    values ('SO', 'create', 'INV-' || num, o.customer_name, o.total,
      jsonb_build_object('Type', 'ACCREC', 'Status', 'DRAFT', 'InvoiceNumber', 'INV-' || num, 'Contact', contact, 'Reference', o.number || coalesce(nullif(' · ' || o.their_po, ' · '), ''),
        'Date', to_char(now() at time zone 'Australia/Sydney', 'YYYY-MM-DD'), 'LineAmountTypes', 'Exclusive', 'LineItems', lines), who) returning id into qid;
  end if;
  update public.orders set upload_xero = true where id = p_id;
  return jsonb_build_object('id', qid);
end $fn$;
revoke all on function public.upload_so(bigint) from public, anon;
grant execute on function public.upload_so(bigint) to authenticated;

/* Xero in the history: made, updated, deleted or voided, or refused, and who did it (who pressed Sync now / Upload) */
create or replace function public.ev_xero() returns trigger language plpgsql security definer set search_path to '' as $fn$
declare oid bigint; part text; who text := lower(coalesce(nullif(new.sent_by, ''), nullif(new.created_by, ''), ''));
begin
  if new.status not in ('done', 'failed') or old.status = new.status or coalesce(new.last_error, '') like 'Order cancelled%' or coalesce(new.last_error, '') = 'Replaced by an edit' then return new; end if;
  if new.kind = 'SO' then select id into oid from public.orders where number in ('ORD-' || regexp_replace(new.ref, '\D', '', 'g')) limit 1; part := 'so';
  else select order_id into oid from public.order_pos where number = new.ref limit 1; part := 'po'; end if;
  if oid is null then return new; end if;
  insert into public.order_events (order_id, part, ref, text, by_email, by_name)
  values (oid, part, new.ref, case when new.status = 'done'
      then new.ref || ' ' || case new.action when 'create' then 'created' when 'update' then 'updated' else 'deleted or voided' end || ' in Xero'
      else 'Xero refused ' || new.ref || ' (' || case new.action when 'create' then 'create' when 'update' then 'update' else 'delete' end || '): ' || coalesce(new.last_error, '') end,
    who, case when who = '' or who = 'xero-sync' then 'Xero sync (automatic)' else coalesce((select nullif(name, '') from public.staff where email = who), split_part(who, '@', 1)) end);
  return new;
end $fn$;
select 'ok' as upload_so;
