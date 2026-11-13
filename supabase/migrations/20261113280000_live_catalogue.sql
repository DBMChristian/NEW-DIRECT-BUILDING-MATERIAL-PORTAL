-- New Order follows Admin › Products live (13 Nov 2026): the database sends a change to these tables to the open forms.
do $do$ declare t text; begin
  foreach t in array array['products', 'product_prices', 'price_lists', 'suppliers', 'supplier_routes'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $do$;
select string_agg(tablename, ', ' order by tablename) as live_tables from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public';
