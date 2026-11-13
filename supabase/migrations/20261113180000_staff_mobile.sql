-- Admin > Users (13 Nov 2026): a person's mobile, as OrderConcrete's "Add a person" keeps it.
alter table public.staff add column if not exists mobile text not null default '';
select count(*) as staff from public.staff;
