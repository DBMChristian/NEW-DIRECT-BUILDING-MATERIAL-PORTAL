import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../auth/AuthProvider.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { chargesFor, FORM_CHARGES, WP_LOCATIONS, PLANTS } from '../lib/charges.js';

/* New Order, as approved (13 Nov 2026): one page. 1 the customer (their chips and red notes), 2 the products (the
   category chips, the search, Show all), 3 on this order: one block per material, which is its own load (delivery or
   pick-up, site, day, time, its questions), its products and its additional charges (the previous form's rules); the
   order summed up on the right. It saves itself as a draft; Place order numbers it, and queues its invoice for Xero.
   A changed price needs a reason; a customer on hold or over their limit is warned in red. */
const CATS = ['Concrete', 'Wafflepods', 'Rediwall', 'Reinforcement', 'Hebel', 'Bricks', 'NRG', 'Bluedeck', 'Others'];
const COLOR = { Concrete: '#CA8A04', Wafflepods: '#7C3AED', Rediwall: '#EA580C', Reinforcement: '#92400E', Hebel: '#2563EB', Bricks: '#B91C1C', NRG: '#16A34A', Bluedeck: '#0891B2', Others: '#78716C' };
const HEAD = { Concrete: '#A16207', Wafflepods: '#6D28D9', Rediwall: '#C2410C', Reinforcement: '#78350F', Hebel: '#1D4ED8', Bricks: '#991B1B', NRG: '#15803D', Bluedeck: '#0E7490', Others: '#57534E' };
const TIMES = ['Any time', 'AM', 'PM', '7-9am', 'First drop', 'Last drop'];
const cash = (v) => '$' + Number(v || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
let seq = 0; const key = () => 'k' + Date.now().toString(36) + (seq++);

function Seg({ value, set, options }) {
  return <div className="no-seg" role="group">{options.map(([v, l]) => <button key={v} type="button" className={value === v ? 'on' : ''} aria-pressed={value === v} onClick={() => set(v)}>{l}</button>)}</div>;
}

export default function NewOrder() {
  const { staff } = useAuth();
  const nav = useNavigate();
  const [products, setProducts] = useState([]);
  const [extraPrices, setExtraPrices] = useState({});
  const [routes, setRoutes] = useState([]);
  const [o, setO] = useState({ id: null, kind: 'order', customer: null, contact_name: '', contact_phone: '', email: '', their_po: '', instructions: '' });
  const [lines, setLines] = useState([]);              /* products: { key, product_id, code, name, unit, category, qty, price, list, reason } */
  const [loads, setLoads] = useState({});              /* by material: { fulfil, site, date, time, answers } */
  const [over, setOver] = useState({});                /* a charge typed over: { 'Cat|key': { price, qty, reason, off } } */
  const [notes, setNotes] = useState([]);
  const [cq, setCq] = useState(''); const [cHits, setCHits] = useState([]);
  const [cat, setCat] = useState(''); const [q, setQ] = useState(''); const [all, setAll] = useState(false);
  const [saved, setSaved] = useState(null); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(null); const [done, setDone] = useState(null);

  useEffect(() => { (async () => {
    const ps = []; let f = 0;
    for (;;) { const { data } = await supabase.from('products').select('id, code, name, unit, category, sub_category, xero_sales_price, price_builder, price_installer, price_online, in_xero, active').range(f, f + 999); ps.push(...(data || [])); if (!data || data.length < 1000) break; f += 1000; }
    setProducts(ps);
    const ex = {}; f = 0;
    for (;;) { const { data } = await supabase.from('product_prices').select('product_id, list_id, price').range(f, f + 999); (data || []).forEach((r) => { (ex[r.product_id] = ex[r.product_id] || {})[r.list_id] = Number(r.price); }); if (!data || data.length < 1000) break; f += 1000; }
    setExtraPrices(ex);
    const rt = await supabase.from('supplier_routes').select('portal, categories, supplier:suppliers(name, active)'); setRoutes(rt.data || []);
  })(); }, []);

  /* the customer's price for a product: their price list, else Xero's */
  const priceFor = (p, pl = o.customer?.price_list || 'builder') => {
    if (!p) return 0;
    const m = /^list:(\d+)$/.exec(pl), v = m ? (extraPrices[p.id] || {})[m[1]] : pl === 'installer' ? p.price_installer : pl === 'online' ? p.price_online : p.price_builder;
    return Number(v ?? p.xero_sales_price ?? 0);
  };
  const byCode = useMemo(() => new Map(products.map((p) => [String(p.code).toLowerCase(), p])), [products]);
  const ctx = { priceOf: (code) => priceFor(byCode.get(String(code).toLowerCase())), nameOf: (code) => byCode.get(String(code).toLowerCase())?.name, company: o.customer?.name };
  const routeOf = (c) => routes.find((r) => (r.categories || []).includes(c) && r.supplier?.active !== false);

  /* customer search */
  useEffect(() => { const t = cq.trim(); if (t.length < 2 || o.customer) { setCHits([]); return; }
    const h = setTimeout(async () => { const like = '%' + t.replace(/[%_]/g, '') + '%';
      const { data } = await supabase.from('customers').select('*').or(`name.ilike.${like},email.ilike.${like},phone.ilike.${like},mobile.ilike.${like}`).eq('in_xero', true).order('name').limit(10); setCHits(data || []); }, 200);
    return () => clearTimeout(h); }, [cq, o.customer]);
  const pickCustomer = async (c) => {
    setO((x) => ({ ...x, customer: c, contact_name: x.contact_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.name, contact_phone: x.contact_phone || c.mobile || c.phone, email: x.email || c.email }));
    setCq(''); setCHits([]);
    const { data } = await supabase.from('customer_notes').select('*').eq('customer_id', c.id).order('created_at', { ascending: false }); setNotes(data || []);
    setLines((ls) => ls.map((l) => { const p = products.find((x) => x.id === l.product_id); const np = priceFor(p, c.price_list); return { ...l, list: np, price: l.price === l.list ? np : l.price }; }));
  };

  /* products to pick from: items only (the form adds the charges itself) */
  const pickable = useMemo(() => products.filter((p) => p.in_xero && p.active && p.sub_category !== 'additional_charge' && !FORM_CHARGES.includes(String(p.code).toUpperCase())), [products]);
  const shown = useMemo(() => { const t = q.trim().toLowerCase();
    if (t.length >= 2) return pickable.filter((p) => (!cat || p.category === cat) && (p.code + ' ' + p.name).toLowerCase().includes(t)).slice(0, 30);
    if (cat && all) return pickable.filter((p) => p.category === cat).sort((a, b) => a.name.localeCompare(b.name));
    return []; }, [pickable, q, cat, all]);
  const catCount = (c) => pickable.filter((p) => p.category === c).length;
  const add = (p) => {
    const c = p.category || 'Others';
    setLines((ls) => { const ex = ls.find((l) => l.product_id === p.id); if (ex) return ls.map((l) => (l === ex ? { ...l, qty: Number(l.qty) + 1 } : l));
      const pr = priceFor(p); return [...ls, { key: key(), product_id: p.id, code: p.code, name: p.name, unit: p.unit || 'each', category: c, qty: 1, price: pr, list: pr, reason: '' }]; });
    setLoads((L) => (L[c] ? L : { ...L, [c]: { fulfil: 'delivery', site: '', date: '', time: 'Any time', answers: c === 'Concrete' ? { plant: '', pour: 'Pump', truck: 'Any Truck Size', spacing: '15min', message: 'Neat' } : {} } }));
  };
  const setLine = (k, ch) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...ch } : l)));
  const setLoad = (c, ch) => setLoads((L) => ({ ...L, [c]: { ...L[c], ...ch } }));
  const setAns = (c, ch) => setLoads((L) => ({ ...L, [c]: { ...L[c], answers: { ...(L[c].answers || {}), ...ch } } }));

  /* the materials on the order, each with its products and charges */
  const groups = useMemo(() => CATS.filter((c) => lines.some((l) => l.category === c)).map((c) => {
    const ls = lines.filter((l) => l.category === c), ld = loads[c] || { fulfil: 'delivery', answers: {} };
    const ch = chargesFor(c, lines, ld, ctx).map((x) => { const ov = over[c + '|' + x.key] || {}; return { ...x, list: x.price, price: ov.price ?? x.price, qty: ov.qty ?? x.qty, reason: ov.reason || '', off: !!ov.off }; });
    const goods = ls.reduce((s, l) => s + r2(l.qty * l.price), 0), chs = ch.filter((x) => !x.off).reduce((s, x) => s + r2(x.qty * x.price), 0);
    return { c, ls, ld, ch, total: r2(goods + chs) };
  }), [lines, loads, over, products, extraPrices, o.customer]);
  const sub = r2(groups.reduce((s, g) => s + g.total, 0)), gst = r2(sub * 0.1), total = r2(sub + gst);
  const owes = Number(o.customer?.xero_awaiting_payment || 0) + Number(o.customer?.xero_awaiting_approval || 0);
  const overLimit = o.customer && o.customer.credit_limit != null && owes + (o.kind === 'order' ? total : 0) > Number(o.customer.credit_limit);

  /* what is still missing before placing */
  const missing = useMemo(() => {
    if (!o.customer) return 'Choose the company.';
    if (!o.contact_name.trim() || !o.contact_phone.trim()) return 'Enter their name and phone.';
    if (!lines.length) return 'Add at least one product.';
    for (const g of groups) {
      if (g.ld.fulfil === 'delivery' && !String(g.ld.site || '').trim()) return g.c + ': enter the site address.';
      if (o.kind === 'order' && !g.ld.date) return g.c + ': choose the ' + (g.ld.fulfil === 'delivery' ? 'delivery' : 'pick-up') + ' date.';
      const bad = g.ls.find((l) => Math.abs(l.price - l.list) >= 0.005 && l.reason.trim().length < 3) || g.ch.find((x) => !x.off && Math.abs(x.price - x.list) >= 0.005 && x.reason.trim().length < 3);
      if (bad) return 'Give the reason for the changed price of ' + bad.name + '.';
      const note = g.ch.find((x) => !x.off && x.note); if (note) return g.c + ': ' + note.note + '.';
    }
    return '';
  }, [o, lines, groups]);

  /* the draft: saved as you go (the order, its loads, its lines) */
  const busyRef = useRef(false);
  const save = async () => {
    if (!o.customer && !lines.length) return o.id;
    if (busyRef.current) return o.id; busyRef.current = true;
    try {
      const head = { kind: o.kind, customer_id: o.customer?.id || null, customer_name: o.customer?.name || '', terms: o.customer?.terms || 'cod', price_list: o.customer?.price_list || 'builder',
        contact_name: o.contact_name, contact_phone: o.contact_phone, email: o.email, their_po: o.their_po, instructions: o.instructions, subtotal: sub, gst, total, updated_at: new Date().toISOString() };
      let id = o.id;
      if (!id) { const r = await supabase.from('orders').insert({ ...head, created_by: staff.email, created_by_name: staff.name || staff.email.split('@')[0] }).select('id').single(); if (r.error) throw r.error; id = r.data.id; setO((x) => ({ ...x, id })); }
      else { const r = await supabase.from('orders').update(head).eq('id', id).eq('status', 'draft'); if (r.error) throw r.error; }
      await supabase.from('order_loads').delete().eq('order_id', id);
      let sort = 0;
      for (const g of groups) {
        const ld = await supabase.from('order_loads').insert({ order_id: id, category: g.c, fulfil: g.ld.fulfil, site_address: g.ld.fulfil === 'delivery' ? g.ld.site || '' : '', want_date: g.ld.date || null, want_time: g.ld.time || 'Any time', answers: g.ld.answers || {}, status: o.customer?.on_hold ? 'on_hold' : 'pending', sort: sort++ }).select('id').single();
        if (ld.error) throw ld.error;
        const rows = [...g.ls.map((l, i) => ({ order_id: id, load_id: ld.data.id, product_id: l.product_id, code: l.code, name: l.name, unit: l.unit, qty: l.qty, price: l.price, list_price: l.list, price_reason: l.reason, sort: i })),
          ...g.ch.filter((x) => !x.off).map((x, i) => ({ order_id: id, load_id: ld.data.id, product_id: byCode.get(String(x.code).toLowerCase())?.id || null, code: x.code === 'DELIVERY' ? '' : x.code, name: x.name, unit: x.unit, qty: x.qty, price: x.price, list_price: x.list, price_reason: x.reason, is_charge: true, charge_key: x.key, sort: 100 + i }))];
        if (rows.length) { const r = await supabase.from('order_lines').insert(rows); if (r.error) throw r.error; }
      }
      setSaved(new Date()); return id;
    } catch (e) { setMsg({ bad: true, text: 'Not saved: ' + (e.message || e) }); return o.id; }
    finally { busyRef.current = false; }
  };
  useEffect(() => { const t = setTimeout(save, 1500); return () => clearTimeout(t); }, [o.kind, o.customer, o.contact_name, o.contact_phone, o.email, o.their_po, o.instructions, lines, loads, over]);

  const place = async () => {
    if (missing) { setMsg({ bad: true, text: 'Not ready: ' + missing }); return; }
    setBusy(true); setMsg(null);
    const id = await save();
    const { data, error } = await supabase.rpc('place_order', { p_id: id });
    setBusy(false);
    if (error) { setMsg({ bad: true, text: error.message }); return; }
    setDone({ number: data.number, kind: o.kind, total, customer: o.customer.name });
  };
  const restart = () => { setO({ id: null, kind: 'order', customer: null, contact_name: '', contact_phone: '', email: '', their_po: '', instructions: '' }); setLines([]); setLoads({}); setOver({}); setNotes([]); setDone(null); setSaved(null); setMsg(null); };

  if (done) return (
    <>
      <PageHeader title={done.kind === 'quote' ? 'QUOTE SAVED' : 'ORDER PLACED'} sub={done.number + ' · ' + done.customer + ' · ' + cash(done.total)} />
      <div className="no-done"><div className="no-card"><h2>{done.number}</h2><p>{done.kind === 'quote' ? 'The quote is saved.' : 'The order is placed: it is on Home under Pending, and its invoice is in the Xero queue (Admin › Not yet in Xero).'}</p>
        <div className="no-row"><button type="button" className="btn btn-red" onClick={restart}>New order</button><button type="button" className="btn" onClick={() => nav('/')}>Home</button></div></div></div>
    </>
  );

  return (
    <>
      <PageHeader title="NEW ORDER" sub={saved ? 'Draft saved ' + saved.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }) : 'Fills in as you go; saved as a draft'} />
      <div className="no">
        <div className="no-main">
          <section className="no-card" aria-label="Customer">
            <div className="no-ct"><i>1</i>Customer<span className="no-kind"><Seg value={o.kind} set={(v) => setO({ ...o, kind: v })} options={[['order', 'Order'], ['quote', 'Quote']]} /></span></div>
            {!o.customer ? (
              <label className="no-f">Company <span className="req">*</span>
                <input value={cq} onChange={(e) => setCq(e.target.value)} placeholder="Type a company, name, phone or email…" autoFocus />
                {cHits.length > 0 && <div className="no-pop">{cHits.map((c) => <button key={c.id} type="button" onClick={() => pickCustomer(c)}><b>{c.name}</b><small>{[c.email, c.mobile || c.phone].filter(Boolean).join(' · ')} · {c.terms === 'account' ? 'Account' : 'COD'}{c.on_hold ? ' · ON HOLD' : ''}</small></button>)}</div>}
              </label>
            ) : (
              <>
                <div className="no-cust"><b>{o.customer.name}</b><button type="button" className="link" onClick={() => { setO({ ...o, customer: null }); setNotes([]); }}>Change</button></div>
                <div className="no-chips">
                  <span className="no-chip" style={{ background: '#FEF3C7', color: '#92400E' }}>{o.customer.terms === 'account' ? 'Account' : 'COD'}</span>
                  <span className="no-chip" style={{ background: '#E0E7FF', color: '#3730A3' }}>{/^list:/.test(o.customer.price_list) ? 'Special prices' : o.customer.price_list.charAt(0).toUpperCase() + o.customer.price_list.slice(1) + ' prices'}</span>
                  {o.customer.credit_limit != null && <span className="no-chip" style={{ background: '#F5F5F4', color: '#44403C' }}>Limit {cash(o.customer.credit_limit)}</span>}
                  {owes > 0 && <span className="no-chip" style={{ background: '#FEE2E2', color: '#991B1B' }}>Owes {cash(owes)}</span>}
                  {o.customer.on_hold && <span className="no-chip" style={{ background: '#DC2626', color: '#fff' }}>ON HOLD</span>}
                </div>
                {notes.map((n) => <div key={n.id} className="no-note">{n.text}<small>{n.by_name || n.by_email} · {new Date(n.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}</small></div>)}
                <div className="no-grid">
                  <label className="no-f">Their name <span className="req">*</span><input value={o.contact_name} onChange={(e) => setO({ ...o, contact_name: e.target.value })} /></label>
                  <label className="no-f">Their phone <span className="req">*</span><input value={o.contact_phone} onChange={(e) => setO({ ...o, contact_phone: e.target.value })} inputMode="tel" /></label>
                  <label className="no-f">Email for the invoice<input value={o.email} onChange={(e) => setO({ ...o, email: e.target.value })} type="email" /></label>
                  <label className="no-f">Their PO<input value={o.their_po} onChange={(e) => setO({ ...o, their_po: e.target.value })} placeholder="Optional" /></label>
                </div>
              </>
            )}
          </section>

          <section className="no-card" aria-label="Products">
            <div className="no-ct"><i>2</i>Products</div>
            <div className="no-cats">{CATS.filter((c) => catCount(c)).map((c) => <button key={c} type="button" className={'no-cat' + (cat === c ? ' on' : '')} style={{ '--c': COLOR[c] }} onClick={() => { setCat(cat === c ? '' : c); setAll(false); }}><i />{c}</button>)}</div>
            <input type="search" className="no-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={cat ? 'Search ' + cat + ' by name or code…' : 'Search a product by name or code…'} aria-label="Search a product" />
            {cat && q.trim().length < 2 && <button type="button" className={'no-all' + (all ? ' on' : '')} onClick={() => setAll(!all)}><span>{all ? '▾' : '▸'} Show all {cat} products</span><small>{catCount(cat)}</small></button>}
            {shown.length > 0 && <div className="no-res">{shown.map((p) => { const rt = routeOf(p.category); return (
              <div key={p.id} className="no-ri"><div><b>{p.name}</b><small>{p.code} · {p.unit || 'each'}</small></div>
                <span className="no-from">{rt ? rt.supplier?.name?.replace(' Pty Ltd', '') + ' · ' + (rt.portal || 'email') : 'Direct'}</span>
                <span className="no-p">{cash(priceFor(p))}</span><button type="button" className="btn btn-red" onClick={() => add(p)}>Add</button></div>); })}</div>}
            {q.trim().length >= 2 && !shown.length && <p className="no-sub">No product matches.</p>}
          </section>

          <section className="no-card" aria-label="On this order">
            <div className="no-ct"><i>3</i>On this order <small>each material is its own load</small></div>
            {!groups.length && <p className="no-sub">Nothing yet: pick a material or search, then press Add.</p>}
            {groups.map((g) => { const rt = routeOf(g.c), a = g.ld.answers || {}; return (
              <div key={g.c} className="no-grp">
                <div className="no-gh" style={{ background: HEAD[g.c] }}>{g.c} <small>{g.ls.length} product{g.ls.length === 1 ? '' : 's'} · {cash(g.total)}</small><span>{rt ? 'PO to ' + rt.supplier?.name?.replace(' Pty Ltd', '') + (rt.portal ? ' · ' + rt.portal : '') : 'From Direct'}</span></div>
                <div className="no-load">
                  <Seg value={g.ld.fulfil} set={(v) => setLoad(g.c, { fulfil: v })} options={[['delivery', 'Delivery'], ['pickup', 'Pick-up']]} />
                  {g.ld.fulfil === 'delivery' && <label className="no-f no-grow">Site address <span className="req">*</span><input value={g.ld.site || ''} onChange={(e) => setLoad(g.c, { site: e.target.value })} placeholder="Street, suburb, postcode" /></label>}
                  <label className="no-f">{g.ld.fulfil === 'delivery' ? 'Delivery date' : 'Pick-up date'}{o.kind === 'order' && <span className="req"> *</span>}<input type="date" value={g.ld.date || ''} onChange={(e) => setLoad(g.c, { date: e.target.value })} /></label>
                  <label className="no-f">Time<select value={g.ld.time || 'Any time'} onChange={(e) => setLoad(g.c, { time: e.target.value })}>{TIMES.map((t) => <option key={t}>{t}</option>)}</select></label>
                </div>
                {g.c === 'Wafflepods' && g.ld.fulfil === 'delivery' && <div className="no-load no-qs">
                  <label className="no-f">Location <span className="req">*</span><select value={a.location || ''} onChange={(e) => setAns(g.c, { location: e.target.value })}><option value="">Choose…</option>{WP_LOCATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                  {(a.location === 'NSW' || a.location === 'ACT') && <label className="no-f">Driving time (hours, one way)<input inputMode="decimal" value={a.hours || ''} onChange={(e) => setAns(g.c, { hours: e.target.value })} /></label>}
                  <label className="no-f">Scrap pick-up<Seg value={a.scrap || 'no'} set={(v) => setAns(g.c, { scrap: v })} options={[['yes', 'Yes'], ['no', 'No']]} /></label>
                  <label className="no-f">Trailer access<Seg value={a.trailer || 'yes'} set={(v) => setAns(g.c, { trailer: v })} options={[['yes', 'Yes'], ['no', 'No']]} /></label>
                  <label className="no-f">Gate code<input value={a.gate || ''} onChange={(e) => setAns(g.c, { gate: e.target.value })} placeholder="Code, or N/A" /></label>
                </div>}
                {g.c === 'Concrete' && <div className="no-load no-qs">
                  <label className="no-f">Plant<select value={a.plant || ''} onChange={(e) => setAns(g.c, { plant: e.target.value })}>{PLANTS.map((p) => <option key={p} value={p}>{p || 'DBM chooses'}</option>)}</select></label>
                  <label className="no-f">Pour<select value={a.pour || 'Pump'} onChange={(e) => setAns(g.c, { pour: e.target.value })}>{['Pump', 'Line', 'Chute', 'Boom'].map((x) => <option key={x}>{x}</option>)}</select></label>
                  <label className="no-f">Truck<select value={a.truck || 'Any Truck Size'} onChange={(e) => setAns(g.c, { truck: e.target.value })}>{['Any Truck Size', '10-Wheeler Only', '8-Wheeler Only', '6-Wheeler Only', 'Mini Only'].map((x) => <option key={x}>{x}</option>)}</select></label>
                  <label className="no-f">Spacing<select value={a.spacing || '15min'} onChange={(e) => setAns(g.c, { spacing: e.target.value })}>{['10min', '15min', '20min', '25min', '30min', '45min', 'N/A'].map((x) => <option key={x}>{x}</option>)}</select></label>
                  <label className="no-f">Finish<select value={a.message || 'Neat'} onChange={(e) => setAns(g.c, { message: e.target.value })}>{['Message', 'Neat', 'Neat Plus'].map((x) => <option key={x}>{x}</option>)}</select></label>
                  <label className="no-f">Tester<Seg value={a.tester || 'no'} set={(v) => setAns(g.c, { tester: v })} options={[['yes', 'Yes'], ['no', 'No']]} /></label>
                  <label className="no-f">Coloured<Seg value={a.coloured || 'no'} set={(v) => setAns(g.c, { coloured: v })} options={[['yes', 'Yes'], ['no', 'No']]} /></label>
                  {a.coloured === 'yes' && <><label className="no-f">Colour<input value={a.colour || ''} onChange={(e) => setAns(g.c, { colour: e.target.value })} /></label><label className="no-f">Max m³ in colour<input inputMode="decimal" value={a.maxColour || ''} onChange={(e) => setAns(g.c, { maxColour: e.target.value })} /></label></>}
                </div>}
                <div className="no-tw"><table className="no-t">
                  <thead><tr><th>Product</th><th>Qty</th><th className="r">Unit ex GST</th><th className="r">Amount</th><th /></tr></thead>
                  <tbody>
                    {g.ls.map((l) => { const changed = Math.abs(l.price - l.list) >= 0.005; return (
                      <tr key={l.key}><td><b>{l.name}</b><small>{l.code} · {l.unit}</small></td>
                        <td><span className="no-qty"><button type="button" aria-label="Less" onClick={() => setLine(l.key, { qty: Math.max(0, r2(l.qty - 1)) })}>−</button><input value={l.qty} inputMode="decimal" onChange={(e) => setLine(l.key, { qty: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })} aria-label={'Quantity of ' + l.name} /><button type="button" aria-label="More" onClick={() => setLine(l.key, { qty: r2(l.qty + 1) })}>+</button></span></td>
                        <td className="r"><input className={'no-price' + (changed ? ' ch' : '')} value={l.price} inputMode="decimal" onChange={(e) => setLine(l.key, { price: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })} aria-label={'Price of ' + l.name} />
                          {changed && <><small className="no-was">list {cash(l.list)} <button type="button" className="link" onClick={() => setLine(l.key, { price: l.list, reason: '' })}>↺</button></small><input className={'no-reason' + (l.reason.trim().length < 3 ? ' need' : '')} value={l.reason} onChange={(e) => setLine(l.key, { reason: e.target.value })} placeholder="Reason for the price *" /></>}</td>
                        <td className="r"><b>{cash(r2(l.qty * l.price))}</b></td>
                        <td className="r"><button type="button" className="no-x" aria-label={'Remove ' + l.name} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>×</button></td></tr>); })}
                    {g.ch.length > 0 && <tr className="no-chh"><td colSpan="5">ADDITIONAL CHARGES</td></tr>}
                    {g.ch.map((x) => { const k = g.c + '|' + x.key, changed = Math.abs(x.price - x.list) >= 0.005; return (
                      <tr key={x.key} className={'no-chr' + (x.off ? ' off' : '')}><td>{x.name}{x.note && !x.off && <small className="no-warn">{x.note}</small>}</td><td>{x.qty}</td>
                        <td className="r">{x.locked ? cash(x.price) : <><input className={'no-price' + (changed ? ' ch' : '')} value={x.price} disabled={x.off} inputMode="decimal" onChange={(e) => setOver({ ...over, [k]: { ...(over[k] || {}), price: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 } })} aria-label={'Price of ' + x.name} />
                          {changed && !x.off && <input className={'no-reason' + (x.reason.trim().length < 3 ? ' need' : '')} value={x.reason} onChange={(e) => setOver({ ...over, [k]: { ...(over[k] || {}), reason: e.target.value } })} placeholder="Reason for the price *" />}</>}</td>
                        <td className="r"><b>{x.off ? '—' : cash(r2(x.qty * x.price))}</b></td>
                        <td className="r">{!x.locked && <button type="button" className="no-x" aria-label={(x.off ? 'Put back ' : 'Remove ') + x.name} onClick={() => setOver({ ...over, [k]: { ...(over[k] || {}), off: !x.off } })}>{x.off ? '↺' : '×'}</button>}</td></tr>); })}
                  </tbody>
                </table></div>
              </div>); })}
            <label className="no-f">Special instructions<input value={o.instructions} onChange={(e) => setO({ ...o, instructions: e.target.value })} placeholder="Gate code, access, anything the driver or supplier should know" /></label>
          </section>
        </div>

        <aside className="no-side" aria-label="The order">
          <section className="no-card">
            <div className="no-ct">The {o.kind === 'quote' ? 'quote' : 'order'}</div>
            {o.customer ? <div className="no-sum-c"><b>{o.customer.name}</b> · {o.customer.terms === 'account' ? 'Account' : 'COD'}</div> : <p className="no-sub">No company yet.</p>}
            {groups.map((g) => <div key={g.c} className="no-sl"><span><i style={{ background: COLOR[g.c] }} />{g.c} · {g.ld.fulfil === 'delivery' ? 'delivery' : 'pick-up'}{g.ld.date ? ' ' + new Date(g.ld.date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric' }) : ''}</span><b>{cash(g.total)}</b></div>)}
            <div className="no-tot"><div className="no-sl"><span>Items ex GST</span><b>{cash(sub)}</b></div><div className="no-sl"><span>GST</span><b>{cash(gst)}</b></div><div className="no-sl no-big"><span>Total</span><b>{cash(total)}</b></div></div>
            {o.customer?.on_hold && <div className="no-alert"><b>On hold:</b> this customer is on hold. Check before placing.</div>}
            {overLimit && <div className="no-alert"><b>Over the credit limit:</b> owes {cash(owes)} + this order {cash(total)} = {cash(owes + total)} (limit {cash(o.customer.credit_limit)}).</div>}
            {o.kind === 'order' && groups.length > 0 && <div className="no-what">On placing: the invoice to the Xero queue{groups.map((g) => { const rt = routeOf(g.c); return rt ? ' · ' + g.c + ' PO to ' + rt.supplier?.name?.replace(' Pty Ltd', '') : ''; }).join('')}</div>}
            {msg && <p className={msg.bad ? 'msg bad' : 'msg'} role="status">{msg.text}</p>}
            {missing && !msg && <p className="no-miss">{missing}</p>}
            <button type="button" className="btn btn-red btn-big" disabled={busy} onClick={place}>{busy ? 'Placing…' : o.kind === 'quote' ? 'Save quote' : 'Place order'}</button>
            <div className="no-row"><button type="button" className="btn" onClick={async () => { await save(); setMsg({ text: 'Draft saved.' }); }}>Save draft</button><button type="button" className="btn" onClick={() => { if (window.confirm('Clear the form? The draft stays saved.')) restart(); }}>Clear</button></div>
          </section>
        </aside>
      </div>
    </>
  );
}
