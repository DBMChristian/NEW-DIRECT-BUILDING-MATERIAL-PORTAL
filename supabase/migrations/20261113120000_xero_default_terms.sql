-- Xero's organisation-wide sales terms (13 Nov 2026), read at each customer sync, so a contact without its own terms
-- shows the actual default instead of just "Xero's default".
alter table public.xero_link add column if not exists default_terms_day int;
alter table public.xero_link add column if not exists default_terms_type text not null default '';
select tenant_name, default_terms_day, default_terms_type from public.xero_link;
