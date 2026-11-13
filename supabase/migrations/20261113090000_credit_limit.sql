-- Customers (13 Nov 2026): a credit limit per customer (Xero has none), typed on Admin > Customers; the five from the
-- previous portal filled in.
alter table public.customers add column if not exists credit_limit numeric(14,2) check (credit_limit is null or credit_limit >= 0);
update public.customers c set credit_limit = v.lim, updated_at = now()
from (values ('15 BARKER PTY LTD', 7000), ('A GRADE CONCRETE PTY', 36000), ('DBM', 4000), ('Northpoint Residential Projects Pty Ltd', 28000), ('TG POJECTS', 80000)) as v(name, lim)
where lower(btrim(c.name)) = lower(btrim(v.name)) and c.credit_limit is null;
select name, terms, credit_limit from public.customers where credit_limit is not null order by name;
