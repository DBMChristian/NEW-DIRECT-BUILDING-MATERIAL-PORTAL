import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../auth/AuthProvider.jsx';
import PageHeader from '../components/PageHeader.jsx';
import AddressInput from '../components/AddressInput.jsx';
import { chargesFor, impcFor, FORM_CHARGES, WP_LOCATIONS } from '../lib/charges.js';
import { groupsOf } from '../lib/groups.js';
import { EPS_GRADES, epsKind, cutWidth, isPanel, cutSqm, cutBad, isFree, lineName, customMissing } from '../lib/custom.js';

/* New Order (13 Nov 2026), with the previous portal's three tabs under the customer:
   1 Build SO: what the customer buys, one invoice (products, prices with reasons, the additional charges);
   2 Build PO: what Direct orders, one PO per supplier (from Admin › Suppliers), or from Penrith stock; move a product
     to another PO, change what is ordered, deliver to the site or to Penrith;
   3 Build Load: how it goes out, each truck or pick-up and what is on it (split a product over loads), with the day,
     time, site and the waffle pod and concrete questions; the delivery charges follow the loads (previous form's rules).
   Until a PO or a load is changed by hand they follow the products by themselves (one PO per supplier, one load per
   material). It saves itself as a draft; Place order numbers it and queues its invoice for Xero. */
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

/* their phone: an Australian mobile shown as +61 4… (else as typed) */
const digits8 = (v) => { let d = String(v || '').replace(/\D/g, ''); d = d.replace(/^614/, '').replace(/^04/, ''); if (d.length > 8 && d[0] === '4') d = d.slice(1); return d.slice(0, 8); };
const fmt8 = (d) => String(d || '').replace(/^(\d{2})(\d{0,3})(\d{0,3}).*/, (_, a, b, c) => [a, b, c].filter(Boolean).join(' '));
const isMobile = (v) => { const d = String(v || '').replace(/[^0-9]/g, ''); return !d || /^(614|04|4)/.test(d); };
const phoneOut = (o) => (o.contact_phone ? '+61 4' + fmt8(o.contact_phone) : '');
const fmtMob = (v) => { const d = String(v || '').replace(/\D/g, '').replace(/^(61|0)/, '').slice(0, 9); return d.replace(/^(\d{1})(\d{0,2})(\d{0,3})(\d{0,3}).*/, (_, a, b, c, e) => [a + b, c, e].filter(Boolean).join(' ')); };
const blankLoad = (n, h = {}) => ({ uid: key(), fulfil: 'delivery', site: h.site || '', date: h.date || '', time: h.time || 'Any time', answers: {}, items: {}, n });
const qtyIn = (map, k) => Number((map || {})[k] || 0);

export default function NewOrder() {
  const { staff } = useAuth();
  const nav = useNavigate();
  const [tab, setTab] = useState('so');
  const [products, setProducts] = useState([]);
  const [extraPrices, setExtraPrices] = useState({});
  const [routes, setRoutes] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [o, setO] = useState({ id: null, kind: 'order', customer: null, terms: 'cod', price_list: '', contact_name: '', contact_phone: '', mobile: true, email: '', their_po: '', instructions: '', site_street: '', site_suburb: '', delivery_date: '', booking_time: '', sms: null, plans: [] });
  const [lines, setLines] = useState([]);          /* { key, product_id, code, name, unit, category, qty, price, list, reason } */
  const [loadsHand, setLoadsHand] = useState(null); /* null: one load per material by itself; else the loads as arranged */
  const [loadInfo, setLoadInfo] = useState({});    /* the automatic loads' day, site, questions, by material */
  const [posHand, setPosHand] = useState(null);     /* null: one PO per supplier by itself; else the POs as arranged */
  const [over, setOver] = useState({});            /* a charge typed over: { 'load|key': { price, qty, reason, off } } */
  const [notes, setNotes] = useState([]);
  const [priceLists, setPriceLists] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [newCust, setNewCust] = useState(null);
  const [cq, setCq] = useState(''); const [cHits, setCHits] = useState([]);
  const [cat, setCat] = useState(''); const [q, setQ] = useState(''); const [all, setAll] = useState(false);
  const [saved, setSaved] = useState(null); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(null); const [done, setDone] = useState(null);

  useEffect(() => { (async () => {
    const ps = []; let f = 0;
    for (;;) { const { data } = await supabase.from('products').select('id, code, name, unit, category, sub_category, xero_sales_price, xero_cost_price, price_builder, price_installer, price_online, in_xero, active').range(f, f + 999); ps.push(...(data || [])); if (!data || data.length < 1000) break; f += 1000; }
    setProducts(ps);
    const ex = {}; f = 0;
    for (;;) { const { data } = await supabase.from('product_prices').select('product_id, list_id, price').range(f, f + 999); (data || []).forEach((r) => { (ex[r.product_id] = ex[r.product_id] || {})[r.list_id] = Number(r.price); }); if (!data || data.length < 1000) break; f += 1000; }
    setExtraPrices(ex);
    const rt = await supabase.from('supplier_routes').select('portal, categories, supplier_id, supplier:suppliers(id, name, active)'); setRoutes(rt.data || []);
    const pls = await supabase.from('price_lists').select('id, name').order('sort'); setPriceLists(pls.data || []);
    const sp = await supabase.from('suppliers').select('id, name, active').eq('active', true).order('name'); setSuppliers(sp.data || []);
  })(); }, []);

  const priceFor = (p, pl = o.price_list || o.customer?.price_list || 'builder') => {
    if (!p) return 0;
    const m = /^list:(\d+)$/.exec(pl), v = m ? (extraPrices[p.id] || {})[m[1]] : pl === 'installer' ? p.price_installer : pl === 'online' ? p.price_online : p.price_builder;
    return Number(v ?? p.xero_sales_price ?? 0);
  };
  const byCode = useMemo(() => new Map(products.map((p) => [String(p.code).toLowerCase(), p])), [products]);
  const ctx = { priceOf: (code) => priceFor(byCode.get(String(code).toLowerCase())), nameOf: (code) => byCode.get(String(code).toLowerCase())?.name, company: o.customer?.name, noImpc: true };
  const routeOf = (c) => routes.find((r) => (r.categories || []).includes(c) && r.supplier?.active !== false);

  /* the header's site, delivery date and booking time: each load starts from them */
  const headSite = [o.site_street, o.site_suburb].map((x) => String(x || '').trim()).filter(Boolean).join(', ');
  const headLoad = { site: headSite, date: o.delivery_date || '', time: o.booking_time || 'Any time' };
  /* ---------- the loads: by themselves one per material, else as arranged ---------- */
  const loads = useMemo(() => {
    if (loadsHand) return loadsHand.map((L) => ({ ...L, items: Object.fromEntries(Object.entries(L.items).filter(([k]) => lines.some((l) => l.key === k))) }));
    return CATS.filter((c) => lines.some((l) => l.category === c)).map((c, i) => ({ ...blankLoad(i + 1), ...headLoad, uid: 'auto-' + c, ...(loadInfo[c] || {}), auto: c, n: i + 1,
      items: Object.fromEntries(lines.filter((l) => l.category === c).map((l) => [l.key, l.qty])) }));
  }, [loadsHand, lines, loadInfo, headSite, o.delivery_date, o.booking_time]);
  const arrangeLoads = () => loadsHand || loads.map((L) => ({ ...L, auto: undefined, uid: key() }));
  const setLoad = (uid, ch) => { if (!loadsHand) { const L = loads.find((x) => x.uid === uid); if (L && L.auto) { setLoadInfo((I) => ({ ...I, [L.auto]: { ...(I[L.auto] || {}), ...ch } })); return; } }
    setLoadsHand((Ls) => (Ls || arrangeLoads()).map((L) => (L.uid === uid ? { ...L, ...ch } : L))); };
  const setAns = (uid, ch) => { const L = loads.find((x) => x.uid === uid); setLoad(uid, { answers: { ...(L?.answers || {}), ...ch } }); };
  const setLoadQty = (uid, k, v) => setLoadsHand((Ls) => (Ls || arrangeLoads().map((L, i) => ({ ...L, uid: loads[i].uid }))).map((L) => (L.uid === uid ? { ...L, items: { ...L.items, [k]: v } } : L)));
  const addLoad = () => setLoadsHand((Ls) => { const base = Ls || loads.map((L) => ({ ...L, auto: undefined })); return [...base, blankLoad(base.length + 1, headLoad)]; });
  const removeLoad = (uid) => setLoadsHand((Ls) => (Ls || loads.map((L) => ({ ...L, auto: undefined }))).filter((L) => L.uid !== uid).map((L, i) => ({ ...L, n: i + 1 })));
  const moveToLoad = (k, from, to) => setLoadsHand((Ls) => { const base = Ls || loads.map((L) => ({ ...L, auto: undefined })); const q0 = qtyIn(base.find((L) => L.uid === from)?.items, k);
    return base.map((L) => (L.uid === from ? { ...L, items: { ...L.items, [k]: 0 } } : L.uid === to ? { ...L, items: { ...L.items, [k]: qtyIn(L.items, k) + q0 } } : L)); });

  /* ---------- the POs: by themselves one per supplier (Admin › Suppliers), else as arranged ---------- */
  const pos = useMemo(() => {
    if (posHand) return posHand.map((P) => ({ ...P, items: Object.fromEntries(Object.entries(P.items).filter(([k]) => lines.some((l) => l.key === k))) }));
    const out = [];
    lines.forEach((l) => { const rt = routeOf(l.category); if (!rt) return;
      let P = out.find((x) => x.supplier_id === rt.supplier_id && x.portal === (rt.portal || ''));
      if (!P) { P = { uid: 'auto-' + rt.supplier_id + '-' + rt.portal, supplier_id: rt.supplier_id, supplier: rt.supplier?.name || '', portal: rt.portal || '', deliverTo: 'site', notes: '', items: {} }; out.push(P); }
      P.items[l.key] = l.qty; });
    return out;
  }, [posHand, lines, routes]);
  const arrangePos = () => posHand || pos.map((P) => ({ ...P, uid: key() }));
  const editPos = (fn) => setPosHand((Ps) => fn(Ps || pos.map((P) => ({ ...P }))));
  const stockKeys = lines.filter((l) => !pos.some((P) => qtyIn(P.items, l.key) > 0)).map((l) => l.key);

  /* customer search */
  useEffect(() => { const t = cq.trim(); if (t.length < 2 || o.customer) { setCHits([]); return; }
    const h = setTimeout(async () => { const like = '%' + t.replace(/[%_]/g, '') + '%';
      const { data } = await supabase.from('customers').select('*').or(`name.ilike.${like},email.ilike.${like},phone.ilike.${like},mobile.ilike.${like}`).neq('xero_status', 'ARCHIVED').order('name').limit(10); setCHits(data || []); }, 200);
    return () => clearTimeout(h); }, [cq, o.customer]);
  const pickCustomer = async (c) => {
    /* their name starts blank; the email and phone come from the customer (both can be changed) */
    const ph0 = [c.mobile, c.phone].find((x) => x && isMobile(x) && String(x).replace(/\D/g, '')) || '', ph = digits8(ph0), mob = true;
    setO((x) => ({ ...x, customer: c, terms: c.terms || 'cod', price_list: c.price_list || 'builder', email: c.email || '', contact_phone: ph, mobile: mob, sms: mob ? x.sms : false }));
    setCq(''); setCHits([]);
    const { data } = await supabase.from('customer_notes').select('*').eq('customer_id', c.id).order('created_at', { ascending: false }); setNotes(data || []);
    setLines((ls) => ls.map((l) => { const p = products.find((x) => x.id === l.product_id); const np = priceFor(p, c.price_list); return { ...l, list: np, price: l.price === l.list ? np : l.price }; }));
  };

  /* Sync (Xero): the customers again, then this company's record */
  const syncXero = async () => { setSyncing(true); setMsg(null);
    const { error } = await supabase.functions.invoke('xero', { body: { action: 'sync_contacts' } });
    if (o.customer) { const { data } = await supabase.from('customers').select('*').eq('id', o.customer.id).maybeSingle(); if (data) setO((x) => ({ ...x, customer: data })); }
    setSyncing(false); setMsg(error ? { bad: true, text: 'Sync: ' + error.message } : { text: 'Customers synced from Xero.' }); };
  /* + New customer: made in Xero straight away, then picked (a name already in Xero is used, not doubled) */
  const [adding, setAdding] = useState(false);
  const addCustomer = async () => {
    setAdding(true); setMsg(null);
    const { data, error } = await supabase.functions.invoke('xero', { body: { action: 'create_contact', name: newCust.name, email: newCust.email, phone: newCust.phone } });
    let m = data?.error; if (error) { m = error.message; try { const b = await error.context.json(); m = b.error || m; } catch { /* as it is */ } }
    setAdding(false);
    if (m) { setMsg({ bad: true, text: 'Not added: ' + m }); return; }
    setNewCust(null); pickCustomer(data.customer);
    setMsg({ text: data.existed ? data.customer.name + ' was already in Xero: picked.' : data.customer.name + ' added to Xero and picked.' });
  };
  /* plans or drawings: kept with the order (private) */
  const uploadPlans = async (files) => {
    if (!files || !files.length) return; setUploading(true);
    const add = [];
    for (const f of files) { const path = 'plans/' + Date.now() + '-' + f.name.replace(/[^A-Za-z0-9._-]+/g, '_');
      const { error } = await supabase.storage.from('order-files').upload(path, f); if (error) { setMsg({ bad: true, text: f.name + ': ' + error.message }); continue; } add.push({ path, name: f.name }); }
    setO((x) => ({ ...x, plans: [...x.plans, ...add] })); setUploading(false);
  };
  const openPlan = async (f) => { const { data } = await supabase.storage.from('order-files').createSignedUrl(f.path, 300); if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener'); };

  /* products to pick from: items only (the form adds the charges itself) */
  const pickable = useMemo(() => products.filter((p) => p.in_xero && p.active && p.sub_category !== 'additional_charge' && !FORM_CHARGES.includes(String(p.code).toUpperCase())), [products]);
  const shown = useMemo(() => { const t = q.trim().toLowerCase();
    if (t.length >= 2) return pickable.filter((p) => (!cat || p.category === cat) && (p.code + ' ' + p.name).toLowerCase().includes(t)).slice(0, 30);
    if (cat) return pickable.filter((p) => p.category === cat).sort((a, b) => a.name.localeCompare(b.name));   /* a material picked: all of it */
    return []; }, [pickable, q, cat]);
  const catCount = (c) => pickable.filter((p) => p.category === c).length;
  const add = (p) => {
    const c = p.category || 'Others', k0 = key();
    setLines((ls) => { const ex = ls.find((l) => l.product_id === p.id); if (ex) return ls.map((l) => (l === ex ? { ...l, qty: Number(l.qty) + 1 } : l));
      const pr = priceFor(p); const nl = { key: k0, product_id: p.id, code: p.code, name: p.name, baseName: p.name, unit: p.unit || 'each', category: c, qty: 1, price: pr, list: pr, reason: '', eps: {}, cut: {}, desc: '' }; if (cutWidth(nl)) nl.qty = 0; return [...ls, nl]; });
    /* arranged loads and POs: a new product goes on the first load of its material (else the first), and its supplier's PO */
    if (loadsHand) setLoadsHand((Ls) => { if (!Ls.length) return [{ ...blankLoad(1), items: { [k0]: 1 } }]; const i = Math.max(0, Ls.findIndex((L) => Object.keys(L.items).some((k) => lines.find((l) => l.key === k)?.category === c)));
      return Ls.map((L, j) => (j === i ? { ...L, items: { ...L.items, [k0]: 1 } } : L)); });
    if (posHand) { const rt = routeOf(c); if (rt) setPosHand((Ps) => { const i = Ps.findIndex((P) => P.supplier_id === rt.supplier_id); if (i >= 0) return Ps.map((P, j) => (j === i ? { ...P, items: { ...P.items, [k0]: 1 } } : P));
      return [...Ps, { uid: key(), supplier_id: rt.supplier_id, supplier: rt.supplier?.name || '', portal: rt.portal || '', deliverTo: 'site', notes: '', items: { [k0]: 1 } }]; }); }
  };
  /* cost from Xero (the product's purchase price), and the profit on it */
  const prodById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const unitCost = (x) => Number((x.product_id ? prodById.get(x.product_id) : byCode.get(String(x.code || '').toLowerCase()))?.xero_cost_price || 0);
  const costOf = (x) => r2(unitCost(x) * (Number(x.qty) || 0));
  const pct = (profit, amount) => (amount > 0 ? Math.round((profit / amount) * 1000) / 10 : 0);
  const profitCells = (amount, cost, off) => { if (off) return <><td className="r no-cost">—</td><td className="r">—</td><td className="r">—</td></>; const pr = r2(amount - cost);
    return <><td className="r no-cost">{cost ? cash(cost) : <span className="no-nocost" title="No cost in Xero">—</span>}</td><td className={'r no-pf' + (pr < 0 ? ' neg' : '')}>{cash(pr)}</td><td className={'r no-pf' + (pr < 0 ? ' neg' : '')}>{pct(pr, amount)}%</td></>; };
  const setCut = (l, ch) => { const cut = { ...(l.cut || {}), ...ch }, q = cutBad(cut) ? 0 : cutSqm(cutWidth(l), Number(cut.mm), Number(cut.n));
    setLine(l.key, { cut, qty: q });
    if (loadsHand) setLoadsHand((Ls) => { const has = Ls.filter((L) => L.items[l.key] != null); if (has.length !== 1) return Ls; return Ls.map((L) => (L === has[0] ? { ...L, items: { ...L.items, [l.key]: q } } : L)); }); };
  const setEps = (l, ch) => setLine(l.key, { eps: { ...(l.eps || {}), ...ch } });
  const setLine = (k, ch) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...ch } : l)));
  const removeLine = (k) => setLines((ls) => ls.filter((x) => x.key !== k));

  /* ---------- the charges: per load (delivery, waffle pods, concrete) and the impact charge once ---------- */
  const loadCharges = useMemo(() => loads.map((L) => {
    const inLoad = lines.map((l) => ({ ...l, qty: qtyIn(L.items, l.key) })).filter((l) => l.qty > 0);
    const cats = [...new Set(inLoad.map((l) => l.category))];
    const ch = cats.flatMap((c) => chargesFor(c, inLoad, L, ctx).map((x) => ({ ...x, cat: c, key: c + ':' + x.key })))
      .map((x) => { const ov = over[L.uid + '|' + x.key] || {}; return { ...x, load: L.uid, list: x.price, price: ov.price ?? x.price, qty: ov.qty ?? x.qty, reason: ov.reason || '', off: !!ov.off }; });
    return { L, inLoad, cats, ch };
  }), [loads, lines, over, products, extraPrices, o.customer]);
  const impc = impcFor(lines);
  const allCharges = [...(impc ? [{ ...impc, load: '', list: impc.price, reason: '', off: false }] : []), ...loadCharges.flatMap((x) => x.ch)];
  const goods = r2(lines.reduce((s, l) => s + r2(l.qty * l.price), 0)), chSum = r2(allCharges.filter((x) => !x.off).reduce((s, x) => s + r2(x.qty * x.price), 0));
  const sub = r2(goods + chSum), gst = r2(sub * 0.1), total = r2(sub + gst);
  const owes = Number(o.customer?.xero_awaiting_payment || 0) + Number(o.customer?.xero_awaiting_approval || 0);
  const overLimit = o.customer && o.customer.credit_limit != null && owes + (o.kind === 'order' ? total : 0) > Number(o.customer.credit_limit);
  const setCharge = (x, ch) => { const k = x.load + '|' + x.key; setOver((O) => ({ ...O, [k]: { ...(O[k] || {}), ...ch } })); };

  /* ---------- what is still missing ---------- */
  const missing = useMemo(() => {
    if (!o.customer) return 'Choose the company.';
    if (!o.contact_name.trim()) return 'Enter their name.';
    if (String(o.contact_phone).replace(/\D/g, '').length !== 8) return 'Their phone: the 8 numbers after +61 4.';
    if (!o.site_street.trim() || !o.site_suburb.trim()) return 'Enter the site address (street, then suburb and postcode).';
    if (o.kind === 'order' && !o.delivery_date) return 'Choose the delivery date.';
    if (o.kind === 'order' && !o.booking_time) return 'Select a booking time.';
    if (o.sms === null) return 'SMS booking confirmation: Yes or No.';
    if (!lines.length) return 'Add at least one product.';
    const cm = lines.map(customMissing).find(Boolean); if (cm) return 'Build SO: ' + cm;
    const bad = lines.find((l) => Math.abs(l.price - l.list) >= 0.005 && l.reason.trim().length < 3) || allCharges.find((x) => !x.off && Math.abs(x.price - x.list) >= 0.005 && x.reason.trim().length < 3);
    if (bad) return 'Build SO: give the reason for the changed price of ' + bad.name + '.';
    for (const l of lines) { const onLoads = loads.reduce((s, L) => s + qtyIn(L.items, l.key), 0); if (Math.abs(onLoads - l.qty) > 1e-6) return 'Build Load: ' + l.name + ' has ' + onLoads + ' of ' + l.qty + ' on loads.'; }
    for (const L of loads) { if (!Object.values(L.items).some((v) => Number(v) > 0)) return 'Build Load: load ' + L.n + ' is empty: remove it.';
      if (L.fulfil === 'delivery' && !String(L.site || '').trim()) return 'Build Load: enter the site address of load ' + L.n + '.';
      if (o.kind === 'order' && !L.date) return 'Build Load: choose the day of load ' + L.n + '.'; }
    for (const L of loads) { const cs = new Set(lines.filter((l) => qtyIn(L.items, l.key) > 0).map((l) => l.category)), a = L.answers || {};
      if (cs.has('Wafflepods') && L.fulfil === 'delivery' && !a.location) return 'Waffle pods: choose the location (Build SO).';
      if (cs.has('Wafflepods') && L.fulfil === 'delivery' && (a.location === 'NSW' || a.location === 'ACT') && !(Number(a.hours) > 0)) return 'Waffle pods: enter the driving time.';
      if (cs.has('Wafflepods') && L.fulfil === 'delivery' && !String(a.gate || '').trim()) return 'Waffle pods: enter the gate code (or N/A).';
      if (cs.has('Concrete') && a.coloured === 'yes' && !String(a.colour || '').trim()) return 'Concrete: enter the colour.'; }
    const note = allCharges.find((x) => !x.off && x.note); if (note) return 'Build Load: ' + note.note + '.';
    for (const P of pos) if (!P.supplier_id) return 'Build PO: choose the supplier of each PO.';
    return '';
  }, [o, lines, loads, pos, allCharges]);

  /* ---------- the draft: saved as you go ---------- */
  const busyRef = useRef(false);
  const save = async () => {
    if (!o.customer && !lines.length) return o.id;
    if (busyRef.current) return o.id; busyRef.current = true;
    try {
      const head = { kind: o.kind, customer_id: o.customer?.id || null, customer_name: o.customer?.name || '', terms: o.terms || 'cod', price_list: o.price_list || 'builder', site_street: o.site_street, site_suburb: o.site_suburb, delivery_date: o.delivery_date || null, booking_time: o.booking_time, sms_confirm: o.sms, plans: o.plans,
        contact_name: o.contact_name, contact_phone: phoneOut(o), email: o.email, their_po: o.their_po, instructions: o.instructions, subtotal: sub, gst, total, updated_at: new Date().toISOString() };
      let id = o.id;
      if (!id) { const r = await supabase.from('orders').insert({ ...head, created_by: staff.email, created_by_name: staff.name || staff.email.split('@')[0] }).select('id').single(); if (r.error) throw r.error; id = r.data.id; setO((x) => ({ ...x, id })); }
      else { const r = await supabase.from('orders').update(head).eq('id', id).eq('status', 'draft'); if (r.error) throw r.error; }
      for (const t of ['order_pos', 'order_loads', 'order_lines']) { const r = await supabase.from(t).delete().eq('order_id', id); if (r.error) throw r.error; }
      /* the products, then the loads and what is on them (and their charges), then the POs */
      const pl = await supabase.from('order_lines').insert(lines.map((l, i) => ({ order_id: id, product_id: l.product_id, code: l.code, name: lineName(l), custom: { eps: l.eps || {}, cut: l.cut || {}, desc: l.desc || '', base: l.baseName || l.name }, unit: l.unit, qty: l.qty, price: l.price, list_price: l.list, price_reason: l.reason, from_stock: stockKeys.includes(l.key), sort: i }))).select('id');
      if (pl.error) throw pl.error;
      const lineId = Object.fromEntries(lines.map((l, i) => [l.key, pl.data[i].id]));
      if (impc) { const r = await supabase.from('order_lines').insert({ order_id: id, product_id: byCode.get('impc')?.id || null, code: 'IMPC', name: impc.name, unit: 'charge', qty: 1, price: impc.price, list_price: impc.price, is_charge: true, charge_key: 'impc', sort: 99 }); if (r.error) throw r.error; }
      for (const [i, x] of loadCharges.entries()) { const L = x.L;
        const ld = await supabase.from('order_loads').insert({ order_id: id, category: x.cats.join(', '), fulfil: L.fulfil, site_address: L.fulfil === 'delivery' ? L.site || '' : '', want_date: L.date || null, want_time: L.time || 'Any time', answers: { ...(x.cats.includes('Concrete') ? { pour: 'Pump', truck: 'Any Truck Size', spacing: '15min', message: 'Neat', tester: 'no', coloured: 'no' } : {}), ...(x.cats.includes('Wafflepods') ? { scrap: 'no', trailer: 'yes' } : {}), ...(L.answers || {}) }, status: o.customer?.on_hold ? 'on_hold' : 'pending', sort: i }).select('id').single();
        if (ld.error) throw ld.error;
        const its = x.inLoad.map((l) => ({ load_id: ld.data.id, line_id: lineId[l.key], qty: l.qty }));
        if (its.length) { const r = await supabase.from('order_load_items').insert(its); if (r.error) throw r.error; }
        const chs = x.ch.filter((c) => !c.off).map((c, j) => ({ order_id: id, load_id: ld.data.id, product_id: byCode.get(String(c.code).toLowerCase())?.id || null, code: c.code === 'DELIVERY' ? '' : c.code, name: c.name, unit: c.unit, qty: c.qty, price: c.price, list_price: c.list, price_reason: c.reason, is_charge: true, charge_key: c.key, sort: 100 + j }));
        if (chs.length) { const r = await supabase.from('order_lines').insert(chs); if (r.error) throw r.error; }
      }
      for (const [i, P] of pos.entries()) {
        const pr = await supabase.from('order_pos').insert({ order_id: id, supplier_id: P.supplier_id || null, supplier_name: P.supplier || '', portal: P.portal || '', deliver_to: P.deliverTo || 'site', notes: P.notes || '', sort: i }).select('id').single();
        if (pr.error) throw pr.error;
        const its = Object.entries(P.items).filter(([, v]) => Number(v) > 0 && true).map(([k, v]) => ({ po_id: pr.data.id, line_id: lineId[k], qty: Number(v) })).filter((x) => x.line_id);
        if (its.length) { const r = await supabase.from('order_po_items').insert(its); if (r.error) throw r.error; }
      }
      setSaved(new Date()); return id;
    } catch (e) { setMsg({ bad: true, text: 'Not saved: ' + (e.message || e) }); return o.id; }
    finally { busyRef.current = false; }
  };
  useEffect(() => { const t = setTimeout(save, 1500); return () => clearTimeout(t); }, [o,  lines, loadsHand, loadInfo, posHand, over]);

  const place = async () => {
    if (missing) { setMsg({ bad: true, text: 'Not ready: ' + missing }); return; }
    setBusy(true); setMsg(null);
    const id = await save();
    const { data, error } = await supabase.rpc('place_order', { p_id: id });
    setBusy(false);
    if (error) { setMsg({ bad: true, text: error.message }); return; }
    setDone({ number: data.number, kind: o.kind, total, customer: o.customer.name });
  };
  /* Unfinished forms: the drafts that have a company or a total; Continue DRAFT-n opens the last one (as before) */
  const [drafts, setDrafts] = useState([]);
  const [showDrafts, setShowDrafts] = useState(false);
  const loadDrafts = async () => { const { data } = await supabase.from('orders').select('id, customer_name, total, updated_at, created_by_name').eq('status', 'draft').or('customer_name.neq.,total.gt.0').order('updated_at', { ascending: false }).limit(40); setDrafts(data || []); };
  useEffect(() => { loadDrafts(); }, [saved]);
  const lastDraft = drafts.find((d) => d.id !== o.id);
  const openDraft = async (id) => {
    setShowDrafts(false); setMsg(null);
    const [od, ls, lds, lis, ps, pis] = await Promise.all([supabase.from('orders').select('*, customer:customers(*)').eq('id', id).single(), supabase.from('order_lines').select('*').eq('order_id', id).order('sort'),
      supabase.from('order_loads').select('*').eq('order_id', id).order('sort'), supabase.from('order_load_items').select('*, order_loads!inner(order_id)').eq('order_loads.order_id', id),
      supabase.from('order_pos').select('*').eq('order_id', id).order('sort'), supabase.from('order_po_items').select('*, order_pos!inner(order_id)').eq('order_pos.order_id', id)]);
    if (od.error) { setMsg({ bad: true, text: od.error.message }); return; }
    const d = od.data, prod = (ls.data || []).filter((l) => !l.is_charge), k = {};
    const L2 = prod.map((l) => { const kk = key(); k[l.id] = kk; const p = products.find((x) => x.id === l.product_id);
      const cu = l.custom || {}; return { key: kk, product_id: l.product_id, code: l.code, name: cu.base || l.name, baseName: cu.base || l.name, eps: cu.eps || {}, cut: cu.cut || {}, desc: cu.desc || '', unit: l.unit, category: p?.category || 'Others', qty: Number(l.qty), price: Number(l.price), list: Number(l.list_price ?? l.price), reason: l.price_reason || '' }; });
    const site = String(d.site_street || '') + (d.site_suburb ? ', ' + d.site_suburb : '');
    setO({ id: d.id, kind: d.kind, customer: d.customer, terms: d.terms, price_list: d.price_list, contact_name: d.contact_name, contact_phone: digits8(d.contact_phone), mobile: true,
      email: d.email, their_po: d.their_po, instructions: d.instructions, site_street: d.site_street, site_suburb: d.site_suburb, delivery_date: d.delivery_date || '', booking_time: d.booking_time || '', sms: d.sms_confirm, plans: d.plans || [] });
    setLines(L2);
    setLoadsHand((lds.data || []).map((L, i) => ({ uid: key(), n: i + 1, fulfil: L.fulfil, site: L.site_address || site, date: L.want_date || '', time: L.want_time || 'Any time', answers: L.answers || {},
      items: Object.fromEntries((lis.data || []).filter((x) => x.load_id === L.id && k[x.line_id]).map((x) => [k[x.line_id], Number(x.qty)])) })));
    setPosHand((ps.data || []).map((P) => ({ uid: key(), supplier_id: P.supplier_id, supplier: P.supplier_name, portal: P.portal, deliverTo: P.deliver_to, notes: P.notes,
      items: Object.fromEntries((pis.data || []).filter((x) => x.po_id === P.id && k[x.line_id]).map((x) => [k[x.line_id], Number(x.qty)])) })));
    setOver({}); setLoadInfo({}); setTab('so');
    if (d.customer_id) { const { data } = await supabase.from('customer_notes').select('*').eq('customer_id', d.customer_id).order('created_at', { ascending: false }); setNotes(data || []); }
    setMsg({ text: 'DRAFT-' + d.id + ' opened.' });
  };
  const dropDraft = async (id) => { if (!window.confirm('Delete DRAFT-' + id + '?')) return; await supabase.from('orders').delete().eq('id', id).eq('status', 'draft'); loadDrafts(); };
  const restart = () => { setO({ id: null, kind: 'order', customer: null, terms: 'cod', price_list: '', contact_name: '', contact_phone: '', mobile: true, email: '', their_po: '', instructions: '', site_street: '', site_suburb: '', delivery_date: '', booking_time: '', sms: null, plans: [] }); setLines([]); setLoadsHand(null); setLoadInfo({}); setPosHand(null); setOver({}); setNotes([]); setDone(null); setSaved(null); setMsg(null); setTab('so'); };

  if (done) return (
    <>
      <PageHeader title={done.kind === 'quote' ? 'QUOTE SAVED' : 'ORDER PLACED'} sub={done.number + ' · ' + done.customer + ' · ' + cash(done.total)} />
      <div className="no-done"><div className="no-card"><h2>{done.number}</h2><p>{done.kind === 'quote' ? 'The quote is saved.' : 'The order is placed: it is on Home under Pending, and its invoice is in the Xero queue (Admin › Not yet in Xero).'}</p>
        <div className="no-row"><button type="button" className="btn btn-red" onClick={restart}>New order</button><button type="button" className="btn" onClick={() => nav('/')}>Home</button></div></div></div>
    </>
  );

  /* the waffle pod and concrete questions (as the previous form asks them), in Build SO for the material and in Build
     Load for each load; asked once in Build SO they go on every load carrying that material */
  const questions = (cat, a, set) => (cat === 'Wafflepods'
    ? <div className="no-load no-qs"><b className="no-qt">Waffle pods</b>
                  <label className="no-f">Location <span className="req">*</span><select value={a.location || ''} onChange={(e) => set({ location: e.target.value })}><option value="">Choose…</option>{WP_LOCATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                  {(a.location === 'NSW' || a.location === 'ACT') && <label className="no-f">Driving time (hours, one way)<input inputMode="decimal" value={a.hours || ''} onChange={(e) => set({ hours: e.target.value })} /></label>}
                  <label className="no-f">Scrap pick-up<Seg value={a.scrap || 'no'} set={(v) => set({ scrap: v })} options={[['yes', 'Yes'], ['no', 'No']]} /></label>
                  <label className="no-f">Trailer access<Seg value={a.trailer || 'yes'} set={(v) => set({ trailer: v })} options={[['yes', 'Yes'], ['no', 'No']]} /></label>
                  <label className="no-f">Gate code<input value={a.gate || ''} onChange={(e) => set({ gate: e.target.value })} placeholder="Code, or N/A" /></label>
                </div>
    : <div className="no-load no-qs"><b className="no-qt">Concrete</b>
                  
                  <label className="no-f">Pour<select value={a.pour || 'Pump'} onChange={(e) => set({ pour: e.target.value })}>{['Pump', 'Line', 'Chute', 'Boom'].map((x) => <option key={x}>{x}</option>)}</select></label>
                  <label className="no-f">Truck<select value={a.truck || 'Any Truck Size'} onChange={(e) => set({ truck: e.target.value })}>{['Any Truck Size', '10-Wheeler Only', '8-Wheeler Only', '6-Wheeler Only', 'Mini Only'].map((x) => <option key={x}>{x}</option>)}</select></label>
                  <label className="no-f">Spacing<select value={a.spacing || '15min'} onChange={(e) => set({ spacing: e.target.value })}>{['10min', '15min', '20min', '25min', '30min', '45min', 'N/A'].map((x) => <option key={x}>{x}</option>)}</select></label>
                  <label className="no-f">Finish<select value={a.message || 'Neat'} onChange={(e) => set({ message: e.target.value })}>{['Message', 'Neat', 'Neat Plus'].map((x) => <option key={x}>{x}</option>)}</select></label>
                  <label className="no-f">Tester<Seg value={a.tester || 'no'} set={(v) => set({ tester: v })} options={[['yes', 'Yes'], ['no', 'No']]} /></label>
                  <label className="no-f">Coloured<Seg value={a.coloured || 'no'} set={(v) => set({ coloured: v })} options={[['yes', 'Yes'], ['no', 'No']]} /></label>
                  {a.coloured === 'yes' && <label className="no-f">Colour<input value={a.colour || ''} onChange={(e) => set({ colour: e.target.value })} /></label>}
                </div>);
  const catAnswers = (c) => (loads.find((L) => lines.some((l) => l.category === c && qtyIn(L.items, l.key) > 0)) || {}).answers || {};
  const setCatAns = (c, ch) => loads.filter((L) => lines.some((l) => l.category === c && qtyIn(L.items, l.key) > 0)).forEach((L) => setAns(L.uid, ch));
  const catDelivery = (c) => loads.some((L) => L.fulfil === 'delivery' && lines.some((l) => l.category === c && qtyIn(L.items, l.key) > 0));
  /* a function, not a component: the price box keeps its focus while typing */
  const chargeRow = (x) => { const changed = Math.abs(x.price - x.list) >= 0.005; return (
    <tr key={x.load + x.key} className={'no-chr' + (x.off ? ' off' : '')}><td>{x.name}{x.note && !x.off && <small className="no-warn">{x.note}</small>}</td><td>{x.qty}</td>
      <td className="r">{x.locked ? cash(x.price) : <><input className={'no-price' + (changed ? ' ch' : '')} value={x.price} disabled={x.off} inputMode="decimal" onChange={(e) => setCharge(x, { price: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })} aria-label={'Price of ' + x.name} />
        {changed && !x.off && <input className={'no-reason' + (x.reason.trim().length < 3 ? ' need' : '')} value={x.reason} onChange={(e) => setCharge(x, { reason: e.target.value })} placeholder="Reason for the price *" />}</>}</td>
      <td className="r"><b>{x.off ? '—' : cash(r2(x.qty * x.price))}</b></td>
      {profitCells(r2(x.qty * x.price), costOf(x), x.off)}
      <td className="r">{!x.locked && <button type="button" className="no-x" aria-label={(x.off ? 'Put back ' : 'Remove ') + x.name} onClick={() => setCharge(x, { off: !x.off })}>{x.off ? '↺' : '×'}</button>}</td></tr>); };
  const lineOf = (k) => lines.find((l) => l.key === k);
  const soCats = CATS.filter((c) => lines.some((l) => l.category === c));
  const tabs = [['so', '1', 'Build SO', 'What the customer buys · one invoice', lines.length ? lines.length + ' product' + (lines.length === 1 ? '' : 's') : 'empty'],
    ['po', '2', 'Build PO', 'What we order · one per supplier', pos.length + ' PO' + (pos.length === 1 ? '' : 's')], ['load', '3', 'Build Load', 'How it goes out · trucks and pick-ups', loads.length + ' load' + (loads.length === 1 ? '' : 's')]];

  return (
    <>

      <div className="no-wrap">
        <div className="no-top">
          <section className="no-card no-head" aria-label="Customer">
            <div className="no-bar"><h1>NEW ORDER{o.id ? <small> DRAFT-{o.id}{saved ? ' · saved ' + saved.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }) : ''}</small> : null}</h1>
              <span className="no-bar-r">
                {staff.role === 'admin' && <a href="/admin/products" target="_blank" rel="noreferrer">Price Book</a>}
                {lastDraft && <button type="button" onClick={() => openDraft(lastDraft.id)}>↻ Continue DRAFT-{lastDraft.id}</button>}
                {o.id && <button type="button" aria-label="New blank form" title="New blank form" onClick={() => restart()}>×</button>}
                <button type="button" onClick={() => setShowDrafts(!showDrafts)} aria-expanded={showDrafts}>Unfinished forms <i>{drafts.length}</i></button>
              </span>
              {showDrafts && <div className="no-drafts">{!drafts.length ? <p className="no-sub">No unfinished forms.</p> : drafts.map((d) => (
                <div key={d.id} className="no-dr"><button type="button" onClick={() => openDraft(d.id)}><b>DRAFT-{d.id}</b> {d.customer_name || 'No company yet'}<small>{cash(d.total)} · {d.created_by_name} · {new Date(d.updated_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</small></button><button type="button" className="no-x" aria-label={'Delete DRAFT-' + d.id} onClick={() => dropDraft(d.id)}>×</button></div>))}</div>}
            </div>
            <div className="no-hd">
              <div className="no-f no-c1">Company <span className="req">*</span>
                {!o.customer ? <div className="no-cwrap"><input value={cq} onChange={(e) => setCq(e.target.value)} placeholder="Type a company, name, phone or email…" aria-label="Company" autoFocus />
                  {cHits.length > 0 && <div className="no-pop">{cHits.map((c) => <button key={c.id} type="button" onClick={() => pickCustomer(c)}><b>{c.name}</b><small>{[c.email, c.mobile || c.phone].filter(Boolean).join(' · ')} · {c.terms === 'account' ? 'Account' : 'COD'}{c.on_hold ? ' · ON HOLD' : ''}</small></button>)}</div>}</div>
                  : <div className="no-cust"><b>{o.customer.name}</b><button type="button" className="link" onClick={() => { setO({ ...o, customer: null }); setNotes([]); }}>Change</button></div>}
                <div className="no-two"><button type="button" className="btn" disabled={syncing} onClick={syncXero}>{syncing ? 'Syncing…' : '↻ Sync (Xero)'}</button><button type="button" className="btn" onClick={() => setNewCust({ name: cq, email: '', phone: '' })}>+ New customer</button></div>
              </div>
              <div className="no-f">COD or ACC <span className="req">*</span><Seg value={o.terms} set={(v) => setO({ ...o, terms: v })} options={[['cod', 'COD'], ['account', 'ACC']]} /></div>
              <div className="no-f">Order or quote <span className="req">*</span><Seg value={o.kind} set={(v) => setO({ ...o, kind: v })} options={[['order', 'Order'], ['quote', 'Quote']]} /></div>
              <label className="no-f">Price list <span className="req">*</span><select value={o.price_list} onChange={(e) => { const pl = e.target.value; setO({ ...o, price_list: pl }); setLines((ls) => ls.map((l) => { const p = products.find((x) => x.id === l.product_id); const np = priceFor(p, pl); return { ...l, list: np, price: l.price === l.list ? np : l.price }; })); }}>
                <option value="">Choose a price list…</option><option value="builder">Builder</option><option value="installer">Installer</option><option value="online">Online</option>{priceLists.map((pl) => <option key={pl.id} value={'list:' + pl.id}>{pl.name}</option>)}</select></label>
              <div className="no-f">Their PO <i className="no-opt">(optional)</i><input value={o.their_po} onChange={(e) => setO({ ...o, their_po: e.target.value })} placeholder="PO / ref" aria-label="Their PO" />
                <label className="btn no-plans">{uploading ? 'Uploading…' : 'Plans or drawings' + (o.plans.length ? ' (' + o.plans.length + ')' : '')}<input type="file" multiple accept=".pdf,image/*,.dwg,.dxf" onChange={(e) => uploadPlans(e.target.files)} hidden /></label></div>

              <label className="no-f">Their name <span className="req">*</span><input value={o.contact_name} onChange={(e) => setO({ ...o, contact_name: e.target.value })} placeholder="Who is this order for?" /></label>
              <label className="no-f">Their phone <span className="req">*</span><span className="no-mob"><b>AU +61 4</b><input value={fmt8(o.contact_phone)} onChange={(e) => setO({ ...o, contact_phone: digits8(e.target.value), mobile: true })} inputMode="tel" placeholder="12 345 678" aria-label="Their mobile, after +61 4" /></span></label>
              <div className="no-f">Site address <span className="req">*</span><span className="no-two"><AddressInput value={o.site_street} onChange={(v) => setO((x) => ({ ...x, site_street: v }))} onPick={(r) => setO((x) => ({ ...x, site_street: r.street, site_suburb: r.suburb || x.site_suburb }))} placeholder="14 Banks Rd" ariaLabel="Street" /><input value={o.site_suburb} onChange={(e) => setO({ ...o, site_suburb: e.target.value })} placeholder="Penrith 2750" aria-label="Suburb and postcode" /></span></div>
              <label className="no-f">Email for the invoice<input type="email" value={o.email} onChange={(e) => setO({ ...o, email: e.target.value })} placeholder="Email for this order" /></label>
              <label className="no-f">Notes<input value={o.instructions} onChange={(e) => setO({ ...o, instructions: e.target.value })} placeholder="Special instructions…" /></label>

              <label className="no-f">Delivery date {o.kind === 'order' && <span className="req">*</span>}<input type="date" value={o.delivery_date} onChange={(e) => setO({ ...o, delivery_date: e.target.value })} /></label>
              <label className="no-f">Booking time {o.kind === 'order' && <span className="req">*</span>}<select value={o.booking_time} onChange={(e) => setO({ ...o, booking_time: e.target.value })}><option value="">Select a time</option>{TIMES.map((t) => <option key={t}>{t}</option>)}</select></label>
              {<div className={'no-f' + (o.sms === null ? ' no-need' : '')}>SMS booking confirmation <span className="req">*</span><Seg value={o.sms === null ? '' : o.sms ? 'yes' : 'no'} set={(v) => setO({ ...o, sms: v === 'yes' })} options={[['yes', 'Yes'], ['no', 'No']]} /></div>}
            </div>
            {o.customer && <div className="no-chips">
              <span className="no-chip" style={{ background: '#FEF3C7', color: '#92400E' }}>{o.customer.terms === 'account' ? 'Account customer' : 'COD customer'}</span>
              {o.customer.credit_limit != null && <span className="no-chip" style={{ background: '#F5F5F4', color: '#44403C' }}>Limit {cash(o.customer.credit_limit)}</span>}
              {owes > 0 && <span className="no-chip" style={{ background: '#FEE2E2', color: '#991B1B' }}>Owes {cash(owes)}</span>}
              {o.customer.on_hold && <span className="no-chip" style={{ background: '#DC2626', color: '#fff' }}>ON HOLD</span>}
              {!o.customer.in_xero && <span className="no-chip" style={{ background: '#E0E7FF', color: '#3730A3' }}>New: not in Xero yet</span>}
            </div>}
            {notes.map((n) => <div key={n.id} className="no-note">{n.text}<small>{n.by_name || n.by_email} · {new Date(n.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}</small></div>)}
            {o.plans.length > 0 && <div className="no-files">{o.plans.map((f) => <button key={f.path} type="button" className="no-file" onClick={() => openPlan(f)}>{f.name} ↗</button>)}</div>}
            {newCust && <div className="no-newc">
              <b>New customer</b><span className="no-sub">Made in Xero straight away (Direct Building Material), then picked for this order.</span>
              <div className="no-grid"><label className="no-f">Company or name <span className="req">*</span><input value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} autoFocus /></label>
                <label className="no-f">Email<input type="email" value={newCust.email} onChange={(e) => setNewCust({ ...newCust, email: e.target.value })} /></label>
                <label className="no-f">Phone<input value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} inputMode="tel" /></label></div>
              <div className="no-row"><button type="button" className="btn" onClick={() => setNewCust(null)}>Cancel</button><button type="button" className="btn btn-red" disabled={adding || newCust.name.trim().length < 2} onClick={addCustomer}>{adding ? 'Adding to Xero…' : 'Add to Xero'}</button></div>
            </div>}
          </section>
        </div>
      <div className="no">
        <div className="no-main">
          <div className="no-tabs" role="tablist">{tabs.map(([k, n, t, d, c]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={'no-tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}><i>{n}</i><span><b>{t}</b><small>{d}</small></span><em>{c}</em></button>))}</div>

          {tab === 'so' && <>
          <section className="no-card" aria-label="Products">
            <div className="no-ct">Products</div>
            <div className="no-cats">{CATS.filter((c) => catCount(c)).map((c) => <button key={c} type="button" className={'no-cat' + (cat === c ? ' on' : '')} style={{ '--c': COLOR[c] }} onClick={() => setCat(cat === c ? '' : c)}><i />{c}</button>)}</div>
            <input type="search" className="no-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={cat ? 'Search ' + cat + ' by name or code…' : 'Search a product by name or code…'} aria-label="Search a product" />
            {shown.length > 0 && <div className="no-res">{(() => {
              const row = (p) => { const rt = routeOf(p.category); return (
                <div key={p.id} className="no-ri"><div><b>{p.name}</b><small>{p.code} · {p.unit || 'each'}</small></div>
                  <span className="no-from">{rt ? rt.supplier?.name?.replace(' Pty Ltd', '') + ' · ' + (rt.portal || 'email') : 'Penrith stock'}</span>
                  <span className="no-p">{cash(priceFor(p))}</span><button type="button" className="btn btn-red" onClick={() => add(p)}>Add</button></div>); };
              /* concrete and waffle pods: in their groups, then the additional charges */
              const c0 = shown[0].category, gr = shown.every((p) => p.category === c0) ? groupsOf(c0) : null;
              if (!gr) return shown.map(row);
              return gr.names.map((gname) => { const ps = shown.filter((p) => gr.of(p) === gname).sort(gr.sort); return ps.length ? [<div key={'g-' + gname} className={'no-rg no-rg-' + c0.toLowerCase() + (gname === 'Additional charges' ? ' no-rg-x' : '')}>{gname} <small>{ps.length}</small></div>, ...ps.map(row)] : null; });
            })()}</div>}
            {q.trim().length >= 2 && !shown.length && <p className="no-sub">No product matches.</p>}
          </section>
          <section className="no-card" aria-label="On this order">
            <div className="no-ct">On this order</div>
            {!lines.length && <p className="no-sub">Nothing yet: pick a material or search, then press Add.</p>}
            {soCats.map((c) => { const ls = lines.filter((l) => l.category === c), chs = allCharges.filter((x) => x.cat === c), sum = r2(ls.reduce((s, l) => s + r2(l.qty * l.price), 0) + chs.filter((x) => !x.off).reduce((s, x) => s + r2(x.qty * x.price), 0)); return (
              <div key={c} className="no-grp">
                <div className="no-gh" style={{ background: HEAD[c] }}>{c} <small>{ls.length} product{ls.length === 1 ? '' : 's'} · {cash(sum)}</small>{(() => { const cs = r2(ls.reduce((t, l) => t + costOf(l), 0) + chs.filter((x) => !x.off).reduce((t, x) => t + costOf(x), 0)), pr = r2(sum - cs); return <span className="no-ghp">Profit {cash(pr)} · {pct(pr, sum)}%</span>; })()}</div>
                {c === 'Wafflepods' && catDelivery(c) && questions('Wafflepods', catAnswers(c), (ch) => setCatAns(c, ch))}
                {c === 'Concrete' && questions('Concrete', catAnswers(c), (ch) => setCatAns(c, ch))}
                <div className="no-tw"><table className="no-t">
                  <thead><tr><th>Product</th><th>Qty</th><th className="r">Unit ex GST</th><th className="r">Amount</th><th className="r">Cost</th><th className="r">Profit $</th><th className="r">Profit %</th><th /></tr></thead>
                  <tbody>
                    {ls.map((l) => { const changed = Math.abs(l.price - l.list) >= 0.005; return (
                      <tr key={l.key}><td><b>{lineName(l)}</b><small>{l.code} · {l.unit}</small>
                        {epsKind(l.code) && <span className="no-cus">{(epsKind(l.code) === 'sheet'
                          ? [['L', 'Length mm', 'e.g. 2500'], ['W', 'Width mm', 'e.g. 1200'], ['H', 'Height mm', 'e.g. 100']] : [['D', 'Diameter mm', 'e.g. 600'], ['H', 'Height mm', 'e.g. 100']]).map(([f, lab, ph]) =>
                          <label key={f}>{lab} <i className="req">*</i><input value={(l.eps || {})[f] || ''} inputMode="numeric" placeholder={ph} onChange={(e) => setEps(l, { [f]: e.target.value.replace(/[^0-9.]/g, '') })} /></label>)}
                          <label>Grade <i className="req">*</i><select value={(l.eps || {}).grade || ''} onChange={(e) => setEps(l, { grade: e.target.value })}><option value="">Select grade</option>{EPS_GRADES.map((g) => <option key={g}>{g}</option>)}</select></label></span>}
                        {cutWidth(l) > 0 && <span className="no-cus"><label>{isPanel(l) ? 'Panels' : 'Sheets'} <i className="req">*</i><input value={(l.cut || {}).n || ''} inputMode="numeric" placeholder="how many" onChange={(e) => setCut(l, { n: e.target.value.replace(/\D/g, '') })} /></label>
                          <label>Custom length (mm) <i className="req">*</i><input value={(l.cut || {}).mm || ''} inputMode="numeric" placeholder="e.g. 1520" onChange={(e) => setCut(l, { mm: e.target.value.replace(/\D/g, '') })} /></label>
                          <small className="no-cush">{cutBad(l.cut) ? 'Enter the number of ' + (isPanel(l) ? 'panels' : 'sheets') + ' and the length (300 to 12000 mm): the m² is worked out (' + (cutWidth(l) === 1 / 3 ? '⅓' : cutWidth(l)) + ' m wide).' : l.cut.n + ' × ' + l.cut.mm + ' mm × ' + (cutWidth(l) === 1 / 3 ? '⅓' : cutWidth(l)) + ' m = ' + cutSqm(cutWidth(l), Number(l.cut.mm), Number(l.cut.n)).toFixed(3) + ' m²'}</small></span>}
                        {isFree(l) && <textarea className="no-desc" rows={2} maxLength={1000} value={l.desc || ''} placeholder="Type the description for the customer *" onChange={(e) => setLine(l.key, { desc: e.target.value })} />}</td>
                        <td>{cutWidth(l) > 0 ? <span className="no-m2"><b>{Number(l.qty).toFixed(3)}</b> m²<small>from the length</small></span> : <span className="no-qty"><button type="button" aria-label="Less" onClick={() => setLine(l.key, { qty: Math.max(0, r2(l.qty - 1)) })}>−</button><input value={l.qty} inputMode="decimal" onChange={(e) => setLine(l.key, { qty: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })} aria-label={'Quantity of ' + l.name} /><button type="button" aria-label="More" onClick={() => setLine(l.key, { qty: r2(l.qty + 1) })}>+</button></span>}</td>
                        <td className="r"><input className={'no-price' + (changed ? ' ch' : '')} value={l.price} inputMode="decimal" onChange={(e) => setLine(l.key, { price: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })} aria-label={'Price of ' + l.name} />
                          {changed && <><small className="no-was">list {cash(l.list)} <button type="button" className="link" onClick={() => setLine(l.key, { price: l.list, reason: '' })}>↺</button></small><input className={'no-reason' + (l.reason.trim().length < 3 ? ' need' : '')} value={l.reason} onChange={(e) => setLine(l.key, { reason: e.target.value })} placeholder="Reason for the price *" /></>}</td>
                        <td className="r"><b>{cash(r2(l.qty * l.price))}</b></td>
                        {profitCells(r2(l.qty * l.price), costOf(l), false)}
                        <td className="r"><button type="button" className="no-x" aria-label={'Remove ' + l.name} onClick={() => removeLine(l.key)}>×</button></td></tr>); })}
                    {chs.length > 0 && <tr className="no-chh"><td colSpan="8">ADDITIONAL CHARGES <span>(from Build Load)</span></td></tr>}
                    {chs.map((x) => chargeRow(x))}
                  </tbody>
                </table></div>
              </div>); })}
          </section>
          </>}

          {tab === 'po' && <section className="no-card" aria-label="Build PO">
            <div className="no-ct">Build PO <small>{posHand ? 'arranged by hand' : 'one PO per supplier, by itself'}</small>{posHand && <button type="button" className="link no-auto" onClick={() => setPosHand(null)}>Back to automatic</button>}</div>
            {!lines.length && <p className="no-sub">Add products in Build SO first.</p>}
            {pos.map((P, i) => (
              <div key={P.uid} className="no-grp">
                <div className="no-gh" style={{ background: '#1E1A17' }}>PO {i + 1} <small>{P.supplier || 'No supplier yet'}{P.portal ? ' · ' + P.portal : ''}</small>{posHand && <button type="button" className="no-ghx" onClick={() => editPos((Ps) => Ps.filter((x) => x.uid !== P.uid))}>Remove PO</button>}</div>
                <div className="no-load">
                  <label className="no-f">Supplier<select value={P.supplier_id || ''} onChange={(e) => { const sp = suppliers.find((x) => String(x.id) === e.target.value); const rt = routes.find((r) => String(r.supplier_id) === e.target.value); editPos((Ps) => Ps.map((x, j) => (j === i ? { ...x, supplier_id: sp?.id || null, supplier: sp?.name || '', portal: rt?.portal || '' } : x))); }}><option value="">Choose…</option>{suppliers.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}</select></label>
                  <label className="no-f">Deliver to<Seg value={P.deliverTo} set={(v) => editPos((Ps) => Ps.map((x, j) => (j === i ? { ...x, deliverTo: v } : x)))} options={[['site', "Customer's site"], ['penrith', 'Penrith warehouse']]} /></label>
                  <label className="no-f no-grow">Note to the supplier<input value={P.notes} onChange={(e) => editPos((Ps) => Ps.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)))} placeholder="Optional" /></label>
                </div>
                <div className="no-tw"><table className="no-t"><thead><tr><th>Product</th><th>Sold</th><th>Order</th><th>Move to</th></tr></thead><tbody>
                  {Object.entries(P.items).filter(([, v]) => Number(v) > 0).map(([k, v]) => { const l = lineOf(k); if (!l) return null; return (
                    <tr key={k}><td><b>{lineName(l)}</b><small>{l.code}</small></td><td>{l.qty} {l.unit}</td>
                      <td><input className="no-price" value={v} inputMode="decimal" onChange={(e) => editPos((Ps) => Ps.map((x, j) => (j === i ? { ...x, items: { ...x.items, [k]: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 } } : x)))} aria-label={'Order quantity of ' + l.name} /></td>
                      <td><select className="no-move" value="" onChange={(e) => { const to = e.target.value; editPos((Ps) => Ps.map((x, j) => (j === i ? { ...x, items: { ...x.items, [k]: 0 } } : to !== 'stock' && x.uid === to ? { ...x, items: { ...x.items, [k]: qtyIn(x.items, k) + Number(v) } } : x))); }}>
                        <option value="">Move…</option>{pos.filter((x) => x.uid !== P.uid).map((x, j) => <option key={x.uid} value={x.uid}>PO {pos.indexOf(x) + 1} · {x.supplier || 'no supplier'}</option>)}<option value="stock">From Penrith stock (no PO)</option></select></td></tr>); })}
                </tbody></table></div>
              </div>))}
            {stockKeys.length > 0 && <div className="no-grp"><div className="no-gh" style={{ background: '#57534E' }}>From Penrith stock <small>no PO</small></div>
              <div className="no-tw"><table className="no-t"><tbody>{stockKeys.map((k) => { const l = lineOf(k); return (
                <tr key={k}><td><b>{lineName(l)}</b><small>{l.code}</small></td><td>{l.qty} {l.unit}</td>
                  <td><select className="no-move" value="" onChange={(e) => { const to = e.target.value; if (to === 'new') editPos((Ps) => [...Ps, { uid: key(), supplier_id: null, supplier: '', portal: '', deliverTo: 'site', notes: '', items: { [k]: l.qty } }]); else editPos((Ps) => Ps.map((x) => (x.uid === to ? { ...x, items: { ...x.items, [k]: l.qty } } : x))); }}>
                    <option value="">Put on a PO…</option>{pos.map((x, j) => <option key={x.uid} value={x.uid}>PO {j + 1} · {x.supplier || 'no supplier'}</option>)}<option value="new">A new PO</option></select></td></tr>); })}</tbody></table></div></div>}
            {lines.length > 0 && <button type="button" className="btn" onClick={() => editPos((Ps) => [...Ps, { uid: key(), supplier_id: null, supplier: '', portal: '', deliverTo: 'site', notes: '', items: {} }])}>+ Add a PO</button>}
          </section>}

          {tab === 'load' && <section className="no-card" aria-label="Build Load">
            <div className="no-ct">Build Load <small>{loadsHand ? 'arranged by hand' : 'one load per material, by itself'}</small>{loadsHand && <button type="button" className="link no-auto" onClick={() => setLoadsHand(null)}>Back to automatic</button>}</div>
            {!lines.length && <p className="no-sub">Add products in Build SO first.</p>}
            {loadCharges.map(({ L, inLoad, cats, ch }) => { const a = L.answers || {}; return (
              <div key={L.uid} className="no-grp">
                <div className="no-gh" style={{ background: cats.length === 1 ? HEAD[cats[0]] : '#1E1A17' }}>Load {L.n} <small>{cats.join(' · ') || 'empty'}</small>{loads.length > 1 && <button type="button" className="no-ghx" onClick={() => removeLoad(L.uid)}>Remove load</button>}</div>
                <div className="no-load">
                  <Seg value={L.fulfil} set={(v) => setLoad(L.uid, { fulfil: v })} options={[['delivery', 'Delivery'], ['pickup', 'Pick-up']]} />
                  {L.fulfil === 'delivery' && <label className="no-f no-grow">Site address <span className="req">*</span><AddressInput value={L.site || ''} onChange={(v) => setLoad(L.uid, { site: v })} onPick={(r) => setLoad(L.uid, { site: r.full })} placeholder="Street, suburb, postcode" ariaLabel={'Site address of load ' + L.n} /></label>}
                  <label className="no-f">{L.fulfil === 'delivery' ? 'Delivery date' : 'Pick-up date'}{o.kind === 'order' && <span className="req"> *</span>}<input type="date" value={L.date || ''} onChange={(e) => setLoad(L.uid, { date: e.target.value })} /></label>
                  <label className="no-f">Time<select value={L.time || 'Any time'} onChange={(e) => setLoad(L.uid, { time: e.target.value })}>{TIMES.map((t) => <option key={t}>{t}</option>)}</select></label>
                </div>
                {cats.includes('Wafflepods') && L.fulfil === 'delivery' && questions('Wafflepods', a, (ch) => setAns(L.uid, ch))}
                {cats.includes('Concrete') && questions('Concrete', a, (ch) => setAns(L.uid, ch))}
                <div className="no-tw"><table className="no-t"><thead><tr><th>On this load</th><th>Sold</th><th>On it</th><th>Move to</th></tr></thead><tbody>
                  {lines.filter((l) => qtyIn(L.items, l.key) > 0).map((l) => (
                    <tr key={l.key}><td><b>{lineName(l)}</b><small>{l.code}</small></td><td>{l.qty} {l.unit}</td>
                      <td><input className="no-price" value={qtyIn(L.items, l.key)} inputMode="decimal" onChange={(e) => setLoadQty(L.uid, l.key, Number(e.target.value.replace(/[^0-9.]/g, '')) || 0)} aria-label={'Quantity of ' + l.name + ' on load ' + L.n} /></td>
                      <td><select className="no-move" value="" onChange={(e) => e.target.value && moveToLoad(l.key, L.uid, e.target.value)}><option value="">Move…</option>{loads.filter((x) => x.uid !== L.uid).map((x) => <option key={x.uid} value={x.uid}>Load {x.n}</option>)}</select></td></tr>))}
                  {ch.length > 0 && <tr className="no-chh"><td colSpan="4">ADDITIONAL CHARGES FOR THIS LOAD</td></tr>}
                  {ch.map((x) => <tr key={x.key} className={'no-chr' + (x.off ? ' off' : '')}><td>{x.name}{x.note && !x.off && <small className="no-warn">{x.note}</small>}</td><td>{x.qty}</td><td colSpan="2">{x.off ? 'removed (Build SO)' : cash(r2(x.qty * x.price))}</td></tr>)}
                </tbody></table></div>
              </div>); })}
            {lines.filter((l) => Math.abs(loads.reduce((s, L) => s + qtyIn(L.items, l.key), 0) - l.qty) > 1e-6).map((l) => <p key={l.key} className="no-miss">{l.name}: {loads.reduce((s, L) => s + qtyIn(L.items, l.key), 0)} of {l.qty} on loads.</p>)}
            {lines.length > 0 && <button type="button" className="btn" onClick={addLoad}>+ Add a load</button>}
          </section>}
        </div>

        <aside className="no-side" aria-label="The order">
          <section className="no-card">
            <div className="no-ct">The {o.kind === 'quote' ? 'quote' : 'order'}</div>
            {o.customer ? <div className="no-sum-c"><b>{o.customer.name}</b> · {o.customer.terms === 'account' ? 'Account' : 'COD'}</div> : <p className="no-sub">No company yet.</p>}
            {loadCharges.map(({ L, cats, inLoad, ch }) => <div key={L.uid} className="no-sl"><span><i style={{ background: COLOR[cats[0]] || '#78716C' }} />Load {L.n} · {cats.join(', ')} · {L.fulfil === 'delivery' ? 'delivery' : 'pick-up'}{L.date ? ' ' + new Date(L.date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric' }) : ''}</span></div>)}
            {/* every line, by material: its items, then its additional charges */}
            {soCats.length > 0 && <div className="no-sumlist">{soCats.map((c) => { const ls = lines.filter((l) => l.category === c), chs = allCharges.filter((x) => x.cat === c && !x.off); return (
              <div key={c} className="no-sg">
                <div className="no-sgh" style={{ background: HEAD[c] }}>{c}<b>{cash(r2(ls.reduce((t, l) => t + r2(l.qty * l.price), 0) + chs.reduce((t, x) => t + r2(x.qty * x.price), 0)))}</b></div>
                <div className="no-ssh">Items</div>
                {ls.map((l) => <div key={l.key} className="no-si"><span>{lineName(l)}<small>{Number(l.qty)} {l.unit} × {cash(l.price)}</small></span><b>{cash(r2(l.qty * l.price))}</b></div>)}
                {chs.length > 0 && <><div className="no-ssh">Additional charges</div>
                  {chs.map((x) => <div key={x.load + x.key} className="no-si no-sic"><span>{x.name}<small>{Number(x.qty)} × {cash(x.price)}</small></span><b>{cash(r2(x.qty * x.price))}</b></div>)}</>}
              </div>); })}</div>}
            {pos.length > 0 && <div className="no-what">{pos.map((P, i) => 'PO ' + (i + 1) + ' to ' + (P.supplier || '…').replace(' Pty Ltd', '')).join(' · ')}{stockKeys.length ? ' · from Penrith stock' : ''}</div>}
            <div className="no-tot"><div className="no-sl"><span>Products</span><b>{cash(goods)}</b></div><div className="no-sl"><span>Additional charges</span><b>{cash(chSum)}</b></div><div className="no-sl"><span>GST</span><b>{cash(gst)}</b></div><div className="no-sl no-big"><span>Total</span><b>{cash(total)}</b></div></div>
            {(() => { const cs = r2(lines.reduce((t, l) => t + costOf(l), 0) + allCharges.filter((x) => !x.off).reduce((t, x) => t + costOf(x), 0)), pr = r2(sub - cs); return <div className="no-prof"><div className="no-sl"><span>Cost (Xero)</span><b>{cash(cs)}</b></div><div className={'no-sl' + (pr < 0 ? ' neg' : '')}><span>Profit</span><b>{cash(pr)} · {pct(pr, sub)}%</b></div></div>; })()}
            {o.customer?.on_hold && <div className="no-alert"><b>On hold:</b> this customer is on hold. Check before placing.</div>}
            {overLimit && <div className="no-alert"><b>Over the credit limit:</b> owes {cash(owes)} + this order {cash(total)} = {cash(owes + total)} (limit {cash(o.customer.credit_limit)}).</div>}
            {msg && <p className={msg.bad ? 'msg bad' : 'msg'} role="status">{msg.text}</p>}
            {missing && !msg && <p className="no-miss">{missing}</p>}
            <button type="button" className="btn btn-red btn-big" disabled={busy} onClick={place}>{busy ? 'Placing…' : o.kind === 'quote' ? 'Save quote' : 'Place order'}</button>
            <div className="no-row"><button type="button" className="btn" onClick={async () => { await save(); setMsg({ text: 'Draft saved.' }); }}>Save draft</button><button type="button" className="btn" onClick={() => { if (window.confirm('Clear the form? The draft stays saved.')) restart(); }}>Clear</button></div>
          </section>
        </aside>
      </div>
      </div>
    </>
  );
}
