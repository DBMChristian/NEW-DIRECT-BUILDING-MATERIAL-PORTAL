-- Step 1 (13 Nov 2026): the staff who use the portal. A Supabase login can use the portal only with an active row here.
-- Roles: admin (everything, and Admin), office, warehouse, driver. Run once in the new project (qnfuifckyfhiuvqyvkvf).
create table if not exists public.staff (
  email text primary key check (email = lower(email) and email like '%@%'),
  name text not null default '',
  role text not null default 'office' check (role in ('admin', 'office', 'warehouse', 'driver')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- the signed-in person's role ('' when they are not staff)
create or replace function public.my_role() returns text
language sql stable security definer set search_path to '' as $$
  select coalesce((select s.role from public.staff s where s.email = lower(coalesce(auth.jwt() ->> 'email', '')) and s.active), '');
$$;
revoke all on function public.my_role() from public, anon;
grant execute on function public.my_role() to authenticated;

alter table public.staff enable row level security;
drop policy if exists "staff read" on public.staff;
create policy "staff read" on public.staff for select to authenticated
  using (email = lower(coalesce(auth.jwt() ->> 'email', '')) or public.my_role() = 'admin');
drop policy if exists "admin writes staff" on public.staff;
create policy "admin writes staff" on public.staff for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- the first admins (more are added later in Admin > Users)
insert into public.staff (email, name, role) values
  ('christian@discountbuildingmaterial.com.au', 'Christian', 'admin'),
  ('rosario.t@discountbuildingmaterial.com.au', 'Rosario T', 'admin')
on conflict (email) do nothing;

select email, name, role, active from public.staff order by email;
