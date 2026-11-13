-- New Order's header (13 Nov 2026), the same questions as the previous form: COD or ACC and the price list for this order
-- (from the customer, can be changed), the site address (street; suburb and postcode), the delivery date and booking time
-- the loads start from, SMS booking confirmation Yes/No, and their plans (files).
alter table public.orders add column if not exists site_street text not null default '';
alter table public.orders add column if not exists site_suburb text not null default '';
alter table public.orders add column if not exists delivery_date date;
alter table public.orders add column if not exists booking_time text not null default '';
alter table public.orders add column if not exists sms_confirm boolean;
alter table public.orders add column if not exists plans jsonb not null default '[]'::jsonb;
-- the plans are kept in a private storage folder; staff read, the office adds
insert into storage.buckets (id, name, public) values ('order-files', 'order-files', false) on conflict (id) do nothing;
drop policy if exists "staff read order files" on storage.objects;
create policy "staff read order files" on storage.objects for select to authenticated using (bucket_id = 'order-files' and public.my_role() <> '');
drop policy if exists "office adds order files" on storage.objects;
create policy "office adds order files" on storage.objects for insert to authenticated with check (bucket_id = 'order-files' and public.my_role() in ('admin', 'office'));
-- a customer typed in the form (not in Xero yet): the office may add one
drop policy if exists "office adds customers" on public.customers;
create policy "office adds customers" on public.customers for insert to authenticated with check (public.my_role() in ('admin', 'office'));
select count(*) as new_columns from information_schema.columns where table_name = 'orders' and column_name in ('site_street', 'site_suburb', 'delivery_date', 'booking_time', 'sms_confirm', 'plans');

-- placing: a customer not in Xero yet goes with its name and email, and Xero makes the contact with the invoice
create or replace function public.place_order(p_id bigint) returns jsonb
language plpgsql security definer set search_path to '' as $fn$
declare o public.orders; n text; c public.customers; lines jsonb; contact jsonb;
begin
  if public.my_role() not in ('admin', 'office') then raise exception 'Only the office places orders.'; end if;
  select * into o from public.orders where id = p_id for update;
  if o.id is null then raise exception 'No such order.'; end if;
  if o.status <> 'draft' then return jsonb_build_object('number', o.number, 'already', true); end if;
  if o.customer_id is null then raise exception 'Choose the company.'; end if;
  if not exists (select 1 from public.order_lines where order_id = p_id and not is_charge) then raise exception 'Add at least one product.'; end if;
  if exists (select 1 from public.order_lines l where l.order_id = p_id and l.list_price is not null and abs(l.price - l.list_price) >= 0.005 and length(btrim(l.price_reason)) < 3) then
    raise exception 'Give the reason for every changed price.'; end if;
  n := (case when o.kind = 'quote' then 'QUO-' else 'ORD-' end) || nextval('public.order_no_seq');
  update public.orders set number = n, status = case when o.kind = 'quote' then 'quote' else 'placed' end, placed_at = now(), updated_at = now() where id = p_id;
  if o.kind = 'order' then
    select * into c from public.customers where id = o.customer_id;
    contact := case when c.xero_contact_id is not null then jsonb_build_object('ContactID', c.xero_contact_id)
      else jsonb_strip_nulls(jsonb_build_object('Name', c.name, 'EmailAddress', nullif(c.email, ''))) end;
    select coalesce(jsonb_agg(jsonb_build_object('ItemCode', nullif(l.code, ''), 'Description', l.name, 'Quantity', l.qty, 'UnitAmount', l.price,
      'AccountCode', coalesce(p.xero_sales_account, '200'), 'TaxType', coalesce(p.xero_tax_type, 'OUTPUT')) order by l.sort), '[]'::jsonb)
      into lines from public.order_lines l left join public.products p on p.id = l.product_id where l.order_id = p_id and l.qty > 0;
    insert into public.xero_queue (kind, action, ref, party, amount, payload, created_by)
    values ('SO', 'create', n, o.customer_name, o.total,
      jsonb_build_object('Type', 'ACCREC', 'Status', 'DRAFT', 'Contact', contact, 'Reference', n || coalesce(nullif(' · ' || o.their_po, ' · '), ''),
        'Date', to_char(now() at time zone 'Australia/Sydney', 'YYYY-MM-DD'), 'LineAmountTypes', 'Exclusive', 'LineItems', lines),
      coalesce(auth.jwt() ->> 'email', ''));
  end if;
  return jsonb_build_object('number', n);
end $fn$;
select 'ok' as place_order;
