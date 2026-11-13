-- Customers (13 Nov 2026): a full history of every change on Admin > Customers: who (name and email, or the Xero sync),
-- when, which customer, which field, from what to what; and every note added, edited or deleted. Written only by the
-- database itself (triggers), so nothing can be left out or changed afterwards.
create table if not exists public.customer_history (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  customer_id bigint,
  customer_name text not null default '',
  by_email text not null default '',
  by_name text not null default '',
  action text not null,
  field text not null default '',
  old_value text,
  new_value text
);
create index if not exists customer_history_customer_idx on public.customer_history (customer_id, at desc);
create index if not exists customer_history_at_idx on public.customer_history (at desc);
alter table public.customer_history enable row level security;
drop policy if exists "staff read customer history" on public.customer_history;
create policy "staff read customer history" on public.customer_history for select to authenticated using (public.my_role() <> '');
revoke insert, update, delete on public.customer_history from anon, authenticated;

create or replace function public.history_actor(out email text, out name text)
language plpgsql stable security definer set search_path to '' as $fn$
begin
  email := lower(coalesce(auth.jwt() ->> 'email', ''));
  if email = '' then email := 'xero-sync'; name := 'Xero sync'; return; end if;
  select coalesce(nullif(s.name, ''), split_part(email, '@', 1)) into name from public.staff s where s.email = history_actor.email;
  name := coalesce(name, split_part(email, '@', 1));
end $fn$;

create or replace function public.customers_history() returns trigger
language plpgsql security definer set search_path to '' as $fn$
declare a record; f text; o text; n text;
begin
  select * into a from public.history_actor();
  if tg_op = 'INSERT' then
    insert into public.customer_history (customer_id, customer_name, by_email, by_name, action) values (new.id, new.name, a.email, a.name, 'Added from Xero');
    return new;
  end if;
  foreach f in array array['name', 'email', 'phone', 'mobile', 'street', 'suburb', 'state', 'postcode', 'abn', 'account_number', 'is_customer', 'is_supplier',
    'xero_status', 'in_xero', 'xero_terms_day', 'xero_terms_type', 'terms', 'price_list', 'credit_limit', 'on_hold'] loop
    o := to_jsonb(old) ->> f; n := to_jsonb(new) ->> f;
    if o is distinct from n then
      insert into public.customer_history (customer_id, customer_name, by_email, by_name, action, field, old_value, new_value)
      values (new.id, new.name, a.email, a.name, 'Changed', f, o, n);
    end if;
  end loop;
  return new;
end $fn$;
drop trigger if exists customers_history on public.customers;
create trigger customers_history after insert or update on public.customers for each row execute function public.customers_history();

create or replace function public.customer_notes_history() returns trigger
language plpgsql security definer set search_path to '' as $fn$
declare a record; cid bigint; cname text;
begin
  select * into a from public.history_actor();
  cid := coalesce(new.customer_id, old.customer_id);
  select c.name into cname from public.customers c where c.id = cid;
  if tg_op = 'INSERT' then
    insert into public.customer_history (customer_id, customer_name, by_email, by_name, action, field, new_value) values (cid, coalesce(cname, ''), a.email, a.name, 'Note added', 'note', new.text);
  elsif tg_op = 'UPDATE' and old.text is distinct from new.text then
    insert into public.customer_history (customer_id, customer_name, by_email, by_name, action, field, old_value, new_value) values (cid, coalesce(cname, ''), a.email, a.name, 'Note edited', 'note', old.text, new.text);
  elsif tg_op = 'DELETE' then
    insert into public.customer_history (customer_id, customer_name, by_email, by_name, action, field, old_value) values (cid, coalesce(cname, ''), a.email, a.name, 'Note deleted', 'note', old.text);
  end if;
  return coalesce(new, old);
end $fn$;
drop trigger if exists customer_notes_history on public.customer_notes;
create trigger customer_notes_history after insert or update or delete on public.customer_notes for each row execute function public.customer_notes_history();

select (select count(*) from pg_trigger where tgname in ('customers_history', 'customer_notes_history')) as triggers;
