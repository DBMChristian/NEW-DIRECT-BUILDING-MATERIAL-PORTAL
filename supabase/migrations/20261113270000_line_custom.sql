-- New Order (13 Nov 2026): a custom line's measurements (EPS size and grade, panels or sheets and length, a typed
-- description), kept with the line so a draft reopens with them.
alter table public.order_lines add column if not exists custom jsonb not null default '{}'::jsonb;
select count(*) as has_custom from information_schema.columns where table_name = 'order_lines' and column_name = 'custom';
