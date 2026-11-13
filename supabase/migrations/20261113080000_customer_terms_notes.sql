-- Customers (13 Nov 2026): the sales payment terms as Xero has them on each contact (filled by the next sync), and the
-- customer notes brought over from the previous portal (matched by name; skipped if the same note is already there).
alter table public.customers add column if not exists xero_terms_day int;
alter table public.customers add column if not exists xero_terms_type text not null default '';

insert into public.customer_notes (customer_id, text, by_email, created_at, updated_at)
select c.id, v.text, v.by_email, v.at::timestamptz, v.at::timestamptz
from (values
  ('Northpoint Residential Projects Pty Ltd', 'Imported from Xero. Owes 27,324.11 on INV-0074, INV-0076, INV-0078. NCI: $100,000 approved.', 'previous portal', '2026-09-10'),
  ('15 BARKER PTY LTD', 'Imported from Xero. Owes 6,347.22 on INV-0080. Not registered with NCI.', 'previous portal', '2026-09-10'),
  ('DBM', 'Imported from Xero. Owes 3,135.00 on INV-0061 (HEB100012, Westmead). A group entity; no NCI check.', 'previous portal', '2026-09-10'),
  ('CDS GROUP COD', 'Imported from Xero. COD by name but owes 4,783.77 on INV-0077. NCI knows CDS GROUP PTY LTD, no limit on file.', 'previous portal', '2026-09-10'),
  ('Trade Supply Group COD', 'Imported from Xero. Contact Andrew.', 'previous portal', '2026-09-10'),
  ('We Construction COD', 'Imported from Xero. Contact Ian.', 'previous portal', '2026-09-10'),
  ('All Spec Homes COD', 'Imported from Xero.', 'previous portal', '2026-09-10'),
  ('Michael Simitzis Construction COD', 'Imported from Xero.', 'previous portal', '2026-09-10'),
  ('Building Gear COD', 'Imported from Xero.', 'previous portal', '2026-09-10'),
  ('NSW TRADE GROUP COD', 'Imported from Xero.', 'previous portal', '2026-09-10'),
  ('Ross Form COD', 'Imported from Xero.', 'previous portal', '2026-09-10'),
  ('Saade Construction', 'Imported from Xero. Nothing owed: kept COD until Siraj opens an account.', 'previous portal', '2026-09-10'),
  ('Resbuilt', 'Imported from Xero. Kept COD until Siraj opens an account.', 'previous portal', '2026-09-10'),
  ('BEN COD', 'Imported from Xero.', 'previous portal', '2026-09-10'),
  ('Highland Industrial Builders', 'Imported from Xero. Kept COD until Siraj opens an account.', 'previous portal', '2026-09-10'),
  ('CG Group', 'Imported from Xero. Kept COD until Siraj opens an account.', 'previous portal', '2026-09-10'),
  ('El jer investments pty ltd.', 'Imported from Xero. Kept COD until Siraj opens an account.', 'previous portal', '2026-09-10'),
  ('COD SALE', 'Imported from Xero. Xero''s catch-all walk-in contact, kept for history only.', 'previous portal', '2026-09-10'),
  ('S.E.W COD', 'Imported from Xero. Xero shows a $300 credit in their favour; settle it in Xero, the portal holds no credits.', 'previous portal', '2026-09-10'),
  ('TG POJECTS', 'Imported from Xero. Owes 21,687.16 on INV-0085. Spelt ''POJECTS'' in Xero; NCI knows TG PROJECTS PTY LTD with no limit on file — fix the spelling in Xero or here, not both.', 'previous portal', '2026-09-10'),
  ('Global warehouse COD', 'Imported from Xero. COD by name but owes 7,348.55 on INV-0055, INV-0084, INV-0090 — chase, or open an account.', 'previous portal', '2026-09-10'),
  ('A GRADE CONCRETE PTY', 'Imported from Xero. Owes 35,870.12 on INV-0064, INV-0065 (due 30 Sep) and INV-0081. NCI: A GRADE CONCRETE PTY. LIMITED, $240,000 approved 21 Aug 2026 on policy 1368652-1 — confirm it is this entity.', 'previous portal', '2026-09-10'),
  ('TEST', E'TEST\nCOST PRICE', 'teresa', '2026-11-09T22:44:26Z')
) as v(name, text, by_email, at)
join public.customers c on lower(btrim(c.name)) = lower(btrim(v.name))
where not exists (select 1 from public.customer_notes x where x.customer_id = c.id and x.text = v.text);

select (select count(*) from public.customer_notes) as notes, (select count(distinct customer_id) from public.customer_notes) as customers_with_notes;
