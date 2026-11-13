-- POs into DBM's portals (13 Nov 2026), as the previous portal: a PO set to Send order: Yes goes, on placing, into its
-- supplier's portal (OrderConcrete for concrete, OrderPods for waffle pods, OrderSteel for Rediwall, Hebel, BlueDeck and
-- reinforcement) by the portal-po function (the previous portal's sender, brought across). Only Direct's items go: each
-- portal adds the charges it needs by its own rules. Here: what the sender reads and writes on Direct's side.
alter table public.order_pos add column if not exists supplier_ref text;      -- the order's number in DBM's portal
alter table public.order_pos add column if not exists portal_error text;
alter table public.order_pos add column if not exists portal_sent_at timestamptz;

create table if not exists public.settings (key text primary key, value text not null default '');
alter table public.settings enable row level security;
drop policy if exists "staff read settings" on public.settings;
create policy "staff read settings" on public.settings for select to authenticated using (public.my_role() <> '');
drop policy if exists "admin writes settings" on public.settings;
create policy "admin writes settings" on public.settings for all to authenticated using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
-- the switch: off (nothing goes), test (admins preview only), on (POs go into the portals)
insert into public.settings (key, value) values ('ordersteel_send', 'off'), ('warehouse_contact_name', ''), ('warehouse_contact_phone', '') on conflict (key) do nothing;

create table if not exists public.audit_log (id bigint generated always as identity primary key, at timestamptz not null default now(), who text not null default '', action text not null default '', detail text not null default '');
alter table public.audit_log enable row level security;
drop policy if exists "admin reads audit" on public.audit_log;
create policy "admin reads audit" on public.audit_log for select to authenticated using (public.my_role() = 'admin');

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path to '' as $fn$ select public.my_role() = 'admin' $fn$;
grant execute on function public.is_admin() to authenticated;

/* the PO as the sender reads it: Direct's items only (no charges), where and when, the questions */
create or replace function public.ordersteel_po_source(p_order_id bigint) returns jsonb
language plpgsql stable security definer set search_path to '' as $fn$
declare po public.order_pos; o public.orders; ld public.order_loads; a jsonb;
begin
  select * into po from public.order_pos where id = p_order_id; if po.id is null then return null; end if;
  select * into o from public.orders where id = po.order_id;
  select l.* into ld from public.order_loads l where l.order_id = o.id and exists (select 1 from public.order_load_items li join public.order_po_items pi on pi.line_id = li.line_id where li.load_id = l.id and pi.po_id = po.id) order by l.sort limit 1;
  a := coalesce(ld.answers, '{}'::jsonb);
  return jsonb_build_object('order_id', po.id, 'kind', 'dropship', 'po_no', coalesce(po.number, ''), 'quote_no', coalesce(o.number, ''), 'customer', o.customer_name,
    'contact', o.contact_phone, 'contact_name', o.contact_name, 'ds_route', case when po.deliver_to = 'penrith' then 'penrith' else 'direct' end, 'fulfil', coalesce(ld.fulfil, 'delivery'),
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

/* claim a PO once, then record how it went */
create or replace function public.ordersteel_send_claim(p_order_id bigint, p_by text, p_request jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $fn$
declare po public.order_pos;
begin
  select * into po from public.order_pos where id = p_order_id for update;
  if po.id is null then return jsonb_build_object('error', 'No such purchase order.'); end if;
  if coalesce(po.supplier_ref, '') <> '' then return jsonb_build_object('error', 'Already sent as ' || po.supplier_ref || '.'); end if;
  if po.portal_error = 'sending' then return jsonb_build_object('error', 'It is being sent now.'); end if;
  update public.order_pos set portal_error = 'sending' where id = po.id;
  insert into public.audit_log (who, action, detail) values (coalesce(p_by, ''), 'portal_send_claim', coalesce(po.number, '') || ' ' || coalesce(p_request::text, ''));
  return jsonb_build_object('claim_id', po.id);
end $fn$;
create or replace function public.ordersteel_send_finish(p_claim_id bigint, p_ok boolean, p_ordersteel_id text, p_error text, p_result jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $fn$
begin
  if p_ok then update public.order_pos set supplier_ref = p_ordersteel_id, portal_error = null, portal_sent_at = now() where id = p_claim_id;
  else update public.order_pos set portal_error = left(coalesce(p_error, 'not sent'), 1000) where id = p_claim_id; end if;
  insert into public.audit_log (who, action, detail) values ('portal-po', case when p_ok then 'portal_sent' else 'portal_failed' end, coalesce(p_ordersteel_id, '') || ' ' || coalesce(p_error, ''));
  return jsonb_build_object('supplier_ref_set', p_ok);
end $fn$;
revoke all on function public.ordersteel_po_source(bigint) from public, anon, authenticated;
revoke all on function public.ordersteel_send_claim(bigint, text, jsonb) from public, anon, authenticated;
revoke all on function public.ordersteel_send_finish(bigint, boolean, text, text, jsonb) from public, anon, authenticated;
select (select value from public.settings where key = 'ordersteel_send') as switch;
