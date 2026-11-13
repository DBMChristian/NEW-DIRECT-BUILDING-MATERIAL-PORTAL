-- Customers (13 Nov 2026): a change to COD or account, On hold, Credit limit or Price list needs a reason. The page asks
-- for it; the database refuses the change without one, and the reason is kept with the change in the history.
alter table public.customers add column if not exists change_reason text;
alter table public.customer_history add column if not exists reason text;

create or replace function public.customers_require_reason() returns trigger
language plpgsql security definer set search_path to '' as $fn$
begin
  if (old.terms, old.on_hold, old.credit_limit, old.price_list) is distinct from (new.terms, new.on_hold, new.credit_limit, new.price_list) then
    if length(btrim(coalesce(new.change_reason, ''))) < 3 then
      raise exception 'Give a reason for changing COD or account, On hold, Credit limit or Price list.';
    end if;
    perform set_config('direct.change_reason', btrim(new.change_reason), true);
  else
    perform set_config('direct.change_reason', '', true);
  end if;
  new.change_reason := null;   /* used once: the next change needs its own */
  return new;
end $fn$;
drop trigger if exists customers_require_reason on public.customers;
create trigger customers_require_reason before update on public.customers for each row execute function public.customers_require_reason();

create or replace function public.customers_history() returns trigger
language plpgsql security definer set search_path to '' as $fn$
declare a record; f text; o text; n text; r text;
begin
  select * into a from public.history_actor();
  if tg_op = 'INSERT' then
    insert into public.customer_history (customer_id, customer_name, by_email, by_name, action) values (new.id, new.name, a.email, a.name, 'Added from Xero');
    return new;
  end if;
  r := nullif(current_setting('direct.change_reason', true), '');
  foreach f in array array['name', 'email', 'phone', 'mobile', 'street', 'suburb', 'state', 'postcode', 'abn', 'account_number', 'is_customer', 'is_supplier',
    'xero_status', 'in_xero', 'xero_terms_day', 'xero_terms_type', 'terms', 'price_list', 'credit_limit', 'on_hold'] loop
    o := to_jsonb(old) ->> f; n := to_jsonb(new) ->> f;
    if o is distinct from n then
      insert into public.customer_history (customer_id, customer_name, by_email, by_name, action, field, old_value, new_value, reason)
      values (new.id, new.name, a.email, a.name, 'Changed', f, o, n, case when f in ('terms', 'on_hold', 'credit_limit', 'price_list') then r end);
    end if;
  end loop;
  return new;
end $fn$;
select (select count(*) from pg_trigger where tgname in ('customers_require_reason', 'customers_history')) as triggers;
