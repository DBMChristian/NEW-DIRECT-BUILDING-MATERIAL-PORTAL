-- Build PO (13 Nov 2026): a PO carries all its lines, the items and the additional charges of its materials, each at
-- its cost (Xero's cost; the free scrap bags at 0), and that is what goes to Xero as the purchase order.
alter table public.order_po_items add column if not exists unit_cost numeric(14,4);
create or replace function public.place_order(p_id bigint) returns jsonb
language plpgsql security definer set search_path to '' as $fn$
declare o public.orders; n text; c public.customers; lines jsonb; contact jsonb; p record; pn text; pos jsonb := '[]'::jsonb;
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
  n := (case when o.kind = 'quote' then 'QUO-' else 'ORD-' end) || nextval('public.order_no_seq');
  update public.orders set number = n, status = case when o.kind = 'quote' then 'quote' else 'placed' end, placed_at = now(), updated_at = now() where id = p_id;
  if o.kind = 'order' then
    select * into c from public.customers where id = o.customer_id;
    contact := case when c.xero_contact_id is not null then jsonb_build_object('ContactID', c.xero_contact_id)
      else jsonb_strip_nulls(jsonb_build_object('Name', c.name, 'EmailAddress', nullif(c.email, ''))) end;
    select coalesce(jsonb_agg(jsonb_build_object('ItemCode', nullif(l.code, ''), 'Description', l.name, 'Quantity', l.qty, 'UnitAmount', l.price,
      'AccountCode', coalesce(pr.xero_sales_account, '200'), 'TaxType', coalesce(pr.xero_tax_type, 'OUTPUT')) order by l.sort), '[]'::jsonb)
      into lines from public.order_lines l left join public.products pr on pr.id = l.product_id where l.order_id = p_id and l.qty > 0;
    insert into public.xero_queue (kind, action, ref, party, amount, payload, created_by)
    values ('SO', 'create', n, o.customer_name, o.total,
      jsonb_build_object('Type', 'ACCREC', 'Status', 'DRAFT', 'Contact', contact, 'Reference', n || coalesce(nullif(' · ' || o.their_po, ' · '), ''),
        'Date', to_char(now() at time zone 'Australia/Sydney', 'YYYY-MM-DD'), 'LineAmountTypes', 'Exclusive', 'LineItems', lines),
      coalesce(auth.jwt() ->> 'email', ''));
    for p in select * from public.order_pos where order_id = p_id and send order by sort loop
      pn := 'PO-' || nextval('public.po_no_seq');
      update public.order_pos set number = pn, status = 'sent' where id = p.id;
      insert into public.xero_queue (kind, action, ref, party, amount, payload, created_by)
      select 'PO', 'create', pn, p.supplier_name, round(coalesce(sum(i.qty * coalesce(i.unit_cost, pr.xero_cost_price, 0)), 0), 2),
        jsonb_build_object('Contact', jsonb_build_object('Name', p.supplier_name), 'Reference', n, 'Date', to_char(now() at time zone 'Australia/Sydney', 'YYYY-MM-DD'), 'Status', 'DRAFT',
          'PurchaseOrderNumber', pn, 'LineAmountTypes', 'Exclusive',
          'LineItems', coalesce(jsonb_agg(jsonb_build_object('ItemCode', nullif(l.code, ''), 'Description', l.name, 'Quantity', i.qty, 'UnitAmount', coalesce(i.unit_cost, pr.xero_cost_price, 0)) order by l.is_charge, l.sort), '[]'::jsonb)),
        coalesce(auth.jwt() ->> 'email', '')
      from public.order_po_items i join public.order_lines l on l.id = i.line_id left join public.products pr on pr.id = l.product_id where i.po_id = p.id;
      pos := pos || jsonb_build_object('id', p.id, 'number', pn, 'sort', p.sort);
    end loop;
  end if;
  return jsonb_build_object('number', n, 'pos', pos);
end $fn$;
select 'ok' as place_order;
