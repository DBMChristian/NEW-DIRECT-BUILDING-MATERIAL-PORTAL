-- Website enquiries (13 Nov 2026), connected as the previous portal's: Direct's website "Send your plans" form saves each
-- enquiry in the previous portal (website_leads); until the website is pointed here, every new one is forwarded to this
-- portal straight away (website-lead function). The three already there are brought over below.
alter table public.enquiries add column if not exists site_address text not null default '';
alter table public.enquiries add column if not exists attachment_url text not null default '';
alter table public.enquiries add column if not exists temp text not null default '';
alter table public.enquiries add column if not exists note text not null default '';
alter table public.enquiries add column if not exists source_ref text unique;   /* 'website_leads:<id>' in the previous portal */

insert into public.enquiries (name, phone, email, site_address, product, message, attachment_url, temp, status, note, taken_by, taken_by_name, created_at, updated_at, source_ref) values
  ('TEST - website form check (Kulsum) - please ignore', '0400000000', 'test@example.invalid', '16 Cassola Place, Penrith NSW 2750', 'Hebel', 'TEST ONLY - please ignore.', '', 'Warm', 'closed', 'Lost: test', 'rosario.t@discountbuildingmaterial.com.au', 'Rosario T', '2026-10-12 06:57:19+00', now(), 'website_leads:2'),
  ('Vishi CHANDRALA', '0417063211', 'vchandrala@yahoo.com.au', 'Lot 11, 140a Hawthorne Parade, Ardlethan NSW 2665, Australia', 'BlueDeck', 'Custom length of bluedeck 0.75mm thick as per strctural plan for suspended slab.', 'https://res.cloudinary.com/dwy0ctgae/image/upload/v1793875579/lead-uploads/ch64inprbtr1lsi', 'Warm', 'new', '', '', '', '2026-11-05 10:46:22+00', now(), 'website_leads:3'),
  ('Kristy Herring', '0413717915', 'herringestate55@gmail.com', '55 harold lane', 'Other', 'Hi, was after a quote for bondeck for the suspended slab on plan.', 'https://res.cloudinary.com/dwy0ctgae/image/upload/v1794010888/lead-uploads/farjfsyjjzwrfwz', 'Warm', 'working', '', 'rosario.t@discountbuildingmaterial.com.au', 'Rosario T', '2026-11-07 00:21:32+00', now(), 'website_leads:4')
on conflict (source_ref) do nothing;
select name, status, product from public.enquiries order by created_at;
