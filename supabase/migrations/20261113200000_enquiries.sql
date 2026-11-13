-- Home (13 Nov 2026): website enquiries. Each enquiry from Direct's website form lands here (the form's hook comes with
-- the website step); the office takes it, works it and closes it, as on the current Home.
create table if not exists public.enquiries (
  id bigint generated always as identity primary key,
  name text not null default '',
  phone text not null default '',
  email text not null default '',
  product text not null default '',
  location text not null default '',
  message text not null default '',
  status text not null default 'new' check (status in ('new', 'working', 'quoted', 'closed')),
  taken_by text not null default '',
  taken_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists enquiries_status_idx on public.enquiries (status, created_at desc);
alter table public.enquiries enable row level security;
drop policy if exists "staff read enquiries" on public.enquiries;
create policy "staff read enquiries" on public.enquiries for select to authenticated using (public.my_role() in ('admin', 'office'));
drop policy if exists "office works enquiries" on public.enquiries;
create policy "office works enquiries" on public.enquiries for update to authenticated using (public.my_role() in ('admin', 'office')) with check (public.my_role() in ('admin', 'office'));
select count(*) as enquiries from public.enquiries;
