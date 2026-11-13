-- Products (13 Nov 2026): the Retail price list is called Online; every product has a category from Direct's list and a
-- type: an item, or an additional charge (delivery, levies, surcharges...).
alter table public.products rename column price_retail to price_online;
alter table public.products add column if not exists sub_category text not null default 'item';
alter table public.products drop constraint if exists products_sub_category_check;
alter table public.products add constraint products_sub_category_check check (sub_category in ('item', 'additional_charge'));
alter table public.products drop constraint if exists products_category_check;
alter table public.products add constraint products_category_check check (category in ('', 'Concrete', 'Wafflepods', 'Rediwall', 'Reinforcement', 'Hebel', 'Bricks', 'NRG', 'Bluedeck', 'Others'));
select count(*) as products, count(*) filter (where sub_category = 'item') as items from public.products;
