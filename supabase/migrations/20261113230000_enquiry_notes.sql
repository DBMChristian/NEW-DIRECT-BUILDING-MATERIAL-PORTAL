-- Website enquiries (13 Nov 2026): notes are added one at a time, each with who added it and when (as customer notes).
create table if not exists public.enquiry_notes (
  id bigint generated always as identity primary key,
  enquiry_id bigint not null references public.enquiries(id) on delete cascade,
  text text not null check (length(btrim(text)) > 0),
  by_email text not null default '',
  by_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists enquiry_notes_enquiry_idx on public.enquiry_notes (enquiry_id, created_at);
alter table public.enquiry_notes enable row level security;
drop policy if exists "staff read enquiry notes" on public.enquiry_notes;
create policy "staff read enquiry notes" on public.enquiry_notes for select to authenticated using (public.my_role() in ('admin', 'office'));
drop policy if exists "office adds enquiry notes" on public.enquiry_notes;
create policy "office adds enquiry notes" on public.enquiry_notes for insert to authenticated with check (public.my_role() in ('admin', 'office'));
-- a note already on an enquiry (from the previous portal) becomes its first note
insert into public.enquiry_notes (enquiry_id, text, by_email, by_name, created_at)
select e.id, e.note, 'previous portal', 'Previous portal', e.updated_at from public.enquiries e
where btrim(e.note) <> '' and not exists (select 1 from public.enquiry_notes n where n.enquiry_id = e.id and n.text = e.note);
select count(*) as notes from public.enquiry_notes;
