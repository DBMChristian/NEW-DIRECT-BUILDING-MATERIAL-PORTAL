-- The order's history (13 Nov 2026), kept by itself for each part: the sales order (placed, edited, cancelled, Xero,
-- the customer's email), the purchase orders (made, emailed, into DBM's portals, Xero) and the loads (booked, unbooked,
-- delivered). No typed notes: everything that happens to the order is recorded where it happens.
create table if not exists public.order_events (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  part text not null check (part in ('so', 'po', 'load')),
  ref text not null default '',
  text text not null,
  by_email text not null default '',
  by_name text not null default '',
  at timestamptz not null default now()
);
create index if not exists order_events_order_idx on public.order_events (order_id, part, at desc);
alter table public.order_events enable row level security;
drop policy if exists "staff read order events" on public.order_events;
create policy "staff read order events" on public.order_events for select to authenticated using (public.my_role() <> '');
drop policy if exists "office adds order events" on public.order_events;
create policy "office adds order events" on public.order_events for insert to authenticated with check (public.my_role() in ('admin', 'office'));

create or replace function public.log_order_event(p_order bigint, p_part text, p_ref text, p_text text) returns void
language plpgsql security definer set search_path to '' as $fn$
declare who text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if p_order is null then return; end if;
  insert into public.order_events (order_id, part, ref, text, by_email, by_name)
  values (p_order, p_part, coalesce(p_ref, ''), p_text, who, case when who = '' then 'Portal' else coalesce((select nullif(name, '') from public.staff where email = who), split_part(who, '@', 1)) end);
end $fn$;

/* placed (or saved as a quote), and cancelled */
create or replace function public.ev_orders() returns trigger language plpgsql security definer set search_path to '' as $fn$
begin
  if old.status = 'draft' and new.status in ('placed', 'quote') then perform public.log_order_event(new.id, 'so', new.number, case when new.status = 'quote' then 'Quote saved as ' else 'Order placed as ' end || new.number || case when new.upload_xero then '' else ' (not uploaded to Xero)' end); end if;
  return new;
end $fn$;
drop trigger if exists ev_orders on public.orders;
create trigger ev_orders after update of status on public.orders for each row execute function public.ev_orders();

/* the notes the order already writes (edited, cancelled) go in the sales order's history */
create or replace function public.ev_notes() returns trigger language plpgsql security definer set search_path to '' as $fn$
begin
  insert into public.order_events (order_id, part, text, by_email, by_name, at) values (new.order_id, 'so', new.text, new.by_email, new.by_name, new.created_at);
  return new;
end $fn$;
drop trigger if exists ev_notes on public.order_notes;
create trigger ev_notes after insert on public.order_notes for each row execute function public.ev_notes();
insert into public.order_events (order_id, part, text, by_email, by_name, at)
select n.order_id, 'so', n.text, n.by_email, n.by_name, n.created_at from public.order_notes n
where not exists (select 1 from public.order_events e where e.order_id = n.order_id and e.text = n.text and e.at = n.created_at);
insert into public.order_events (order_id, part, ref, text, by_name, at)
select o.id, 'so', o.number, 'Order placed as ' || o.number || case when o.upload_xero then '' else ' (not uploaded to Xero)' end, o.created_by_name, o.placed_at from public.orders o
where o.placed_at is not null and o.status in ('placed', 'cancelled') and not exists (select 1 from public.order_events e where e.order_id = o.id and e.text like 'Order placed as %');

/* a PO gets its number; a PO goes into DBM's portal (or not) */
create or replace function public.ev_pos() returns trigger language plpgsql security definer set search_path to '' as $fn$
begin
  if old.number is null and new.number is not null then
    perform public.log_order_event(new.order_id, 'po', new.number, new.number || ' made for ' || new.supplier_name || case when new.portal <> '' then ' · ' || new.portal else '' end || case when new.send then ' (to be sent to the supplier)' else ' (not sent to the supplier)' end); end if;
  if coalesce(old.supplier_ref, '') = '' and coalesce(new.supplier_ref, '') <> '' then
    perform public.log_order_event(new.order_id, 'po', new.number, new.number || ' is in ' || new.portal || ' as ' || new.supplier_ref); end if;
  if coalesce(new.portal_error, '') not in ('', 'sending') and coalesce(old.portal_error, '') is distinct from new.portal_error then
    perform public.log_order_event(new.order_id, 'po', new.number, new.number || ' not in ' || new.portal || ': ' || new.portal_error); end if;
  if old.status <> 'cancelled' and new.status = 'cancelled' then perform public.log_order_event(new.order_id, 'po', new.number, coalesce(new.number, 'PO') || ' cancelled'); end if;
  return new;
end $fn$;
drop trigger if exists ev_pos on public.order_pos;
create trigger ev_pos after update on public.order_pos for each row execute function public.ev_pos();

/* a load is booked, unbooked, delivered or picked up, cancelled */
create or replace function public.ev_loads() returns trigger language plpgsql security definer set search_path to '' as $fn$
declare n text := 'Load ' || (new.sort + 1) || ' (' || coalesce(nullif(new.category, ''), 'load') || ')';
begin
  if old.status is distinct from new.status then
    perform public.log_order_event(new.order_id, 'load', n, n || ' ' || case new.status
      when 'booked' then 'booked for ' || to_char(new.booked_date, 'Dy DD Mon YYYY') || coalesce(' · ' || new.booked_time, '')
      when 'delivered' then case when new.fulfil = 'pickup' then 'picked up' else 'delivered' end
      when 'cancelled' then 'cancelled'
      when 'pending' then case when old.status = 'booked' then 'unbooked' else 'pending' end
      when 'on_hold' then 'on hold' else new.status end);
  end if;
  return new;
end $fn$;
drop trigger if exists ev_loads on public.order_loads;
create trigger ev_loads after update of status on public.order_loads for each row execute function public.ev_loads();

/* Xero: each invoice and PO that goes, is updated or deleted there, or is refused */
create or replace function public.ev_xero() returns trigger language plpgsql security definer set search_path to '' as $fn$
declare oid bigint; part text;
begin
  if new.status not in ('done', 'failed') or old.status = new.status or coalesce(new.last_error, '') like 'Order cancelled%' or coalesce(new.last_error, '') = 'Replaced by an edit' then return new; end if;
  if new.kind = 'SO' then select id into oid from public.orders where number in ('ORD-' || regexp_replace(new.ref, '\D', '', 'g')) limit 1; part := 'so';
  else select order_id into oid from public.order_pos where number = new.ref limit 1; part := 'po'; end if;
  if oid is null then return new; end if;
  perform public.log_order_event(oid, part, new.ref, case when new.status = 'done'
    then new.ref || ' ' || case new.action when 'create' then 'made' when 'update' then 'updated' else 'deleted or voided' end || ' in Xero'
    else 'Xero refused ' || new.ref || ': ' || coalesce(new.last_error, '') end);
  return new;
end $fn$;
drop trigger if exists ev_xero on public.xero_queue;
create trigger ev_xero after update of status on public.xero_queue for each row execute function public.ev_xero();
select count(*) as events from public.order_events;
