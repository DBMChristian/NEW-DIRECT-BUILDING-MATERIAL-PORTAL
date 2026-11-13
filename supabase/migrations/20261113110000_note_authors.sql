-- Customer notes (13 Nov 2026): who added each note, by name (the staff list's name), and who last edited it.
alter table public.customer_notes add column if not exists by_name text not null default '';
alter table public.customer_notes add column if not exists edited_by_name text not null default '';
update public.customer_notes n set by_name = s.name from public.staff s where n.by_name = '' and lower(n.by_email) = s.email and s.name <> '';
update public.customer_notes set by_name = 'Previous portal' where by_name = '' and by_email = 'previous portal';
update public.customer_notes set by_name = 'Teresa D' where by_name = '' and by_email = 'teresa';
select by_name, count(*) from public.customer_notes group by by_name order by 2 desc;
