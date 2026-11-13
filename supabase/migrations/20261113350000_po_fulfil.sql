-- Build PO (13 Nov 2026): each PO has its own Delivery or pick-up (what the supplier is told), apart from the loads.
alter table public.order_pos add column if not exists fulfil text not null default 'delivery' check (fulfil in ('delivery', 'pickup'));
-- the portals are told the PO's own choice
create or replace function public.ordersteel_po_source(p_order_id bigint) returns jsonb
language plpgsql stable security definer set search_path to '' as $fn$
declare po public.order_pos; o public.orders; ld public.order_loads; a jsonb;
begin
  select * into po from public.order_pos where id = p_order_id; if po.id is null then return null; end if;
  select * into o from public.orders where id = po.order_id;
  select l.* into ld from public.order_loads l where l.order_id = o.id and exists (select 1 from public.order_load_items li join public.order_po_items pi on pi.line_id = li.line_id where li.load_id = l.id and pi.po_id = po.id) order by l.sort limit 1;
  a := coalesce(ld.answers, '{}'::jsonb);
  return jsonb_build_object('order_id', po.id, 'kind', 'dropship', 'po_no', coalesce(po.number, ''), 'quote_no', coalesce(o.number, ''), 'customer', o.customer_name,
    'contact', o.contact_phone, 'contact_name', o.contact_name, 'ds_route', case when po.deliver_to = 'penrith' then 'penrith' else 'direct' end, 'fulfil', coalesce(po.fulfil, 'delivery'),
    'site', nullif(coalesce(ld.site_address, ''), ''), 'site_contact', btrim(o.contact_name || ' ' || o.contact_phone), 'site_notes', nullif(btrim(concat_ws(' · ', nullif(o.instructions, ''), nullif(po.notes, ''))), ''),
    'want_date', ld.want_date, 'slot', coalesce(ld.want_time, 'Any time'), 'col', case when po.status = 'cancelled' then 'Cancelled' when coalesce(po.supplier_ref, '') <> '' then 'Ordered' else 'To order' end,
    'stream', 'dropship', 'supplier_ref', po.supplier_ref,
    'job', jsonb_build_object('concrete_pour', a ->> 'pour', 'concrete_truck', a ->> 'truck', 'concrete_spacing', a ->> 'spacing', 'concrete_message', a ->> 'message',
      'concrete_tester', initcap(coalesce(a ->> 'tester', '')), 'concrete_coloured', initcap(coalesce(a ->> 'coloured', '')), 'concrete_colour', a ->> 'colour',
      'location', a ->> 'location', 'distance_hrs', a ->> 'hours', 'scrap_pickup', initcap(coalesce(a ->> 'scrap', '')), 'gate_code', a ->> 'gate', 'trailer_access', initcap(coalesce(a ->> 'trailer', '')),
      'site_contact', btrim(o.contact_name || ' ' || o.contact_phone)),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('item_id', l.id, 'name', l.name, 'qty', i.qty, 'unit', l.unit, 'code', l.code,
        'category', case p.category when 'Wafflepods' then 'Waffle Pods' when 'Bluedeck' then 'BlueDeck' else coalesce(p.category, '') end) order by l.sort)
      from public.order_po_items i join public.order_lines l on l.id = i.line_id left join public.products p on p.id = l.product_id where i.po_id = po.id and not l.is_charge), '[]'::jsonb));
end $fn$;
notify pgrst, 'reload schema';
select count(*) as fulfil_column from information_schema.columns where table_name = 'order_pos' and column_name = 'fulfil';
