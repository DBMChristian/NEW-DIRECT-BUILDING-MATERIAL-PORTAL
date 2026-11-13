import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import PageHeader from '../components/PageHeader.jsx';

/* Order details (13 Nov 2026): one order as placed. Its header (number, status, customer, who placed it and when), how
   placing went (Xero, the supplier emails, DBM's portals), the customer and site, the sales order by material (items,
   then additional charges, totals), the POs (supplier, portal, sent, its number in the portal, its lines), the loads
   (delivery or pick-up, who delivers, site, day, time, what is on each), and the Xero uploads with their state. */
const cash = (v) => '$' + Number(v || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '');
const when = (t) => (t ? new Date(t).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const CATS = ['Concrete', 'Wafflepods', 'Rediwall', 'Reinforcement', 'Hebel', 'Bricks', 'NRG', 'Bluedeck', 'Others'];
const HEAD = { Concrete: '#A16207', Wafflepods: '#6D28D9', Rediwall: '#C2410C', Reinforcement: '#78350F', Hebel: '#1D4ED8', Bricks: '#991B1B', NRG: '#15803D', Bluedeck: '#0E7490', Others: '#57534E' };
const STATUS = { placed: ['Placed', '#FEF3C7', '#92400E'], quote: ['Quote', '#E0E7FF', '#3730A3'], cancelled: ['Cancelled', '#F5F5F4', '#57534E'], draft: ['Draft', '#F5F5F4', '#57534E'] };
const QA = { pour: 'Pour', truck: 'Truck', spacing: 'Spacing', message: 'Finish', tester: 'Tester', coloured: 'Coloured', colour: 'Colour', location: 'Location', hours: 'Driving time (h)', scrap: 'Scrap pick-up', trailer: 'Trailer access', gate: 'Gate code' };

export default function OrderDetails() {
  const { id } = useParams();
  const nav = useNavigate();
  const placed = useLocation().state?.placed;
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(null);

  const load = async () => {
    const [o, ls, lds, lis, ps, pis, pr] = await Promise.all([
      supabase.from('orders').select('*').eq('id', id).maybeSingle(),
      supabase.from('order_lines').select('*').eq('order_id', id).order('sort'),
      supabase.from('order_loads').select('*').eq('order_id', id).order('sort'),
      supabase.from('order_load_items').select('*, order_loads!inner(order_id)').eq('order_loads.order_id', id),
      supabase.from('order_pos').select('*').eq('order_id', id).order('sort'),
      supabase.from('order_po_items').select('*, order_pos!inner(order_id)').eq('order_pos.order_id', id),
      supabase.from('products').select('id, category'),
    ]);
    if (o.error || !o.data) { setErr(o.error?.message || 'No such order.'); return; }
    const refs = [o.data.number ? 'INV-' + String(o.data.number).replace(/^\D+/, '') : null, ...(ps.data || []).map((p) => p.number)].filter(Boolean);
    const xq = refs.length ? await supabase.from('xero_queue').select('*').in('ref', refs).order('created_at') : { data: [] };
    setD({ o: o.data, lines: ls.data || [], loads: lds.data || [], li: lis.data || [], pos: ps.data || [], pi: pis.data || [], cat: new Map((pr.data || []).map((p) => [p.id, p.category])), xero: xq.data || [] });
  };
  useEffect(() => { load(); }, [id]);

  const view = useMemo(() => {
    if (!d) return null;
    const catOf = (l) => d.cat.get(l.product_id) || 'Others';
    const lineById = new Map(d.lines.map((l) => [l.id, l]));
    /* a charge's material: its load's materials (impact charge Rediwall) */
    const loadCats = new Map(d.loads.map((L) => [L.id, String(L.category || '').split(', ').filter(Boolean)]));
    const chCat = (l) => (String(l.charge_key || '').includes(':') ? String(l.charge_key).split(':')[0] : l.code === 'IMPC' ? 'Rediwall' : (loadCats.get(l.load_id) || [])[0] || 'Others');
    const goods = d.lines.filter((l) => !l.is_charge), charges = d.lines.filter((l) => l.is_charge && Number(l.qty) > 0);
    const merge = (list) => { const out = []; list.forEach((l) => { const k = l.code + '|' + l.name + '|' + l.price; const m = out.find((x) => x.k === k); if (m) m.qty += Number(l.qty); else out.push({ ...l, k, qty: Number(l.qty) }); }); return out; };
    const cats = CATS.filter((c) => goods.some((l) => catOf(l) === c));
    const groups = cats.map((c) => { const gs = goods.filter((l) => catOf(l) === c), ch = merge(charges.filter((l) => chCat(l) === c));
      return { c, gs, ch, total: [...gs, ...ch].reduce((t, l) => t + Number(l.qty) * Number(l.price), 0) }; });
    return { catOf, lineById, groups };
  }, [d]);

  const sync = async (q) => { setBusy(q.id); const r = await supabase.functions.invoke('xero', { body: { action: 'send_queue', id: q.id } }); setBusy(null); if (r.error) { let m = r.error.message; try { m = (await r.error.context.json()).error || m; } catch { /* as it is */ } alert(m); } load(); };

  if (err) return <><PageHeader title="ORDER" sub={err} /><div className="od"><Link to="/">Back to Home</Link></div></>;
  if (!d || !view) return <><PageHeader title="ORDER" sub="Loading…" /></>;
  const { o } = d, st = STATUS[o.status] || STATUS.placed;
  const site = [o.site_street, o.site_suburb].filter(Boolean).join(', ');
  return (
    <>
      <PageHeader title={o.number || 'DRAFT-' + o.id} sub={o.customer_name + ' · ' + cash(o.total) + ' inc GST' + (o.placed_at ? ' · placed ' + when(o.placed_at) + ' by ' + (o.created_by_name || o.created_by) : '')} />
      <div className="od">
        <div className="od-top">
          <span className="od-st" style={{ background: st[1], color: st[2] }}>{st[0]}</span>
          <span className="od-chip">{o.terms === 'account' ? 'Account' : 'COD'}</span>
          <span className="od-chip">{/^list:/.test(o.price_list) ? 'Special prices' : String(o.price_list || '').replace(/^./, (x) => x.toUpperCase()) + ' prices'}</span>
          {o.their_po && <span className="od-chip">Their PO {o.their_po}</span>}
          <span className="od-sp" />
          <button type="button" className="btn" onClick={() => nav('/orders/new')}>New order</button>
          <button type="button" className="btn" onClick={() => nav('/')}>Home</button>
        </div>

        {placed && <section className="od-card od-placed"><h3>{placed.kind === 'quote' ? 'Quote saved' : 'Order placed'} · {placed.number}</h3>
          {!placed.upload && placed.kind !== 'quote' && <p className="od-muted">Not uploaded to Xero (Upload to Xero: No).</p>}
          {[...(placed.xero || []), ...(placed.sent || []).map((t) => ({ ok: true, text: 'PO email sent: ' + t })), ...(placed.failed || []).map((t) => ({ ok: false, text: 'PO email not sent: ' + t })), ...(placed.portal || [])].map((x, i) => <p key={i} className={x.ok ? 'od-ok' : 'od-bad'}>{x.ok ? '✓ ' : '✕ '}{x.text}</p>)}
        </section>}

        <div className="od-grid">
          <section className="od-card"><h3>Customer and site</h3>
            <dl className="od-dl">
              <dt>Company</dt><dd><b>{o.customer_name}</b></dd>
              <dt>Their name</dt><dd>{o.contact_name}</dd>
              <dt>Their phone</dt><dd>{o.contact_phone && <a href={'tel:' + o.contact_phone.replace(/[^0-9+]/g, '')}>{o.contact_phone}</a>}</dd>
              <dt>Email for the invoice</dt><dd>{o.email && <a href={'mailto:' + o.email}>{o.email}</a>}</dd>
              <dt>Site</dt><dd>{site}</dd>
              <dt>Delivery date</dt><dd>{day(o.delivery_date)}{o.booking_time ? ' · ' + o.booking_time : ''}</dd>
              <dt>SMS confirmation</dt><dd>{o.sms_confirm == null ? '—' : o.sms_confirm ? 'Yes' : 'No'}</dd>
              {o.instructions && <><dt>Notes</dt><dd>{o.instructions}</dd></>}
              {(o.plans || []).length > 0 && <><dt>Plans</dt><dd>{o.plans.map((f) => <button key={f.path} type="button" className="link" onClick={async () => { const { data } = await supabase.storage.from('order-files').createSignedUrl(f.path, 300); if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener'); }}>{f.name} ↗</button>)}</dd></>}
            </dl>
          </section>
          <section className="od-card"><h3>Totals</h3>
            <dl className="od-dl od-tot"><dt>Ex GST</dt><dd>{cash(o.subtotal)}</dd><dt>GST</dt><dd>{cash(o.gst)}</dd><dt><b>Total</b></dt><dd><b>{cash(o.total)}</b></dd></dl>
            <h3 className="od-h2">Xero</h3>
            {!d.xero.length ? <p className="od-muted">{o.upload_xero === false ? 'Not uploaded (Upload to Xero: No).' : 'Nothing in Xero yet.'}</p>
              : d.xero.map((q) => <div key={q.id} className="od-xq"><span><b>{q.ref}</b> · {q.kind === 'SO' ? 'sales order' : 'purchase order'}{q.party ? ' · ' + q.party : ''}{q.status === 'failed' && q.last_error ? <small className="od-bad">{q.last_error}</small> : null}</span>
                  <span className={'od-qs od-q-' + q.status}>{q.status === 'done' ? 'In Xero' : q.status === 'failed' ? 'Failed' : q.status === 'sending' ? 'Sending…' : 'Waiting'}</span>
                  {q.status !== 'done' && <button type="button" className="btn" disabled={busy === q.id} onClick={() => sync(q)}>{busy === q.id ? 'Sending…' : 'Sync now'}</button>}</div>)}
          </section>
        </div>

        <section className="od-card"><h3>Sales order</h3>
          {view.groups.map((g) => (
            <div key={g.c} className="od-grp">
              <div className="od-gh" style={{ background: HEAD[g.c] }}>{g.c}<span>{cash(g.total)}</span></div>
              <table className="od-t"><thead><tr><th>Product</th><th className="r">Qty</th><th className="r">Unit ex GST</th><th className="r">Amount</th></tr></thead><tbody>
                {g.gs.map((l) => <tr key={l.id}><td><b>{l.name}</b><small>{l.code}{l.price_reason ? ' · price changed: ' + l.price_reason : ''}</small></td><td className="r">{Number(l.qty)} {l.unit}</td><td className="r">{cash(l.price)}</td><td className="r"><b>{cash(Number(l.qty) * Number(l.price))}</b></td></tr>)}
                {g.ch.length > 0 && <tr className="od-sub"><td colSpan="4">ADDITIONAL CHARGES</td></tr>}
                {g.ch.map((l) => <tr key={l.k} className="od-chr"><td>{l.name}<small>{l.code}</small></td><td className="r">{l.qty}</td><td className="r">{cash(l.price)}</td><td className="r">{cash(l.qty * Number(l.price))}</td></tr>)}
              </tbody></table>
            </div>))}
        </section>

        <section className="od-card"><h3>Purchase orders</h3>
          {!d.pos.length && <p className="od-muted">No POs: everything from Penrith stock.</p>}
          {d.pos.map((p) => { const its = d.pi.filter((x) => x.po_id === p.id); return (
            <div key={p.id} className="od-grp">
              <div className="od-gh" style={{ background: '#1E1A17' }}>{p.number || 'PO'}<small>{p.supplier_name}{p.portal ? ' · ' + p.portal : ''}</small>
                <span className="od-pos">{p.send ? 'Sent' : 'Not sent'}{p.supplier_ref ? ' · in ' + p.portal + ' as ' + p.supplier_ref : ''}{p.fulfil ? ' · ' + (p.fulfil === 'pickup' ? 'Pick-up' : 'Delivery') : ''}</span></div>
              {p.portal_error && p.portal_error !== 'sending' && <p className="od-bad od-pad">Not in {p.portal}: {p.portal_error}</p>}
              {p.notes && <p className="od-muted od-pad">Note to the supplier: {p.notes}</p>}
              <table className="od-t"><thead><tr><th>Product</th><th className="r">Qty</th><th className="r">Unit cost</th><th className="r">Cost</th></tr></thead><tbody>
                {its.map((x) => { const l = view.lineById.get(x.line_id) || {}; return <tr key={x.line_id} className={l.is_charge ? 'od-chr' : ''}><td>{l.is_charge ? l.name : <b>{l.name}</b>}<small>{l.code}</small></td><td className="r">{Number(x.qty)}</td><td className="r">{cash(x.unit_cost)}</td><td className="r">{cash(Number(x.qty) * Number(x.unit_cost || 0))}</td></tr>; })}
              </tbody></table>
            </div>); })}
        </section>

        <section className="od-card"><h3>Loads</h3>
          {d.loads.map((L, i) => { const its = d.li.filter((x) => x.load_id === L.id), a = L.answers || {}; return (
            <div key={L.id} className="od-grp">
              <div className="od-gh" style={{ background: HEAD[String(L.category).split(', ')[0]] || '#1E1A17' }}>Load {i + 1}<small>{L.category}</small>
                <span className="od-pos">{L.fulfil === 'pickup' ? 'Pick-up' : 'Delivery' + (a.delivered_by === 'internal' ? ' · Internal' : ' · Supplier')} · {day(L.want_date)}{L.want_time ? ' · ' + L.want_time : ''}</span></div>
              {L.fulfil === 'delivery' && <p className="od-pad">{L.site_address}</p>}
              {Object.keys(QA).some((k) => a[k]) && <p className="od-qa od-pad">{Object.keys(QA).filter((k) => a[k]).map((k) => <span key={k}><b>{QA[k]}</b> {a[k] === 'yes' ? 'Yes' : a[k] === 'no' ? 'No' : a[k]}</span>)}</p>}
              <table className="od-t"><tbody>{its.map((x) => { const l = view.lineById.get(x.line_id) || {}; return <tr key={x.line_id}><td><b>{l.name}</b><small>{l.code}</small></td><td className="r">{Number(x.qty)} {l.unit}</td></tr>; })}</tbody></table>
            </div>); })}
        </section>
      </div>
    </>
  );
}
