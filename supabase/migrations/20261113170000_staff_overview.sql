-- Admin > Users (13 Nov 2026), laid out as OrderConcrete's: everyone on the staff list with whether they have a login yet
-- and when they last signed in, plus anyone who has a login but no role yet. Admins only.
create or replace function public.staff_overview()
returns table (email text, name text, role text, active boolean, added_at timestamptz, has_login boolean, last_sign_in timestamptz, on_list boolean)
language plpgsql stable security definer set search_path to '' as $fn$
begin
  if public.my_role() <> 'admin' then raise exception 'Only an admin can see the users.'; end if;
  return query
    select s.email, s.name, s.role, s.active, s.created_at, (u.id is not null), u.last_sign_in_at, true
      from public.staff s left join auth.users u on lower(u.email) = s.email
    union all
    select lower(u.email), coalesce(u.raw_user_meta_data ->> 'name', ''), ''::text, false, u.created_at, true, u.last_sign_in_at, false
      from auth.users u where u.email is not null and not exists (select 1 from public.staff s where s.email = lower(u.email));
end $fn$;
revoke all on function public.staff_overview() from public, anon;
grant execute on function public.staff_overview() to authenticated;
select 'ok' as staff_overview;
