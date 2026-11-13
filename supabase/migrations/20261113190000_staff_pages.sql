-- Admin > Users (13 Nov 2026): which pages each person may open. Empty (null) = their role's pages: Admin every page,
-- Office every page but Admin, Warehouse only Warehouse, Driver none for now. Ticked pages on a person replace that.
alter table public.staff add column if not exists pages text[];
select email, role, pages from public.staff order by email;

-- Admin > Users reads each person's mobile and pages too (Edit fills them in)
drop function if exists public.staff_overview();
create or replace function public.staff_overview()
returns table (email text, name text, role text, active boolean, added_at timestamptz, has_login boolean, last_sign_in timestamptz, on_list boolean, mobile text, pages text[])
language plpgsql stable security definer set search_path to '' as $fn$
begin
  if public.my_role() <> 'admin' then raise exception 'Only an admin can see the users.'; end if;
  return query
    select s.email, s.name, s.role, s.active, s.created_at, (u.id is not null), u.last_sign_in_at, true, s.mobile, s.pages
      from public.staff s left join auth.users u on lower(u.email) = s.email
    union all
    select lower(u.email)::text, coalesce(u.raw_user_meta_data ->> 'name', ''), ''::text, false, u.created_at, true, u.last_sign_in_at, false, ''::text, null::text[]
      from auth.users u where u.email is not null and not exists (select 1 from public.staff s where s.email = lower(u.email));
end $fn$;
revoke all on function public.staff_overview() from public, anon;
grant execute on function public.staff_overview() to authenticated;
select count(*) as people from public.staff_overview();
