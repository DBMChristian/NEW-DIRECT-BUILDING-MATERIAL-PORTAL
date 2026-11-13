-- Placing checks the required fields itself too (13 Nov 2026).
create or replace function public.place_order(p_id bigint) returns jsonb
language plpgsql security definer set search_path to '' as $fn$
declare o public.orders; n text; num bigint; k int := 0; c public.customers; lines jsonb; contact jsonb; p record; pn text; pos jsonb := '[]'::jsonb; q jsonb := '[]'::jsonb; qid bigint;
begin
  if public.my_role() not in ('admin', 'office') then raise exception 'Only the office places orders.'; end if;
  select * into o from public.orders where id = p_id for update;
  if o.id is null then raise exception 'No such order.'; end if;
  if o.status <> 'draft' then return jsonb_build_object('number', o.number, 'already', true); end if;
  if o.customer_id is null then raise exception 'Choose the company.'; end if;
  if not exists (select 1 from public.order_lines where order_id = p_id and not is_charge) then raise exception 'Add at least one product.'; end if;
  if exists (select 1 from public.order_lines l where l.order_id = p_id and l.list_price is not null and abs(l.price - l.list_price) >= 0.005 and length(btrim(l.price_reason)) < 3) then
    raise exception 'Give the reason for every changed price.'; end if;
  if o.kind = 'order' and exists (select 1 from public.order_pos where order_id = p_id and send is null) then raise exception 'Build PO: choose Send Yes or No on every PO.'; end if;
  /* the required fields, checked here too: an order is never placed with one missing (13 Nov 2026) */
  if btrim(o.contact_name) = '' then raise exception 'Enter their name.'; end if;
  if length(regexp_replace(o.contact_phone, '\D', '', 'g')) < 8 then raise exception 'Enter their phone.'; end if;
  if btrim(o.site_street) = '' or btrim(o.site_suburb) = '' then raise exception 'Enter the site address.'; end if;
  if btrim(o.price_list) = '' then raise exception 'Choose the price list.'; end if;
  if o.kind = 'order' and (o.delivery_date is null or btrim(o.booking_time) = '') then raise exception 'Choose the delivery date and booking time.'; end if;
  if o.kind = 'order' and o.sms_confirm is null then raise exception 'SMS booking confirmation: Yes or No.'; end if;
  if o.kind = 'order' and exists (select 1 from public.order_loads where order_id = p_id and want_date is null) then raise exception 'Build Load: every load needs its day.'; end if;
  if exists (select 1 from public.order_loads where order_id = p_id and fulfil = 'delivery' and btrim(site_address) = '') then raise exception 'Build Load: every delivery load needs its site address.'; end if;
  num := nextval('public.order_no_seq');
  n := (case when o.kind = 'quote' then 'QUO-' else 'ORD-' end) || num;   /* ORD-2005: its invoice INV-2005, its POs PO-2005, PO-2005-1, PO-2005-2 … */
  update public.orders set number = n, status = case when o.kind = 'quote' then 'quote' else 'placed' end, placed_at = now(), updated_at = now() where id = p_id;
  if o.kind = 'order' then
    if o.upload_xero then
      select * into c from public.customers where id = o.customer_id;
      contact := case when c.xero_contact_id is not null then jsonb_build_object('ContactID', c.xero_contact_id)
        else jsonb_strip_nulls(jsonb_build_object('Name', c.name, 'EmailAddress', nullif(c.email, ''))) end;
      /* the same line over several loads (e.g. two Rediwall deliveries) is one line with its quantity added up */
      select coalesce(jsonb_agg(jsonb_build_object('ItemCode', nullif(g.code, ''), 'Description', g.name, 'Quantity', g.qty, 'UnitAmount', g.price,
        'AccountCode', g.acct, 'TaxType', g.tax) order by g.s), '[]'::jsonb)
        into lines from (select l.code, l.name, l.price, sum(l.qty) as qty, min(l.sort + case when l.is_charge then 1000 else 0 end) as s,
          coalesce(max(pr.xero_sales_account), '200') as acct, coalesce(max(pr.xero_tax_type), 'OUTPUT') as tax
          from public.order_lines l left join public.products pr on pr.id = l.product_id where l.order_id = p_id and l.qty > 0 group by l.code, l.name, l.price) g;
      insert into public.xero_queue (kind, action, ref, party, amount, payload, created_by)
      values ('SO', 'create', 'INV-' || num, o.customer_name, o.total,
        jsonb_build_object('Type', 'ACCREC', 'Status', 'DRAFT', 'InvoiceNumber', 'INV-' || num, 'Contact', contact, 'Reference', n || coalesce(nullif(' · ' || o.their_po, ' · '), ''),
          'Date', to_char(now() at time zone 'Australia/Sydney', 'YYYY-MM-DD'), 'LineAmountTypes', 'Exclusive', 'LineItems', lines),
        coalesce(auth.jwt() ->> 'email', '')) returning id into qid;
      q := q || to_jsonb(qid);
    end if;
    /* every PO gets its number; sent to the supplier when Send order is Yes; to Xero when Upload to Xero is Yes */
    for p in select * from public.order_pos where order_id = p_id order by sort loop
      pn := 'PO-' || num || case when k = 0 then '' else '-' || k end; k := k + 1;
      update public.order_pos set number = pn, status = case when p.send then 'sent' else 'to_send' end where id = p.id;
      if o.upload_xero then
        insert into public.xero_queue (kind, action, ref, party, amount, payload, created_by)
        select 'PO', 'create', pn, p.supplier_name, round(coalesce(sum(g.qty * g.uc), 0), 2),
          jsonb_build_object('Contact', jsonb_build_object('Name', p.supplier_name), 'Reference', n, 'Date', to_char(now() at time zone 'Australia/Sydney', 'YYYY-MM-DD'), 'Status', 'DRAFT',
            'PurchaseOrderNumber', pn, 'LineAmountTypes', 'Exclusive',
            'LineItems', coalesce(jsonb_agg(jsonb_build_object('ItemCode', nullif(g.code, ''), 'Description', g.name, 'Quantity', g.qty, 'UnitAmount', g.uc) order by g.s), '[]'::jsonb)),
          coalesce(auth.jwt() ->> 'email', '')
        from (select l.code, l.name, coalesce(i.unit_cost, pr.xero_cost_price, 0) as uc, sum(i.qty) as qty, min(l.sort + case when l.is_charge then 1000 else 0 end) as s
          from public.order_po_items i join public.order_lines l on l.id = i.line_id left join public.products pr on pr.id = l.product_id where i.po_id = p.id
          group by l.code, l.name, coalesce(i.unit_cost, pr.xero_cost_price, 0)) g
        returning id into qid;
        q := q || to_jsonb(qid);
      end if;
      pos := pos || jsonb_build_object('id', p.id, 'number', pn, 'sort', p.sort, 'send', coalesce(p.send, false));
    end loop;
  end if;
  return jsonb_build_object('number', n, 'pos', pos, 'xero', q);
end $fn$;
select 'ok' as place_order;
