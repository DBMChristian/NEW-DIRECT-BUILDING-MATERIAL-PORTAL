-- The order page's actions (13 Nov 2026): notes on an order (who and when), and cancelling an order (with its reason):
-- the order, its loads and its POs are cancelled, and what is already in Xero is deleted there (a draft) or voided.
create table if not exists public.order_notes (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  text text not null check (length(btrim(text)) > 0),
  by_email text not null default '',
  by_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists order_notes_order_idx on public.order_notes (order_id, created_at desc);
alter table public.order_notes enable row level security;
drop policy if exists "staff read order notes" on public.order_notes;
create policy "staff read order notes" on public.order_notes for select to authenticated using (public.my_role() <> '');
drop policy if exists "office adds order notes" on public.order_notes;
create policy "office adds order notes" on public.order_notes for insert to authenticated with check (public.my_role() in ('admin', 'office'));

create or replace function public.cancel_order(p_id bigint, p_reason text) returns jsonb
language plpgsql security definer set search_path to '' as $fn$
declare o public.orders; q jsonb := '[]'::jsonb; qid bigint; x record; who text := coalesce(auth.jwt() ->> 'email', '');
begin
  if public.my_role() not in ('admin', 'office') then raise exception 'Only the office cancels orders.'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Give the reason for cancelling.'; end if;
  select * into o from public.orders where id = p_id for update;
  if o.id is null then raise exception 'No such order.'; end if;
  if o.status = 'cancelled' then return jsonb_build_object('already', true); end if;
  if o.status = 'draft' then raise exception 'A draft is not cancelled: delete it from Unfinished forms.'; end if;
  update public.orders set status = 'cancelled', updated_at = now() where id = p_id;
  update public.order_loads set status = 'cancelled' where order_id = p_id;
  update public.order_pos set status = 'cancelled' where order_id = p_id;
  insert into public.order_notes (order_id, text, by_email, by_name)
    values (p_id, 'Cancelled: ' || btrim(p_reason), who, coalesce((select name from public.staff where email = lower(who)), who));
  /* in Xero: each invoice and PO that went is deleted (draft) or voided; one still waiting is taken out of the queue */
  for x in select * from public.xero_queue where ref in (select 'INV-' || regexp_replace(o.number, '\D', '', 'g') union select number from public.order_pos where order_id = p_id and number is not null) and action = 'create' loop
    if x.status = 'done' and x.xero_id is not null then
      insert into public.xero_queue (kind, action, ref, party, amount, payload, xero_id, created_by) values (x.kind, 'delete', x.ref, x.party, x.amount, '{}'::jsonb, x.xero_id, who) returning id into qid;
      q := q || to_jsonb(qid);
    elsif x.status in ('waiting', 'failed') then
      update public.xero_queue set status = 'done', last_error = 'Order cancelled before it went to Xero', sent_at = now(), sent_by = who where id = x.id;
    end if;
  end loop;
  return jsonb_build_object('xero', q);
end $fn$;
revoke all on function public.cancel_order(bigint, text) from public, anon;
grant execute on function public.cancel_order(bigint, text) to authenticated;
select 'ok' as order_actions;
