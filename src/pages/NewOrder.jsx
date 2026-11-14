import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../auth/AuthProvider.jsx';
import PageHeader from '../components/PageHeader.jsx';
import AddressInput from '../components/AddressInput.jsx';
import { sendEmail, poEmailHtml, orderEmailHtml } from '../lib/emailjs.js';
import { chargesFor, impcFor, FORM_CHARGES, WP_LOCATIONS } from '../lib/charges.js';
import { groupsOf } from '../lib/groups.js';
import { locateSite } from '../lib/wpLocation.js';
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
  const { id: viewId } = useParams();
  const placedInfo = useLocation().state?.placed;
  const { staff } = useAuth();
  const nav = useNavigate();
  const [tab, setTab] = useState('so');
  const [products, setProducts] = useState([]);
  const [extraPrices, setExtraPrices] = useState({});
  const [routes, setRoutes] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [o, setO] = useState({ id: null, kind: 'order', customer: null, terms: 'cod', price_list: '', upload_xero: true, contact_name: '', contact_phone: '', mobile: true, email: '', their_po: '', instructions: '', site_street: '', site_suburb: '', delivery_date: '', booking_time: '', sms: null, plans: [] });
  const [lines, setLines] = useState([]);          /* { key, product_id, code, name, unit, category, qty, price, list, reason } */
  const [loadsHand, setLoadsHand] = useState(null); /* null: one load per material by itself; else the loads as arranged */
  const [loadInfo, setLoadInfo] = useState({});    /* the automatic loads' day, site, questions, by material */
  const [posHand, setPosHand] = useState(null);
  const [posSend, setPosSend] = useState({});   /* Send Yes/No of the automatic POs */
  const [posFulfil, setPosFulfil] = useState({});   /* Delivery or pick-up of the automatic POs */
  const [preview, setPreview] = useState(null);     /* null: one PO per supplier by itself; else the POs as arranged */
  const [over, setOver] = useState({});            /* a charge typed over: { 'load|key': { price, qty, reason, off } } */
  const [notes, setNotes] = useState([]);
  const [priceLists, setPriceLists] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [newCust, setNewCust] = useState(null);
  const [orderNotes, setOrderNotes] = useState([]);
  const [soXero, setSoXero] = useState([]);
  const [folded, setFolded] = useState({});   /* materials minimised in Build SO */
  const [foldedPo, setFoldedPo] = useState({});   /* POs minimised in Build PO */
  const [cq, setCq] = useState(''); const [cHits, setCHits] = useState([]);
  const [cat, setCat] = useState(''); const [q, setQ] = useState(''); const [all, setAll] = useState(false);
  const [saved, setSaved] = useState(null); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(null); const [done, setDone] = useState(null);

  /* the products, prices, suppliers and price lists: loaded now, and again whenever they change in Admin (straight
     away through the database's live updates, and on coming back to this tab), so New Order follows Products (13 Nov 2026) */
  const loadRef = useRef(null);
  useEffect(() => { const loadAll = async () => {
    const ps = []; let f = 0;
    for (;;) { const { data } = await supabase.from('products').select('id, code, name, unit, category, sub_category, xero_sales_price, xero_cost_price, price_builder, price_installer, price_online, in_xero, active').range(f, f + 999); ps.push(...(data || [])); if (!data || data.length < 1000) break; f += 1000; }
    setProducts(ps);
    const ex = {}; f = 0;
    for (;;) { const { data } = await supabase.from('product_prices').select('product_id, list_id, price').range(f, f + 999); (data || []).forEach((r) => { (ex[r.product_id] = ex[r.product_id] || {})[r.list_id] = Number(r.price); }); if (!data || data.length < 1000) break; f += 1000; }
    setExtraPrices(ex);
    const rt = await supabase.from('supplier_routes').select('portal, categories, supplier_id, email_to, email_cc, supplier:suppliers(id, name, active)'); setRoutes(rt.data || []);
    const pls = await supabase.from('price_lists').select('id, name').order('sort'); setPriceLists(pls.data || []);
    const sp = await supabase.from('suppliers').select('id, name, active').eq('active', true).order('name'); setSuppliers(sp.data || []);
  };
  loadRef.current = loadAll; loadAll();
  let t = null; const soon = () => { clearTimeout(t); t = setTimeout(loadAll, 600); };
  const ch = supabase.channel('new-order-catalogue');
  ['products', 'product_prices', 'price_lists', 'suppliers', 'supplier_routes'].forEach((tb) => ch.on('postgres_changes', { event: '*', schema: 'public', table: tb }, soon));
  ch.subscribe();
  const vis = () => { if (document.visibilityState === 'visible') soon(); };
  document.addEventListener('visibilitychange', vis);
  return () => { clearTimeout(t); supabase.removeChannel(ch); document.removeEventListener('visibilitychange', vis); };
  }, []);

  /* the lines on the order follow their product: its category (so its material and charges), its unit, and its price
     list price (a price not typed over follows it; one typed over keeps its own, with its reason) */
  useEffect(() => {
    if (!products.length) return;
    setLines((ls) => { let changed = false; const out = ls.map((l) => { const p = products.find((x) => x.id === l.product_id); if (!p) return l;
      const np = priceFor(p), cat = p.category || 'Others', typed = Math.abs(l.price - l.list) >= 0.005;
      const nx = { ...l, category: cat, unit: p.unit || l.unit, list: np, price: typed ? l.price : np, baseName: l.baseName || p.name };
      if (nx.category !== l.category || nx.unit !== l.unit || nx.list !== l.list || nx.price !== l.price) { changed = true; return nx; } return l; });
      return changed ? out : ls; });
  }, [products, extraPrices]);

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
  const loads0 = useMemo(() => {
    if (loadsHand) return loadsHand.map((L) => ({ ...L, items: Object.fromEntries(Object.entries(L.items).filter(([k]) => lines.some((l) => l.key === k))) }));
    return CATS.filter((c) => lines.some((l) => l.category === c)).map((c, i) => ({ ...blankLoad(i + 1), ...headLoad, uid: 'auto-' + c, ...(loadInfo[c] || {}), auto: c, n: i + 1,
      items: Object.fromEntries(lines.filter((l) => l.category === c).map((l) => [l.key, l.qty])) }));
  }, [loadsHand, lines, loadInfo, headSite, o.delivery_date, o.booking_time]);
  /* a load with concrete is always a delivery to the site */
  const loads = useMemo(() => loads0.map((L) => (lines.some((l) => l.category === 'Concrete' && Number((L.items || {})[l.key] || 0) > 0) ? { ...L, fulfil: 'delivery', site: L.site || headSite } : L)), [loads0, lines, headSite]);
  const arrangeLoads = () => loadsHand || loads.map((L) => ({ ...L, auto: undefined, uid: key() }));
  const setLoad = (uid, ch) => { if (!loadsHand) { const L = loads.find((x) => x.uid === uid); if (L && L.auto) { setLoadInfo((I) => ({ ...I, [L.auto]: { ...(I[L.auto] || {}), ...ch } })); return; } }
    setLoadsHand((Ls) => (Ls || arrangeLoads()).map((L) => (L.uid === uid ? { ...L, ...ch } : L))); };
  const setAns = (uid, ch) => { const L = loads.find((x) => x.uid === uid); setLoad(uid, { answers: { ...(L?.answers || {}), ...ch } }); };
  const setLoadQty = (uid, k, v) => setLoadsHand((Ls) => (Ls || arrangeLoads().map((L, i) => ({ ...L, uid: loads[i].uid }))).map((L) => (L.uid === uid ? { ...L, items: { ...L.items, [k]: v } } : L)));
  /* a PO's own Delivery or pick-up (13 Nov 2026): what the supplier is told; the loads keep theirs */
  const lineOf = (k) => lines.find((l) => l.key === k);   /* early: the checks below use it while drawing */
  /* concrete is always delivered to the site: its PO and its loads ask no Delivery or pick-up, and no Deliver to */
  const isConcretePO = (P) => P.portal === 'OrderConcrete' || (Object.keys(P.items || {}).some((k) => Number(P.items[k]) > 0) && Object.keys(P.items).filter((k) => Number(P.items[k]) > 0).every((k) => lineOf(k)?.category === 'Concrete'));
  const poFulfil = (P) => (isConcretePO(P) ? 'delivery' : P.fulfil || posFulfil[P.uid] || 'delivery');
  const poDeliverTo = (P) => (isConcretePO(P) ? 'site' : P.deliverTo || 'site');
  const setPoFulfil = (P, v) => { if (posHand) editPos((Ps) => Ps.map((x) => (x.uid === P.uid ? { ...x, fulfil: v } : x))); else setPosFulfil((m) => ({ ...m, [P.uid]: v })); };
  const addLoad = () => setLoadsHand((Ls) => { const base = Ls || loads.map((L) => ({ ...L, auto: undefined })); return [...base, blankLoad(base.length + 1, headLoad)]; });
  const removeLoad = (uid) => setLoadsHand((Ls) => (Ls || loads.map((L) => ({ ...L, auto: undefined }))).filter((L) => L.uid !== uid).map((L, i) => ({ ...L, n: i + 1 })));
  const moveToLoad = (k, from, to) => setLoadsHand((Ls) => { const base = Ls || loads.map((L) => ({ ...L, auto: undefined })); const q0 = qtyIn(base.find((L) => L.uid === from)?.items, k);
    return base.map((L) => (L.uid === from ? { ...L, items: { ...L.items, [k]: 0 } } : L.uid === to ? { ...L, items: { ...L.items, [k]: qtyIn(L.items, k) + q0 } } : L)); });

  /* ---------- the POs: by themselves one per supplier (Admin › Suppliers), else as arranged ---------- */
  const pos = useMemo(() => {
    if (posHand) return posHand.map((P) => ({ ...P, items: Object.fromEntries(Object.entries(P.items).filter(([k]) => lines.some((l) => l.key === k))) }));
    const out = [];
    lines.forEach((l) => { const rt = routeOf(l.category); if (!rt) return;
      /* OrderSteel takes one material per order (Rediwall, Hebel, BlueDeck, reinforcement…): one PO per material there */
      const pc = (rt.portal || '') === 'OrderSteel' ? l.category : '', uid = 'auto-' + rt.supplier_id + '-' + rt.portal + (pc ? '-' + pc : '');
      let P = out.find((x) => x.uid === uid);
      if (!P) { P = { uid, supplier_id: rt.supplier_id, supplier: rt.supplier?.name || '', portal: rt.portal || '', cat: pc, deliverTo: 'site', notes: '', send: (posSend[uid] ?? null), fulfil: posFulfil[uid] || 'delivery', items: {} }; out.push(P); }
      P.items[l.key] = l.qty; });
    return out;
  }, [posHand, lines, routes, posSend, posFulfil]);
  const arrangePos = () => posHand || pos.map((P) => ({ ...P, uid: key() }));
  const editPos = (fn) => setPosHand((Ps) => fn(Ps || pos.map((P) => ({ ...P }))));
  const stockKeys = lines.filter((l) => !pos.some((P) => qtyIn(P.items, l.key) > 0)).map((l) => l.key);
  /* arranged POs stay right (13 Nov 2026): a product on a PO whose portal cannot take its material (OrderConcrete takes
     concrete, OrderPods waffle pods, OrderSteel the rest), or on no PO at all though its material has a supplier, goes
     onto its supplier's PO (made when missing). Products put on Penrith stock by hand stay there. */
  const [stockByHand, setStockByHand] = useState({});
  const poCat = (P) => P.cat || (lines.find((l) => Number(P.items[l.key] || 0) > 0) || {}).category || '';
  const portalTakes = (portal, cat) => (portal === 'OrderConcrete' ? cat === 'Concrete' : portal === 'OrderPods' ? cat === 'Wafflepods' : portal === 'OrderSteel' ? cat !== 'Concrete' && cat !== 'Wafflepods' : true);
  useEffect(() => {
    if (!posHand || !routes.length) return;
    let Ps = posHand.map((P) => ({ ...P, items: { ...P.items } })), changed = false;
    for (const l of lines) {
      const rt = routeOf(l.category); if (!rt) continue;
      const on = Ps.filter((P) => Number(P.items[l.key] || 0) > 0), wrong = on.filter((P) => !portalTakes(P.portal, l.category) || (P.portal === 'OrderSteel' && poCat(P, Ps) !== l.category));
      if ((on.length && !wrong.length) || (!on.length && stockByHand[l.key])) continue;
      const q = on.length ? wrong.reduce((t, P) => t + Number(P.items[l.key] || 0), 0) : Number(l.qty) || 0;
      wrong.forEach((P) => { P.items[l.key] = 0; });
      const pc = (rt.portal || '') === 'OrderSteel' ? l.category : '';
      let T = Ps.find((P) => String(P.supplier_id) === String(rt.supplier_id) && (P.portal || '') === (rt.portal || '') && (!pc || poCat(P, Ps) === pc));
      if (!T) { T = { uid: key(), supplier_id: rt.supplier_id, supplier: rt.supplier?.name || '', portal: rt.portal || '', cat: pc, deliverTo: 'site', notes: '', send: null, items: {} }; Ps.push(T); }
      T.items[l.key] = Number(T.items[l.key] || 0) + q; changed = true;
    }
    Ps = Ps.filter((P) => Object.values(P.items).some((v) => Number(v) > 0) || !P.supplier_id || P.portal === '' );
    if (changed) setPosHand(Ps);
  }, [posHand, lines, routes, stockByHand]);

  /* the PO email: the supplier's addresses (Admin › Suppliers), where and when the PO's products go, and its lines */
  const emailOf = (P) => { const r = routes.find((x) => String(x.supplier_id) === String(P.supplier_id) && (x.portal || '') === (P.portal || '')) || routes.find((x) => String(x.supplier_id) === String(P.supplier_id));
    return { to: (r?.email_to || []).join(','), cc: (r?.email_cc || []).join(',') }; };
  /* the form-added lines of a PO's materials on its loads (the impact charge once) */
  const poExtra = (P, ks) => { const cats = new Set(ks.map((k) => lineOf(k)?.category)), lds = new Set(loads.filter((x) => ks.some((k) => qtyIn(x.items, k) > 0)).map((x) => x.uid));
    const byLoad = new Map(loads.map((L) => [L.uid, L]));
    return allCharges.filter((x) => !x.off && cats.has(x.cat) && (x.load === '' || lds.has(x.load)) && !(isDelivery(x) && ((byLoad.get(x.load) || {}).answers || {}).delivered_by === 'internal')); };
  const poExtraMerged = (P, ks) => mergeCh(poExtra(P, ks));
  const poMail = (P, number, orderNo = '') => {
    const ks = Object.keys(P.items).filter((k) => Number(P.items[k]) > 0), L = loads.find((x) => ks.some((k) => qtyIn(x.items, k) > 0)) || {};
    const d = L.date ? new Date(L.date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
    return { subject: (number || 'PO') + (orderNo ? ' · ' + orderNo : '') + ' · Direct Building Material · ' + (o.customer?.name || '') + (d ? ' · ' + d : ''),
      html: poEmailHtml({ po: number, supplier: P.supplier, portal: P.portal, order: orderNo || 'number given on placing', customer: o.customer?.name, deliverTo: poDeliverTo(P), site: L.site || headSite, date: d, time: L.time,
        fulfil: poFulfil(P), contact: [o.contact_name, phoneOut(o)].filter(Boolean).join(' · '), note: P.notes,
        lines: [...ks.map((k) => { const l = lineOf(k); return { code: l.code, name: lineName(l), qty: Number(P.items[k]), unit: l.unit }; }),
          ...poExtraMerged(P, ks).filter((x) => x.asItem).map((x) => ({ code: x.code, name: x.name, qty: x.qty, unit: x.unit }))],
        /* the additional charges of its materials on its loads (the free bags with the lines), and their questions */
        charges: poExtraMerged(P, ks).filter((x) => !x.asItem).map((x) => ({ code: x.code, name: x.name, qty: x.qty, unit: x.unit === 'charge' ? '' : x.unit })),
        questions: (() => { const cats = new Set(ks.map((k) => lineOf(k)?.category)), a = L.answers || {}, yn = (v) => (v === 'yes' ? 'Yes' : v === 'no' ? 'No' : ''), out = [];
          if (cats.has('Concrete')) out.push({ title: 'Concrete', items: [['Pour', a.pour], ['Truck', a.truck], ['Spacing', a.spacing], ['Finish', a.message], ['Tester', yn(a.tester)], ['Coloured', yn(a.coloured)], ['Colour', a.coloured === 'yes' ? a.colour : '']] });
          if (cats.has('Wafflepods') && L.fulfil === 'delivery') out.push({ title: 'Waffle pods', items: [['Location', (WP_LOCATIONS.find((x) => x[0] === a.location) || [, a.location])[1]], ['Driving time', a.hours ? a.hours + ' hours one way' : ''], ['Scrap pick-up', yn(a.scrap)], ['Trailer access', yn(a.trailer)], ['Gate code', a.gate]] });
          return out; })() }) };
  };
  const setPoSend = (P, v) => { if (posHand) editPos((Ps) => Ps.map((x) => (x.uid === P.uid ? { ...x, send: v } : x))); else setPosSend((m) => ({ ...m, [P.uid]: v })); };

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
  const pickable = useMemo(() => products.filter((p) => p.in_xero && p.active && (p.sub_category !== 'additional_charge' || String(p.code).toUpperCase() === 'WPSB') && !FORM_CHARGES.includes(String(p.code).toUpperCase())), [products]);
  const shown = useMemo(() => { const t = q.trim().toLowerCase();
    if (t.length >= 2) return pickable.filter((p) => (!cat || p.category === cat) && (p.code + ' ' + p.name).toLowerCase().includes(t)).slice(0, 30);
    if (cat) return pickable.filter((p) => p.category === cat).sort((a, b) => a.name.localeCompare(b.name));   /* a material picked: all of it */
    return []; }, [pickable, q, cat]);
  const catCount = (c) => pickable.filter((p) => p.category === c).length;
  const add = (p) => {
    const c = p.category || 'Others', k0 = key();
    setLines((ls) => { const ex = ls.find((l) => l.product_id === p.id); if (ex) return ls.map((l) => (l === ex ? { ...l, qty: Number(l.qty) + 1 } : l));   /* extra WPSB bought: a line of its own, apart from the free ones */
      const pr = priceFor(p); const nl = { key: k0, product_id: p.id, code: p.code, name: p.name, baseName: p.name, unit: p.unit || 'each', category: c, qty: 1, price: pr, list: pr, reason: '', eps: {}, cut: {}, desc: '' }; if (cutWidth(nl)) nl.qty = 0; return [...ls, nl]; });
    /* arranged loads and POs: a new product goes on the first load of its material (else the first), and its supplier's PO */
    if (loadsHand) setLoadsHand((Ls) => { if (!Ls.length) return [{ ...blankLoad(1), items: { [k0]: 1 } }]; const i = Math.max(0, Ls.findIndex((L) => Object.keys(L.items).some((k) => lines.find((l) => l.key === k)?.category === c)));
      return Ls.map((L, j) => (j === i ? { ...L, items: { ...L.items, [k0]: 1 } } : L)); });
    if (posHand) { const rt = routeOf(c); if (rt) setPosHand((Ps) => { const pc = (rt.portal || '') === 'OrderSteel' ? c : '', i = Ps.findIndex((P) => P.supplier_id === rt.supplier_id && (P.portal || '') === (rt.portal || '') && (!pc || poCat(P) === pc));   /* its supplier, its portal and (OrderSteel) its material */ if (i >= 0) return Ps.map((P, j) => (j === i ? { ...P, items: { ...P.items, [k0]: 1 } } : P));
      return [...Ps, { uid: key(), supplier_id: rt.supplier_id, supplier: rt.supplier?.name || '', portal: rt.portal || '', cat: pc, deliverTo: 'site', notes: '', items: { [k0]: 1 } }]; }); }
  };
  /* cost from Xero (the product's purchase price), and the profit on it */
  const prodById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const unitCost = (x) => Number((x.product_id ? prodById.get(x.product_id) : byCode.get(String(x.code || '').toLowerCase()))?.xero_cost_price || 0);
  const costOf = (x) => (x.free ? 0 : r2(unitCost(x) * (Number(x.qty) || 0)));   /* the free scrap bags cost nothing */
  const pct = (profit, amount) => (amount > 0 ? Math.round((profit / amount) * 1000) / 10 : 0);
  const profitCells = (amount, cost, off) => { if (off) return <><td className="r no-cost">—</td><td className="r">—</td><td className="r">—</td></>; const pr = r2(amount - cost);
    return <><td className="r no-cost">{cost ? cash(cost) : <span className="no-nocost" title="No cost in Xero">—</span>}</td><td className={'r no-pf' + (pr < 0 ? ' neg' : '')}>{cash(pr)}</td><td className={'r no-pf' + (pr < 0 ? ' neg' : '')}>{pct(pr, amount)}%</td></>; };
  const setCut = (l, ch) => { const cut = { ...(l.cut || {}), ...ch }, q = cutBad(cut) ? 0 : cutSqm(cutWidth(l), Number(cut.mm), Number(cut.n));
    setLine(l.key, { cut, qty: q });
    if (loadsHand) setLoadsHand((Ls) => { const has = Ls.filter((L) => L.items[l.key] != null); if (has.length !== 1) return Ls; return Ls.map((L) => (L === has[0] ? { ...L, items: { ...L.items, [l.key]: q } } : L)); }); };
  const setEps = (l, ch) => setLine(l.key, { eps: { ...(l.eps || {}), ...ch } });
  /* a quantity changed in Build SO follows onto its load and its PO when it is on just one of each (arranged loads and
     POs, e.g. a reopened draft); split over several, the form asks for it to be shared out (13 Nov 2026) */
  const setLine = (k, ch) => {
    setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...ch } : l)));
    if (ch.qty == null) return;
    const q = Number(ch.qty) || 0;
    setLoadsHand((Ls) => { if (!Ls) return Ls; const has = Ls.filter((L) => Number(L.items[k] || 0) > 0 || L.items[k] === 0); if (has.length !== 1) return Ls; return Ls.map((L) => (L === has[0] ? { ...L, items: { ...L.items, [k]: q } } : L)); });
    setPosHand((Ps) => { if (!Ps) return Ps; const has = Ps.filter((P) => P.items[k] != null && Number(P.items[k]) > 0); if (has.length !== 1) return Ps; return Ps.map((P) => (P === has[0] ? { ...P, items: { ...P.items, [k]: q } } : P)); });
  };
  const removeLine = (k) => setLines((ls) => ls.filter((x) => x.key !== k));

  /* the answers a load works with (13 Nov 2026): its material's answers given on Build PO (from any load carrying that
     material), then its own; so a new load of waffle pods has its location, and its delivery is the same line */
  const QKEYS = { Wafflepods: ['location', 'hours', 'scrap', 'trailer', 'gate'], Concrete: ['pour', 'truck', 'spacing', 'message', 'tester', 'coloured', 'colour'] };
  const effAns = (L) => {
    const cats = new Set(lines.filter((l) => qtyIn(L.items, l.key) > 0).map((l) => l.category)), base = {};
    for (const c of cats) for (const f of QKEYS[c] || []) for (const M of loads) { const v = (M.answers || {})[f];
      if (v != null && String(v).trim() !== '' && lines.some((l) => l.category === c && qtyIn(M.items, l.key) > 0)) { base[f] = v; break; } }
    const own = Object.fromEntries(Object.entries(L.answers || {}).filter(([, v]) => v != null && String(v).trim() !== ''));
    return { ...base, ...own };
  };
  /* ---------- the charges: per load (delivery, waffle pods, concrete) and the impact charge once ---------- */
  const loadCharges = useMemo(() => loads.map((L) => {
    const inLoad = lines.map((l) => ({ ...l, qty: qtyIn(L.items, l.key) })).filter((l) => l.qty > 0);
    const cats = [...new Set(inLoad.map((l) => l.category))];
    const LA = { ...L, answers: effAns(L) };
    const ch = cats.flatMap((c) => chargesFor(c, inLoad, LA, ctx).map((x) => ({ ...x, cat: c, key: c + ':' + x.key })))
      /* a charge goes on only when its product is in the list (Admin › Products, active): Reinforcement's delivery is
         FR-CRANE/REO; its name is the product's (13 Nov 2026) */
      .map((x) => (x.code === 'DELIVERY' ? { ...x, code: 'FR-CRANE/REO', delivery: true } : x))   /* every material's delivery is FR-CRANE/REO (waffle pods WPDEL; concrete none) */
      .filter((x) => { const p = byCode.get(String(x.code).toLowerCase()); return p && p.active; })
      .map((x) => { const p = byCode.get(String(x.code).toLowerCase()); return { ...x, name: x.code === 'WPDEL' || x.code === 'WPSB' || x.delivery ? x.name : p.name || x.name, product_id: p.id, asItem: p.sub_category !== 'additional_charge' }; })
      .map((x) => { const ov = over[L.uid + '|' + x.key] || {}; return { ...x, load: L.uid, list: x.price, price: ov.price ?? x.price, qty: ov.qty ?? x.qty, reason: ov.reason || '', off: !!ov.off }; });
    return { L, inLoad, cats, ch };
  }), [loads, lines, over, products, extraPrices, o.customer]);
  useEffect(() => {
    const saved = savedCharges.current; if (!saved || !loadCharges.length) return; savedCharges.current = null;
    const off = {}; loadCharges.forEach((x) => x.ch.forEach((c) => { const kx = x.L.uid + '|' + c.key; if (!saved.has(kx)) off[kx] = { off: true }; }));
    if (Object.keys(off).length) setOver((O) => { const N = { ...O }; Object.entries(off).forEach(([kx, v]) => { N[kx] = { ...(N[kx] || {}), ...v }; }); return N; });
  }, [loadCharges]);
  const impc = byCode.get('impc')?.active ? impcFor(lines) : null;
  const allCharges = [...(impc ? [{ ...impc, load: '', list: impc.price, reason: '', off: false }] : []), ...loadCharges.flatMap((x) => x.ch)];
  /* the same charge on several loads (e.g. two Rediwall deliveries) is one line with its quantity added up (13 Nov 2026);
     a change to it (price, reason, remove) goes on each of its loads */
  const mergeCh = (list) => { const out = [];
    list.forEach((x) => { const k = x.cat + '|' + x.code + '|' + x.name + '|' + x.price + '|' + (x.off ? 1 : 0);
      const m = out.find((y) => y.mk === k); if (m) { m.qty = r2(m.qty + Number(x.qty)); m.parts.push(x); } else out.push({ ...x, mk: k, qty: Number(x.qty), parts: [x], load: 'm', key: k }); });
    return out; };
  const isDelivery = (x) => ['FR-CRANE/REO', 'WPDEL'].includes(String(x.code).toUpperCase());
  const goods = r2(lines.reduce((s, l) => s + r2(l.qty * l.price), 0)), chSum = r2(allCharges.filter((x) => !x.off).reduce((s, x) => s + r2(x.qty * x.price), 0));
  const sub = r2(goods + chSum), gst = r2(sub * 0.1), total = r2(sub + gst);
  const owes = Number(o.customer?.xero_awaiting_payment || 0) + Number(o.customer?.xero_awaiting_approval || 0);
  const overLimit = o.customer && o.customer.credit_limit != null && owes + (o.kind === 'order' ? total : 0) > Number(o.customer.credit_limit);
  const setCharge = (x, ch) => { const parts = x.parts || [x]; setOver((O) => { const N = { ...O }; parts.forEach((p) => { const k = p.load + '|' + p.key; N[k] = { ...(N[k] || {}), ...ch }; }); return N; }); };

  /* ---------- what is still missing ---------- */
  /* everything still to fill in, in order: Place order waits until the list is empty (13 Nov 2026) */
  const missingAll = useMemo(() => {
    const out = [], add = (t) => { if (!out.includes(t)) out.push(t); };
    if (!o.customer) add('Choose the company.');
    if (!o.price_list) add('Choose the price list.');
    if (!o.contact_name.trim()) add('Enter their name.');
    if (String(o.contact_phone).replace(/\D/g, '').length !== 8) add('Their phone: the 8 numbers after +61 4.');
    if (!o.site_street.trim() || !o.site_suburb.trim()) add('Enter the site address (street, then suburb and postcode).');
    if (o.kind === 'order' && !o.delivery_date) add('Choose the delivery date.');
    if (o.kind === 'order' && !o.booking_time) add('Select a booking time.');
    if (o.sms === null) add('SMS booking confirmation: Yes or No.');
    if (!lines.length) add('Add at least one product.');
    lines.map(customMissing).filter(Boolean).forEach((cm) => add('Build SO: ' + cm));
    [...lines.filter((l) => Math.abs(l.price - l.list) >= 0.005 && l.reason.trim().length < 3), ...allCharges.filter((x) => !x.off && Math.abs(x.price - x.list) >= 0.005 && x.reason.trim().length < 3)].forEach((x) => add('Build SO: give the reason for the changed price of ' + (x.baseName || x.name) + '.'));
    for (const l of lines) { const onLoads = loads.reduce((s, L) => s + qtyIn(L.items, l.key), 0); if (onLoads - l.qty > 1e-6) add('Build Load: ' + l.name + ' has ' + onLoads + ' on loads but only ' + l.qty + ' sold.'); }
    for (const L of loads) { if (!Object.values(L.items).some((v) => Number(v) > 0)) add('Build Load: load ' + L.n + ' is empty: remove it.');
      if (L.fulfil === 'delivery' && !String(L.site || '').trim()) add('Build Load: enter the site address of load ' + L.n + '.');
      if (o.kind === 'order' && !L.date) add('Build Load: choose the day of load ' + L.n + '.'); }
    for (const L of loads) { const cs = new Set(lines.filter((l) => qtyIn(L.items, l.key) > 0).map((l) => l.category)), a = effAns(L), no = (f) => a[f] == null || String(a[f]).trim() === '';
      if (cs.has('Wafflepods') && (L.fulfil === 'delivery' || pos.some((P) => poFulfil(P) === 'delivery' && Object.keys(P.items).some((k) => Number(P.items[k]) > 0 && qtyIn(L.items, k) > 0 && lineOf(k)?.category === 'Wafflepods')))) {
        if (no('location')) add('Build PO: waffle pods, choose the location.');
        if ((a.location === 'NSW' || a.location === 'ACT') && !(Number(a.hours) > 0)) add('Build PO: waffle pods, enter the driving time.');
        if (no('scrap')) add('Build PO: waffle pods, scrap pick-up Yes or No.');
        if (no('trailer')) add('Build PO: waffle pods, trailer access Yes or No.');
        if (no('gate')) add('Build PO: waffle pods, enter the gate code (or N/A).'); }
      if (cs.has('Concrete')) {
        for (const [f, t] of [['pour', 'the pour'], ['truck', 'the truck'], ['spacing', 'the spacing'], ['message', 'the finish']]) if (no(f)) add('Build PO: concrete, choose ' + t + '.');
        if (no('tester')) add('Build PO: concrete, tester Yes or No.');
        if (no('coloured')) add('Build PO: concrete, coloured Yes or No.');
        if (a.coloured === 'yes' && no('colour')) add('Build PO: concrete, enter the colour.'); } }
    for (const [i, P] of pos.entries()) { if (!P.supplier_id) add('Build PO: choose the supplier of PO ' + (i + 1) + '.');
      if (o.kind === 'order' && P.send == null) add('Build PO: choose Send Yes or No on PO ' + (i + 1) + ' (' + P.supplier + ').');
      if (P.send && !emailOf(P).to) add('Build PO: ' + P.supplier + ' has no email in Admin › Suppliers.'); }
    return out;
  }, [o, lines, loads, pos, allCharges]);
  const missing = missingAll[0] || '';
  const HEAD_IDS = [['go-company', /company/i], ['go-pricelist', /price list/i], ['go-name', /their name/i], ['go-phone', /phone/i], ['go-site', /^enter the site address/i], ['go-date', /delivery date/i], ['go-time', /booking time/i], ['go-sms', /sms/i]];
  const [tried, setTried] = useState(false);   /* after a first Place order, every missing box is outlined */
  const needCls = (id) => (tried && missingAll.some((t) => { const h = HEAD_IDS.find((x) => x[0] === id); return h && !/^Build/.test(t) && h[1].test(t); }) ? ' no-need' : '');

  /* ---------- the draft: saved as you go ---------- */
  const busyRef = useRef(false);
  const placedRef = useRef(false);
  const save = async (force) => {
    if (placedRef.current && !force) return o.id;   /* the order is placed: the draft is not saved over it */
    if (!o.customer && !lines.length) return o.id;
    if (busyRef.current) return o.id; busyRef.current = true;
    try {
      const head = { kind: o.kind, customer_id: o.customer?.id || null, customer_name: o.customer?.name || '', terms: o.terms || 'cod', price_list: o.price_list || 'builder', site_street: o.site_street, site_suburb: o.site_suburb, delivery_date: o.delivery_date || null, booking_time: o.booking_time, sms_confirm: o.sms, plans: o.plans, upload_xero: o.upload_xero !== false,
        contact_name: o.contact_name, contact_phone: phoneOut(o), email: o.email, their_po: o.their_po, instructions: o.instructions, subtotal: sub, gst, total, updated_at: new Date().toISOString() };
      let id = o.id;
      if (!id) { const r = await supabase.from('orders').insert({ ...head, created_by: staff.email, created_by_name: staff.name || staff.email.split('@')[0] }).select('id').single(); if (r.error) throw r.error; id = r.data.id; setO((x) => ({ ...x, id })); }
      else if (force && view) { const { kind, ...h } = head; void kind; const r = await supabase.from('orders').update(h).eq('id', id).select('id'); if (r.error) throw r.error; }   /* an edit of a placed order: its number and status stay */
      else { const r = await supabase.from('orders').update(head).eq('id', id).eq('status', 'draft').select('id'); if (r.error) throw r.error;
        /* placed (or no longer a draft): never touch it again from the form (13 Nov 2026) */
        if (!r.data?.length) { placedRef.current = true; return id; } }
      for (const t of ['order_pos', 'order_loads', 'order_lines']) { const r = await supabase.from(t).delete().eq('order_id', id); if (r.error) throw r.error; }
      /* the products, then the loads and what is on them (and their charges), then the POs */
      const pl = await supabase.from('order_lines').insert(lines.map((l, i) => ({ order_id: id, product_id: l.product_id, code: l.code, name: lineName(l), custom: { eps: l.eps || {}, cut: l.cut || {}, desc: l.desc || '', base: l.baseName || l.name }, unit: l.unit, qty: l.qty, price: l.price, list_price: l.list, price_reason: l.reason, from_stock: stockKeys.includes(l.key), sort: i }))).select('id');
      if (pl.error) throw pl.error;
      const lineId = Object.fromEntries(lines.map((l, i) => [l.key, pl.data[i].id]));
      const chId = {};
      if (impc) { const r = await supabase.from('order_lines').insert({ order_id: id, product_id: byCode.get('impc')?.id || null, code: 'IMPC', name: impc.name, unit: 'charge', qty: 1, price: impc.price, list_price: impc.price, is_charge: true, charge_key: 'impc', sort: 99 }).select('id').single(); if (r.error) throw r.error; chId['|impc'] = r.data.id; }
      for (const [i, x] of loadCharges.entries()) { const L = x.L;
        const ld = await supabase.from('order_loads').insert({ order_id: id, category: x.cats.join(', '), fulfil: L.fulfil, site_address: L.fulfil === 'delivery' ? L.site || '' : '', want_date: L.date || null, want_time: L.time || 'Any time', answers: effAns(L), status: L.status || (o.customer?.on_hold ? 'on_hold' : 'pending'), booked_date: L.booked_date || null, booked_time: L.booked_time || null, sort: i }).select('id').single();
        if (ld.error) throw ld.error;
        const its = x.inLoad.map((l) => ({ load_id: ld.data.id, line_id: lineId[l.key], qty: l.qty }));
        if (its.length) { const r = await supabase.from('order_load_items').insert(its); if (r.error) throw r.error; }
        const chs = x.ch.filter((c) => !c.off).map((c, j) => ({ order_id: id, load_id: ld.data.id, product_id: byCode.get(String(c.code).toLowerCase())?.id || null, code: c.code === 'DELIVERY' ? '' : c.code, name: c.name, unit: c.unit, qty: c.qty, price: c.price, list_price: c.list, price_reason: c.reason, is_charge: true, charge_key: c.key, sort: 100 + j }));
        if (chs.length) { const r = await supabase.from('order_lines').insert(chs).select('id, charge_key'); if (r.error) throw r.error; (r.data || []).forEach((row) => { chId[L.uid + '|' + row.charge_key] = row.id; }); }
      }
      for (const [i, P] of pos.entries()) {
        const pr = await supabase.from('order_pos').insert({ order_id: id, supplier_id: P.supplier_id || null, supplier_name: P.supplier || '', portal: P.portal || '', deliver_to: poDeliverTo(P), fulfil: poFulfil(P), notes: P.notes || '', send: P.send ?? null, sort: i, ...(view ? { number: P.number || null, status: P.status || 'to_send', supplier_ref: P.supplier_ref || null, portal_error: P.portal_error || null } : {}) }).select('id').single();
        if (pr.error) throw pr.error;
        const ks = Object.keys(P.items).filter((k) => Number(P.items[k]) > 0);
        const its = [...ks.map((k) => ({ po_id: pr.data.id, line_id: lineId[k], qty: Number(P.items[k]), unit_cost: unitCost(lineOf(k)) })),
          ...poExtra(P, ks).map((x) => ({ po_id: pr.data.id, line_id: chId[x.load + '|' + x.key], qty: Number(x.qty), unit_cost: x.free ? 0 : unitCost(x) }))].filter((x) => x.line_id);
        if (its.length) { const r = await supabase.from('order_po_items').insert(its); if (r.error) throw r.error; }
      }
      setSaved(new Date()); return id;
    } catch (e) { setMsg({ bad: true, text: 'Not saved: ' + (e.message || e) }); return o.id; }
    finally { busyRef.current = false; }
  };
  useEffect(() => { const t = setTimeout(save, 1500); return () => clearTimeout(t); }, [o, posSend, posFulfil,  lines, loadsHand, loadInfo, posHand, over]);

  const place = async () => {
    setTried(true);
    if (missingAll.length) { setMsg({ bad: true, text: 'Not placed: ' + missingAll.length + ' thing' + (missingAll.length === 1 ? '' : 's') + ' still to fill in (listed below).' }); goTo(missingAll[0]); return; }
    setBusy(true); setMsg(null);
    const id = await save();
    const { data, error } = await supabase.rpc('place_order', { p_id: id });
    if (!error) placedRef.current = true;   /* no more draft saving: it would write over the placed order */
    setBusy(false);
    if (error) { setMsg({ bad: true, text: error.message }); return; }
    /* the PO emails, with their numbers (EmailJS, from orders@) */
    const sent = [], failed = [];
    for (const x of (data.pos || []).filter((y) => y.send)) { const P = pos[x.sort]; if (!P) continue; const em = emailOf(P), m = poMail(P, x.number, data.number);
      try { await sendEmail({ to: em.to, cc: em.cc, subject: m.subject, html: m.html }); sent.push(x.number + ' to ' + P.supplier); await logEvent(id, 'po', x.number, x.number + ' emailed to ' + P.supplier + ' (' + em.to + ')'); }
      catch (e) { failed.push(x.number + ' to ' + P.supplier + ': ' + e.message); await logEvent(id, 'po', x.number, x.number + ' email to ' + P.supplier + ' failed: ' + e.message); } }
    /* each PO set to Yes goes into its supplier's portal (OrderConcrete, OrderPods, OrderSteel): Direct's items only */
    const portal = [];
    for (const x of (data.pos || []).filter((y) => y.send)) { const P = pos[x.sort]; if (!P || !P.portal) continue;
      const r = await supabase.functions.invoke('portal-po', { body: { action: 'send', order_id: x.id } });
      let b = r.data; if (r.error) { try { b = await r.error.context.json(); } catch { b = { error: r.error.message }; } }
      portal.push(b?.sent ? { ok: true, text: x.number + ' is in ' + P.portal + ' as ' + b.order_id } : { ok: false, text: x.number + ' not in ' + P.portal + ': ' + (b?.reason || b?.error || 'no answer') + (b?.problems?.length ? ' (' + b.problems.join('; ') + ')' : '') });
      if (!b?.sent) await logEvent(id, 'po', x.number, x.number + ' not sent to ' + P.portal + ': ' + (b?.reason || b?.error || 'no answer')); }
    /* Upload to Xero: the sales order and each PO, now (a failure stays in Admin › Not yet in Xero with its reason) */
    const xero = [];
    for (const qid of data.xero || []) {
      const r = await supabase.functions.invoke('xero', { body: { action: 'send_queue', id: qid } });
      let b = r.data; if (r.error) { try { b = await r.error.context.json(); } catch { b = { error: r.error.message }; } }
      const { data: row } = await supabase.from('xero_queue').select('kind, ref, party').eq('id', qid).maybeSingle();
      const what = (row?.kind === 'SO' ? 'Sales order ' : 'Purchase order ') + (row?.ref || '') + (row?.party ? ' (' + row.party + ')' : '');
      xero.push(b?.ok ? { ok: true, text: what + ' is in Xero.' } : { ok: false, text: what + ' not in Xero: ' + (b?.error || 'no answer') + '. It waits in Admin › Not yet in Xero.' }); }
    nav('/orders/' + id, { state: { placed: { number: data.number, kind: o.kind, sent, failed, portal, xero, upload: o.upload_xero !== false } } });
  };
  /* Unfinished forms: the drafts that have a company or a total; Continue DRAFT-n opens the last one (as before) */
  const [drafts, setDrafts] = useState([]);
  const [showDrafts, setShowDrafts] = useState(false);
  const loadDrafts = async () => { const { data } = await supabase.from('orders').select('id, customer_name, total, updated_at, created_by_name').eq('status', 'draft').or('customer_name.neq.,total.gt.0').order('updated_at', { ascending: false }).limit(40); setDrafts(data || []); };
  useEffect(() => { loadDrafts(); }, [saved]);
  const lastDraft = drafts.find((d) => d.id !== o.id);
  const savedCharges = useRef(null);
  const openDraft = async (id) => { placedRef.current = false;
    setShowDrafts(false); setMsg(null);
    const [od, ls, lds, lis, ps, pis] = await Promise.all([supabase.from('orders').select('*, customer:customers(*)').eq('id', id).single(), supabase.from('order_lines').select('*').eq('order_id', id).order('sort'),
      supabase.from('order_loads').select('*').eq('order_id', id).order('sort'), supabase.from('order_load_items').select('*, order_loads!inner(order_id)').eq('order_loads.order_id', id),
      supabase.from('order_pos').select('*').eq('order_id', id).order('sort'), supabase.from('order_po_items').select('*, order_pos!inner(order_id)').eq('order_pos.order_id', id)]);
    if (od.error) { setMsg({ bad: true, text: od.error.message }); return; }
    const d = od.data, prod = (ls.data || []).filter((l) => !l.is_charge), k = {};
    const L2 = prod.map((l) => { const kk = key(); k[l.id] = kk; const p = products.find((x) => x.id === l.product_id);
      const cu = l.custom || {}; return { key: kk, product_id: l.product_id, code: l.code, name: cu.base || l.name, baseName: cu.base || l.name, eps: cu.eps || {}, cut: cu.cut || {}, desc: cu.desc || '', unit: l.unit, category: p?.category || 'Others', qty: Number(l.qty), price: Number(l.price), list: Number(l.list_price ?? l.price), reason: l.price_reason || '' }; });
    const site = String(d.site_street || '') + (d.site_suburb ? ', ' + d.site_suburb : '');
    setO({ id: d.id, status: d.status, number: d.number, placed_at: d.placed_at, created_by_name: d.created_by_name, total_saved: d.total, kind: d.kind, customer: d.customer, terms: d.terms, price_list: d.price_list, contact_name: d.contact_name, contact_phone: digits8(d.contact_phone), mobile: true,
      email: d.email, upload_xero: d.upload_xero !== false, their_po: d.their_po, instructions: d.instructions, site_street: d.site_street, site_suburb: d.site_suburb, delivery_date: d.delivery_date || '', booking_time: d.booking_time || '', sms: d.sms_confirm, plans: d.plans || [] });
    setLines(L2);
    const luid = {};
    setLoadsHand((lds.data || []).map((L, i) => ({ uid: (luid[L.id] = key()), dbId: L.id, status: L.status, booked_date: L.booked_date, booked_time: L.booked_time, n: i + 1, fulfil: L.fulfil, site: L.site_address || site, date: L.want_date || '', time: L.want_time || 'Any time', answers: L.answers || {},
      items: Object.fromEntries((lis.data || []).filter((x) => x.load_id === L.id && k[x.line_id]).map((x) => [k[x.line_id], Number(x.qty)])) })));
    setPosHand((ps.data || []).map((P) => ({ uid: key(), dbId: P.id, number: P.number, status: P.status, supplier_ref: P.supplier_ref, portal_error: P.portal_error, supplier_id: P.supplier_id, supplier: P.supplier_name, portal: P.portal, cat: '', deliverTo: P.deliver_to, fulfil: P.fulfil || 'delivery', notes: P.notes, send: P.send,
      items: Object.fromEntries((pis.data || []).filter((x) => x.po_id === P.id && k[x.line_id]).map((x) => [k[x.line_id], Number(x.qty)])) })));
    /* the charges as saved: their typed prices and reasons; one not saved was removed (13 Nov 2026) */
    const ov = {}, saved = new Set();
    (ls.data || []).filter((l) => l.is_charge && l.load_id && luid[l.load_id]).forEach((l) => { const kx = luid[l.load_id] + '|' + l.charge_key; saved.add(kx);
      if (Number(l.list_price ?? l.price) !== Number(l.price) || l.price_reason) ov[kx] = { price: Number(l.price), reason: l.price_reason || '' }; });
    savedCharges.current = (ls.data || []).some((l) => l.is_charge && l.load_id) ? saved : null;
    setOver(ov); setLoadInfo({}); setTab('so');
    if (d.customer_id) { const { data } = await supabase.from('customer_notes').select('*').eq('customer_id', d.customer_id).order('created_at', { ascending: false }); setNotes(data || []); }
    setMsg(d.status === 'draft' ? { text: 'DRAFT-' + d.id + ' opened.' } : null);
    if (d.status !== 'draft') placedRef.current = true;   /* a placed order is shown, never saved over */
    const xq = d.number ? await supabase.from('xero_queue').select('id, action, status, last_error, xero_id, sent_at').eq('ref', 'INV-' + String(d.number).replace(/\D/g, '')).order('id', { ascending: false }) : { data: [] };
    setSoXero(xq.data || []);
    const nt = await supabase.from('order_events').select('*').eq('order_id', d.id).order('at', { ascending: false }).order('id', { ascending: false }); setOrderNotes(nt.data || []);
  };
  const dropDraft = async (id) => { if (!window.confirm('Delete DRAFT-' + id + '?')) return; await supabase.from('orders').delete().eq('id', id).eq('status', 'draft'); loadDrafts(); };
  useEffect(() => { if (viewId && products.length) openDraft(Number(viewId)); }, [viewId, products.length]);

  /* ---------- a placed order (13 Nov 2026): the same layout, read-only, with its actions ---------- */
  const view = !!o.status && o.status !== 'draft';
  const [act, setAct] = useState(null);   /* an action running */
  const [actMsg, setActMsg] = useState(null);
  const [bookAt, setBookAt] = useState({});   /* the day and time typed for booking a load */
  const [noteText, setNoteText] = useState('');
  const reopen = () => openDraft(o.id);
  const logEvent = async (oid, part, ref, text) => { await supabase.from('order_events').insert({ order_id: oid, part, ref: ref || '', text, by_email: staff.email, by_name: staff.name || staff.email.split('@')[0] }); };
  const [editPart, setEditPart] = useState(null);   /* 'order' while the whole order is being edited */
  const startEdit = () => run('edit', async () => { const { error } = await supabase.rpc('begin_edit', { p_id: o.id }); if (error) throw error; setEditPart('order'); }, null);
  const cancelEdit = async () => { setEditPart(null); await supabase.rpc('end_edit', { p_id: o.id, p_part: '', p_save: false }); reopen(); };
  const saveEdit = async () => {
    if (missingAll.length) { setActMsg({ bad: true, text: 'Not saved: ' + missingAll[0] }); goTo(missingAll[0]); return; }
    setAct('saveedit'); setActMsg(null);
    try {
      await save(true);
      const { data, error } = await supabase.rpc('end_edit', { p_id: o.id, p_part: editPart, p_save: true }); if (error) throw error;
      const res = [];
      for (const qid of data?.xero || []) { const r = await supabase.functions.invoke('xero', { body: { action: 'send_queue', id: qid } }); res.push(r.data?.ok ? 'ok' : 'failed'); }
      setEditPart(null);
      setActMsg({ text: 'Changes saved.' + (res.length ? ' Xero: ' + res.filter((x) => x === 'ok').length + ' of ' + res.length + ' updated' + (res.includes('failed') ? ' (the rest wait in Admin › Not yet in Xero).' : '.') : '') + (pos.some((P) => P.send) ? ' Resend the PO emails if the supplier needs the changes.' : '') });
    } catch (e) { setActMsg({ bad: true, text: 'Not saved: ' + (e.message || e) }); }
    setAct(null); reopen();
  };
  const run = async (name, fn, okText) => { setAct(name); setActMsg(null); try { await fn(); if (okText) setActMsg({ text: okText }); } catch (e) { setActMsg({ bad: true, text: e.message || String(e) }); } setAct(null); reopen(); };
  const bookLoad = (L) => run('book' + L.uid, async () => { const b = bookAt[L.uid] || {}, d = b.date || L.date, t = b.time || L.time || 'Any time';
    if (!d) throw new Error('Choose the day to book load ' + L.n + '.');
    const r = await supabase.from('order_loads').update({ status: 'booked', booked_date: d, booked_time: t }).eq('id', L.dbId); if (r.error) throw r.error; }, 'Load booked.');
  const loadStatus = (L, st) => run('st' + L.uid, async () => { const r = await supabase.from('order_loads').update(st === 'pending' ? { status: 'pending', booked_date: null, booked_time: null } : { status: st }).eq('id', L.dbId); if (r.error) throw r.error; },
    st === 'delivered' ? 'Load ' + L.n + ' marked delivered.' : 'Load ' + L.n + ' is pending again.');
  const resendPo = (P) => run('mail' + P.uid, async () => { const em = emailOf(P); if (!em.to) throw new Error(P.supplier + ' has no email in Admin › Suppliers.');
    const m = poMail(P, P.number, o.number); await sendEmail({ to: em.to, cc: em.cc, subject: m.subject, html: m.html }); await logEvent(o.id, 'po', P.number, P.number + ' emailed to ' + P.supplier + ' (' + em.to + ')'); }, 'PO email sent to ' + P.supplier + '.');
  const toPortal = (P) => run('portal' + P.uid, async () => { const r = await supabase.functions.invoke('portal-po', { body: { action: 'send', order_id: P.dbId } });
    let b = r.data; if (r.error) { try { b = await r.error.context.json(); } catch { b = { error: r.error.message }; } }
    if (!b?.sent) { const why = (b?.reason || b?.error || 'no answer') + (b?.problems?.length ? ' (' + b.problems.join('; ') + ')' : ''); if (!b?.order_id) await logEvent(o.id, 'po', P.number, P.number + ' not sent to ' + P.portal + ': ' + why); throw new Error('Not in ' + P.portal + ': ' + why); } }, P.number + ' sent to ' + P.portal + '.');
  const emailCustomer = () => run('cust', async () => { if (!o.email) throw new Error('No email for the invoice on this order.');
    const groups = soCats.map((c) => ({ title: c, lines: [...lines.filter((l) => l.category === c).map((l) => ({ name: lineName(l), qty: l.qty, price: l.price })), ...mergeCh(allCharges.filter((x) => x.cat === c && !x.off)).map((x) => ({ name: x.name, qty: x.qty, price: x.price }))] }));
    const lds = loads.map((L) => ({ what: 'Load ' + L.n + ' · ' + (L.fulfil === 'pickup' ? 'pick-up' : 'delivery'), when: (L.booked_date || L.date ? new Date((L.booked_date || L.date) + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }) : 'to be booked') + ' · ' + (L.booked_time || L.time || '') }));
    await sendEmail({ to: o.email, subject: 'Your order ' + o.number + ' · Direct Building Material', html: orderEmailHtml({ number: o.number, customer: o.customer?.name, contact: o.contact_name, site: headSite, loads: lds, groups, subtotal: sub, gst, total }) }); await logEvent(o.id, 'so', o.number, 'Order confirmation emailed to ' + o.email); }, 'Order confirmation emailed to ' + o.email + '.');
  const addOrderNote = () => run('note', async () => { const t = noteText.trim(); if (!t) return;
    const r = await supabase.from('order_notes').insert({ order_id: o.id, text: t, by_email: staff.email, by_name: staff.name || staff.email.split('@')[0] }); if (r.error) throw r.error; setNoteText(''); });
  const uploadSo = () => run('xero', async () => { const { data, error } = await supabase.rpc('upload_so', { p_id: o.id }); if (error) throw error;
    const r = await supabase.functions.invoke('xero', { body: { action: 'send_queue', id: data.id } });
    let b = r.data; if (r.error) { try { b = await r.error.context.json(); } catch { b = { error: r.error.message }; } }
    if (!b?.ok) throw new Error('Xero: ' + (b?.error || 'no answer') + ' (it waits in Admin › Not yet in Xero)'); }, 'INV-' + String(o.number || '').replace(/\D/g, '') + ' is in Xero.');
  const cancelOrder = () => { const why = window.prompt('Cancel ' + o.number + '? Type the reason (it is kept on the order):'); if (why == null) return;
    run('cancel', async () => { const { data, error } = await supabase.rpc('cancel_order', { p_id: o.id, p_reason: why }); if (error) throw error;
      for (const qid of data?.xero || []) await supabase.functions.invoke('xero', { body: { action: 'send_queue', id: qid } }); }, o.number + ' cancelled.'); };
  const restart = () => { placedRef.current = false; setO({ id: null, kind: 'order', customer: null, terms: 'cod', price_list: '', upload_xero: true, contact_name: '', contact_phone: '', mobile: true, email: '', their_po: '', instructions: '', site_street: '', site_suburb: '', delivery_date: '', booking_time: '', sms: null, plans: [] }); setLines([]); setLoadsHand(null); setLoadInfo({}); setPosHand(null); setOver({}); setNotes([]); setDone(null); setSaved(null); setMsg(null); setTab('so'); };


  /* the waffle pod location and driving time worked out from the site (as before), unless chosen by hand */
  const [wpNote, setWpNote] = useState('');
  const catAnswersRaw = (c) => (loads.find((M) => lines.some((l) => l.category === c && qtyIn(M.items, l.key) > 0)) || {}).answers || {};

  const wpLoad = loads.find((L) => lines.some((l) => l.category === 'Wafflepods' && qtyIn(L.items, l.key) > 0));
  const wpSite = String((wpLoad && wpLoad.site) || headSite || '').trim();
  const wpHand = (catAnswersRaw('Wafflepods') || {}).location_by === 'hand';
  const lastSite = useRef('');
  useEffect(() => {
    if (!lines.some((l) => l.category === 'Wafflepods') || wpSite.length < 8 || wpHand || wpSite === lastSite.current) return;
    const t = setTimeout(async () => { lastSite.current = wpSite; setWpNote('Finding the site on the map…');
      try { const r = await locateSite(wpSite); setWpNote(r.note || '');
        if (r.location) setCatAns('Wafflepods', { location: r.location, location_by: 'map', ...(r.hours ? { hours: r.hours } : {}) }); }
      catch (e) { setWpNote('The map is not available (' + (e.message || e) + '): choose the location.'); } }, 900);
    return () => clearTimeout(t);
  }, [wpSite, wpHand, lines.length]);

  /* the waffle pod and concrete questions (as the previous form asks them), in Build SO for the material and in Build
     Load for each load; asked once in Build SO they go on every load carrying that material */
  const questions = (cat, a, set) => {
    const need = (v) => (v == null || String(v).trim() === '' ? ' no-need' : '');
    const pick = (f, label, opts) => <label className={'no-f' + need(a[f])}>{label} <span className="req">*</span><select value={a[f] || ''} onChange={(e) => set({ [f]: e.target.value })}><option value="">Choose…</option>{opts.map((x) => (Array.isArray(x) ? <option key={x[0]} value={x[0]}>{x[1]}</option> : <option key={x}>{x}</option>))}</select></label>;
    const yn = (f, label) => <div className={'no-f' + need(a[f])}>{label} <span className="req">*</span><Seg value={a[f] || ''} set={(v) => set({ [f]: v })} options={[['yes', 'Yes'], ['no', 'No']]} /></div>;
    const text = (f, label, ph) => <label className={'no-f' + need(a[f])}>{label} <span className="req">*</span><input value={a[f] || ''} onChange={(e) => set({ [f]: e.target.value })} placeholder={ph} /></label>;
    if (cat === 'Wafflepods') return (
      <div className="no-load no-qs"><b className="no-qt">Waffle pods</b>
        <div className={'no-f' + need(a.location)}>Location <span className="req">*</span><select value={a.location || ''} onChange={(e) => set({ location: e.target.value, location_by: e.target.value ? 'hand' : '' })}><option value="">Choose…</option>{WP_LOCATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <small className="no-wpn">{wpNote || (a.location_by === 'map' ? 'Worked out from the site' : '')}{a.location_by === 'hand' && <> · <button type="button" className="link" onClick={() => { lastSite.current = ''; set({ location_by: '' }); }}>Work it out from the site</button></>}</small></div>
        {(a.location === 'NSW' || a.location === 'ACT') && text('hours', 'Driving time (hours, one way)', 'e.g. 2.5')}
        {yn('scrap', 'Scrap pick-up')}{yn('trailer', 'Trailer access')}
        <div className={'no-f' + need(a.gate)}>Gate code <span className="req">*</span><span className="no-gate"><input value={a.gate || ''} onChange={(e) => set({ gate: e.target.value })} placeholder="Code" /><button type="button" className={'btn' + (a.gate === 'N/A' ? ' on' : '')} onClick={() => set({ gate: 'N/A' })}>N/A</button></span></div>
      </div>);
    return (
      <div className="no-load no-qs"><b className="no-qt">Concrete</b>
        {pick('pour', 'Pour', ['Pump', 'Line', 'Chute', 'Boom'])}{pick('truck', 'Truck', ['Any Truck Size', '10-Wheeler Only', '8-Wheeler Only', '6-Wheeler Only', 'Mini Only'])}
        {pick('spacing', 'Spacing', ['10min', '15min', '20min', '25min', '30min', '45min', 'N/A'])}{pick('message', 'Finish', ['Message', 'Neat', 'Neat Plus'])}
        {yn('tester', 'Tester')}{yn('coloured', 'Coloured')}{a.coloured === 'yes' && text('colour', 'Colour', 'e.g. Charcoal')}
      </div>);
  };
  const catAnswers = (c) => { const L = loads.find((M) => lines.some((l) => l.category === c && qtyIn(M.items, l.key) > 0)); return L ? effAns(L) : {}; };
  const setCatAns = (c, ch) => loads.filter((L) => lines.some((l) => l.category === c && qtyIn(L.items, l.key) > 0)).forEach((L) => setAns(L.uid, ch));
  const catDelivery = (c) => loads.some((L) => L.fulfil === 'delivery' && lines.some((l) => l.category === c && qtyIn(L.items, l.key) > 0));
  /* who delivers a load (13 Nov 2026): when a further delivery appears for a material (a second load, or a pick-up turned
     delivery), the form asks: the supplier's delivery (it goes on the supplier's PO too) or Direct's own (internal: only
     on the customer's sales order). The first delivery of a material is the supplier's. */
  const askDelivery = (() => {
    const seen = new Set();
    for (const L of loads) {
      const cats = [...new Set(lines.filter((l) => qtyIn(L.items, l.key) > 0).map((l) => l.category))].filter((c) => c !== 'Concrete');
      if (L.fulfil !== 'delivery' || !cats.length) continue;
      const first = cats.some((c) => !seen.has(c)); cats.forEach((c) => seen.add(c));
      if ((L.answers || {}).delivered_by) continue;
      if (!first) return { L, cats };
    }
    return null; })();
  const answerDelivery = (L, by) => setAns(L.uid, { delivered_by: by });
  const deliveredBy = (L) => ((L.answers || {}).delivered_by === 'internal' ? 'internal' : 'supplier');

  /* a message leads to its place (13 Nov 2026): the tab, then the field, PO, load or line it names */
  const goTo = (raw) => {
    const t = String(raw || '').replace(/^Not ready:\s*/i, '').replace(/^Warning:\s*/i, '');
    let tab0 = null, id = null; const n = (re) => (re.exec(t) || [])[1];
    if (/^Build PO/i.test(t)) { tab0 = 'po';
      const k = n(/PO (\d+)/i), cat = /waffle/i.test(t) ? 'Wafflepods' : /concrete/i.test(t) ? 'Concrete' : null, sup = (/the supplier of PO (\d+)/i.exec(t) || [])[1];
      const idx = k || sup || (cat ? pos.findIndex((P) => Object.keys(P.items).some((key) => Number(P.items[key]) > 0 && lineOf(key)?.category === cat)) + 1 : 0) || 1;
      const P = pos[Number(idx) - 1]; if (P) setFoldedPo((f) => ({ ...f, [P.uid]: false })); id = 'go-po-' + idx; }
    else if (/^Build Load/i.test(t)) { tab0 = 'load'; id = n(/load (\d+)/i) ? 'go-load-' + n(/load (\d+)/i) : 'go-load-1'; }
    else if (/^Build SO/i.test(t) || /no price for/i.test(t)) { tab0 = 'so';
      const code = n(/no price for (\S+)/i); const l = lines.find((x) => t.includes(lineName(x)) || t.includes(x.baseName || x.name));
      id = code ? 'go-ch-' + code.replace(/[^A-Za-z0-9]/g, '') : l ? 'go-line-' + l.key : 'go-lines'; if (l) setFolded((f) => ({ ...f, [l.category]: false })); }
    else if (/company/i.test(t)) id = 'go-company';
    else if (/price list/i.test(t)) id = 'go-pricelist';
    else if (/their name/i.test(t)) id = 'go-name';
    else if (/phone/i.test(t)) id = 'go-phone';
    else if (/site address/i.test(t)) id = 'go-site';
    else if (/delivery date/i.test(t)) id = 'go-date';
    else if (/booking time/i.test(t)) id = 'go-time';
    else if (/sms/i.test(t)) id = 'go-sms';
    else if (/product/i.test(t)) { tab0 = 'so'; id = 'go-products'; }
    if (tab0) setTab(tab0);
    setTimeout(() => { const el = id && document.getElementById(id); if (!el) return; el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.remove('no-flash'); void el.offsetWidth; el.classList.add('no-flash'); const f = el.querySelector('input, select, textarea, button'); if (f && /^go-(company|name|phone|site|date|time)$/.test(id)) f.focus({ preventScroll: true }); }, 120);
  };

  /* a function, not a component: the price box keeps its focus while typing */
  const chargeRow = (x) => { const changed = Math.abs(x.price - x.list) >= 0.005; return (
    <tr key={x.load + x.key} id={'go-ch-' + String(x.code).replace(/[^A-Za-z0-9]/g, '')} className={(x.asItem ? 'no-autoi' : 'no-chr') + (x.off ? ' off' : '')}><td>{x.asItem ? <b>{x.name}</b> : x.name}<small className="no-code">{x.code}{x.asItem ? ' · added by itself' : ''}</small>{x.note && !x.off && <small className="no-warn">{x.note}</small>}</td><td>{x.qty}</td>
      <td className="r">{x.locked ? cash(x.price) : <><input className={'no-price' + (changed ? ' ch' : '')} value={x.price} disabled={x.off} inputMode="decimal" onChange={(e) => setCharge(x, { price: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })} aria-label={'Price of ' + x.name} />
        {changed && !x.off && <input className={'no-reason' + (x.reason.trim().length < 3 ? ' need' : '')} value={x.reason} onChange={(e) => setCharge(x, { reason: e.target.value })} placeholder="Reason for the price *" />}</>}</td>
      <td className="r"><b>{x.off ? '—' : cash(r2(x.qty * x.price))}</b></td>
      {profitCells(r2(x.qty * x.price), costOf(x), x.off)}
      <td className="r">{!x.locked && <button type="button" className="no-x" aria-label={(x.off ? 'Put back ' : 'Remove ') + x.name} onClick={() => setCharge(x, { off: !x.off })}>{x.off ? '↺' : '×'}</button>}</td></tr>); };
  const soCats = CATS.filter((c) => lines.some((l) => l.category === c));
  const tabs = [['so', '1', 'Build SO', 'What the customer buys · one invoice', lines.length ? lines.length + ' product' + (lines.length === 1 ? '' : 's') : 'empty'],
    ['po', '2', 'Build PO', 'What we order · one per supplier', pos.length + ' PO' + (pos.length === 1 ? '' : 's')], ['load', '3', 'Build Load', 'How it goes out · trucks and pick-ups', loads.length + ' load' + (loads.length === 1 ? '' : 's')]];
  /* a placed order: the parts by their names (no "Build"), each with its Edit button */
  if (view) { tabs[0][2] = 'Sales order'; tabs[0][3] = 'What the customer buys'; tabs[1][2] = 'Purchase orders'; tabs[1][3] = 'What Direct orders'; tabs[2][2] = 'Loads'; tabs[2][3] = 'How it goes out'; }

  /* the order's lines by material and its totals: the side of the form, or the sales order of a placed order */
  const orderListJsx = (<>
            {/* every line, by material: its items, then its additional charges */}
            {soCats.length > 0 && <div className="no-sumlist">{soCats.map((c) => { const ls = lines.filter((l) => l.category === c), chs = mergeCh(allCharges.filter((x) => x.cat === c && !x.off)); return (
              <div key={c} className="no-sg">
                <div className="no-sgh" style={{ background: HEAD[c] }}>{c}<b>{cash(r2(ls.reduce((t, l) => t + r2(l.qty * l.price), 0) + chs.reduce((t, x) => t + r2(x.qty * x.price), 0)))}</b></div>
                <div className="no-ssh">Items</div>
                {ls.map((l) => <div key={l.key} className="no-si"><span>{lineName(l)}<small>{l.code} · {Number(l.qty)} {l.unit} × {cash(l.price)}</small></span><b>{cash(r2(l.qty * l.price))}</b></div>)}
                {chs.filter((x) => x.asItem).map((x) => <div key={x.load + x.key} className="no-si"><span>{x.name}<small>{x.code} · {Number(x.qty)} × {cash(x.price)}</small></span><b>{cash(r2(x.qty * x.price))}</b></div>)}
                {chs.some((x) => !x.asItem) && <><div className="no-ssh">Additional charges</div>
                  {chs.filter((x) => !x.asItem).map((x) => <div key={x.load + x.key} className="no-si no-sic"><span>{x.name}<small>{x.code} · {Number(x.qty)} × {cash(x.price)}</small></span><b>{cash(r2(x.qty * x.price))}</b></div>)}</>}
              </div>); })}</div>}
            <div className="no-tot"><div className="no-sl"><span>Products</span><b>{cash(goods)}</b></div><div className="no-sl"><span>Additional charges</span><b>{cash(chSum)}</b></div><div className="no-sl"><span>GST</span><b>{cash(gst)}</b></div><div className="no-sl no-big"><span>Total</span><b>{cash(total)}</b></div></div>
            {(() => { const cs = r2(lines.reduce((t, l) => t + costOf(l), 0) + allCharges.filter((x) => !x.off).reduce((t, x) => t + costOf(x), 0)), pr = r2(sub - cs); return <div className="no-prof"><div className="no-sl"><span>Cost (Xero)</span><b>{cash(cs)}</b></div><div className={'no-sl' + (pr < 0 ? ' neg' : '')}><span>Profit</span><b>{cash(pr)} · {pct(pr, sub)}%</b></div></div>; })()}
  </>);

  return (
    <>

      <div className={'no-wrap' + (view && !editPart ? ' no-ro' : '')}>
        <div className="no-top">
          <section className="no-card no-head" aria-label="Customer">
            <div className="no-bar">{view ? <h1>{o.number}<span className={'no-ost no-ost-' + o.status}>{o.status === 'cancelled' ? 'CANCELLED' : o.kind === 'quote' ? 'QUOTE' : 'PLACED'}</span><small>{o.placed_at ? new Date(o.placed_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + (o.created_by_name ? ' by ' + o.created_by_name : '') : ''}</small></h1> : <h1>NEW ORDER{o.id ? <small> DRAFT-{o.id}{saved ? ' · saved ' + saved.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }) : ''}</small> : null}</h1>}
              {view ? <span className="no-bar-r">
                {o.status !== 'cancelled' && (editPart
                  ? <><button type="button" className="btn" disabled={act === 'saveedit'} onClick={cancelEdit}>Cancel</button><button type="button" className="btn btn-red" disabled={act === 'saveedit'} onClick={saveEdit}>{act === 'saveedit' ? 'Saving…' : 'Save changes'}</button></>
                  : <button type="button" className="btn btn-red" disabled={!!act} onClick={startEdit}>Edit order</button>)}
                <button type="button" onClick={() => nav('/orders/new')}>+ New order</button><button type="button" onClick={() => nav('/')}>Home</button></span> :
              <span className="no-bar-r">
                {staff.role === 'admin' && <a href="/admin/products" target="_blank" rel="noreferrer">Price Book</a>}
                {lastDraft && <button type="button" onClick={() => openDraft(lastDraft.id)}>↻ Continue DRAFT-{lastDraft.id}</button>}
                {o.id && <button type="button" aria-label="New blank form" title="New blank form" onClick={() => restart()}>×</button>}
                <button type="button" onClick={() => setShowDrafts(!showDrafts)} aria-expanded={showDrafts}>Unfinished forms <i>{drafts.length}</i></button>
              </span>}
              {showDrafts && <div className="no-drafts">{!drafts.length ? <p className="no-sub">No unfinished forms.</p> : drafts.map((d) => (
                <div key={d.id} className="no-dr"><button type="button" onClick={() => openDraft(d.id)}><b>DRAFT-{d.id}</b> {d.customer_name || 'No company yet'}<small>{cash(d.total)} · {d.created_by_name} · {new Date(d.updated_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</small></button><button type="button" className="no-x" aria-label={'Delete DRAFT-' + d.id} onClick={() => dropDraft(d.id)}>×</button></div>))}</div>}
            </div>
            {view && editPart && <div className="no-editbar on"><b>Editing the order</b><span>Save changes updates the order and its Xero upload; PO emails can then be resent. DBM's portals are not changed from here.</span>
              {missingAll.length > 0 && <div className="no-misslist">{missingAll.map((t) => <button type="button" key={t} className="no-miss no-go" onClick={() => goTo(t)}>{t} <i>→</i></button>)}</div>}</div>}
            {view && !editPart ? (() => {
              const dd = o.delivery_date ? new Date(o.delivery_date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '';
              const pl = /^list:(\d+)$/.exec(o.price_list || ''), plName = pl ? (priceLists.find((x) => String(x.id) === pl[1]) || {}).name || 'Special' : String(o.price_list || '').replace(/^./, (x) => x.toUpperCase());
              const item = (label, value, wide) => <div className={'no-sv' + (wide ? ' wide' : '')}><span>{label}</span><b>{value || <i>—</i>}</b></div>;
              return <div className="no-sumhd">
                {item('Company', o.customer?.name, true)}{item('COD or ACC', o.terms === 'account' ? 'Account' : 'COD')}{item('Order or quote', o.kind === 'quote' ? 'Quote' : 'Order')}
                {item('Their name', o.contact_name)}{item('Their phone', phoneOut(o))}{item('Price list', plName)}{item('Their PO', o.their_po)}
                {item('Site address', headSite, true)}{item('Delivery date', dd)}{item('Booking time', o.booking_time)}
                {item('Email for the invoice', o.email, true)}{item('SMS booking confirmation', o.sms == null ? '' : o.sms ? 'Yes' : 'No')}
                {o.instructions && item('Notes', o.instructions, true)}
                {(o.plans || []).length > 0 && <div className="no-sv wide"><span>Plans or drawings</span><b>{o.plans.map((f) => <button key={f.path} type="button" className="link" onClick={() => openPlan(f)}>{f.name} ↗</button>)}</b></div>}
              </div>; })() : <>
            <fieldset className="no-fs" disabled={view && !editPart}>
            <div className="no-hd">
              <div className={'no-f no-c1' + needCls('go-company')} id="go-company">Company <span className="req">*</span>
                {!o.customer ? <div className="no-cwrap"><input value={cq} onChange={(e) => setCq(e.target.value)} placeholder="Type a company, name, phone or email…" aria-label="Company" autoFocus />
                  {cHits.length > 0 && <div className="no-pop">{cHits.map((c) => <button key={c.id} type="button" onClick={() => pickCustomer(c)}><b>{c.name}</b><small>{[c.email, c.mobile || c.phone].filter(Boolean).join(' · ')} · {c.terms === 'account' ? 'Account' : 'COD'}{c.on_hold ? ' · ON HOLD' : ''}</small></button>)}</div>}</div>
                  : <div className="no-cust"><b>{o.customer.name}</b><button type="button" className="link" onClick={() => { setO({ ...o, customer: null }); setNotes([]); }}>Change</button></div>}
                <div className="no-two"><button type="button" className="btn" disabled={syncing} onClick={syncXero}>{syncing ? 'Syncing…' : '↻ Sync (Xero)'}</button><button type="button" className="btn" onClick={() => setNewCust({ name: cq, email: '', phone: '' })}>+ New customer</button></div>
              </div>
              <div className="no-f">COD or ACC <span className="req">*</span><Seg value={o.terms} set={(v) => setO({ ...o, terms: v })} options={[['cod', 'COD'], ['account', 'ACC']]} /></div>
              <div className="no-f">Order or quote <span className="req">*</span><Seg value={o.kind} set={(v) => setO({ ...o, kind: v })} options={[['order', 'Order'], ['quote', 'Quote']]} /></div>
              <label className={'no-f' + needCls('go-pricelist')} id="go-pricelist">Price list <span className="req">*</span><select value={o.price_list} onChange={(e) => { const pl = e.target.value; setO({ ...o, price_list: pl }); setLines((ls) => ls.map((l) => { const p = products.find((x) => x.id === l.product_id); const np = priceFor(p, pl); return { ...l, list: np, price: l.price === l.list ? np : l.price }; })); }}>
                <option value="">Choose a price list…</option><option value="builder">Builder</option><option value="installer">Installer</option><option value="online">Online</option>{priceLists.map((pl) => <option key={pl.id} value={'list:' + pl.id}>{pl.name}</option>)}</select></label>
              <div className="no-f">Their PO <i className="no-opt">(optional)</i><input value={o.their_po} onChange={(e) => setO({ ...o, their_po: e.target.value })} placeholder="PO / ref" aria-label="Their PO" />
                <label className="btn no-plans">{uploading ? 'Uploading…' : 'Plans or drawings' + (o.plans.length ? ' (' + o.plans.length + ')' : '')}<input type="file" multiple accept=".pdf,image/*,.dwg,.dxf" onChange={(e) => uploadPlans(e.target.files)} hidden /></label></div>

              <label className={'no-f' + needCls('go-name')} id="go-name">Their name <span className="req">*</span><input value={o.contact_name} onChange={(e) => setO({ ...o, contact_name: e.target.value })} placeholder="Who is this order for?" /></label>
              <label className={'no-f' + needCls('go-phone')} id="go-phone">Their phone <span className="req">*</span><span className="no-mob"><b>AU +61 4</b><input value={fmt8(o.contact_phone)} onChange={(e) => setO({ ...o, contact_phone: digits8(e.target.value), mobile: true })} inputMode="tel" placeholder="12 345 678" aria-label="Their mobile, after +61 4" /></span></label>
              <div className={'no-f' + needCls('go-site')} id="go-site">Site address <span className="req">*</span><span className="no-two"><AddressInput value={o.site_street} onChange={(v) => setO((x) => ({ ...x, site_street: v }))} onPick={(r) => setO((x) => ({ ...x, site_street: r.street, site_suburb: r.suburb || x.site_suburb }))} placeholder="14 Banks Rd" ariaLabel="Street" /><input value={o.site_suburb} onChange={(e) => setO({ ...o, site_suburb: e.target.value })} placeholder="Penrith 2750" aria-label="Suburb and postcode" /></span></div>
              <label className="no-f">Email for the invoice<input type="email" value={o.email} onChange={(e) => setO({ ...o, email: e.target.value })} placeholder="Email for this order" /></label>
              <label className="no-f">Notes<input value={o.instructions} onChange={(e) => setO({ ...o, instructions: e.target.value })} placeholder="Special instructions…" /></label>

              <label className={'no-f' + needCls('go-date')} id="go-date">Delivery date {o.kind === 'order' && <span className="req">*</span>}<input type="date" value={o.delivery_date} onChange={(e) => setO({ ...o, delivery_date: e.target.value })} /></label>
              <label className={'no-f' + needCls('go-time')} id="go-time">Booking time {o.kind === 'order' && <span className="req">*</span>}<select value={o.booking_time} onChange={(e) => setO({ ...o, booking_time: e.target.value })}><option value="">Select a time</option>{TIMES.map((t) => <option key={t}>{t}</option>)}</select></label>
              {<div id="go-sms" className={'no-f' + (o.sms === null ? ' no-need' : '')}>SMS booking confirmation <span className="req">*</span><Seg value={o.sms === null ? '' : o.sms ? 'yes' : 'no'} set={(v) => setO({ ...o, sms: v === 'yes' })} options={[['yes', 'Yes'], ['no', 'No']]} /></div>}
            </div>
            </fieldset>
            </>}
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

          <fieldset className="no-fs" disabled={view && !editPart}>
          {tab === 'so' && view && !editPart && <section className="no-card no-soview" aria-label="Sales order">{orderListJsx}</section>}
          {tab === 'so' && !(view && !editPart) && <>
          <section className="no-card" aria-label="Products" id="go-products">
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
          <section className="no-card" aria-label="On this order" id="go-lines">
            <div className="no-ct">On this order{soCats.length > 1 && <span className="no-foldall"><button type="button" className="link" onClick={() => setFolded(Object.fromEntries(soCats.map((c) => [c, true])))}>Minimise all</button><button type="button" className="link" onClick={() => setFolded({})}>Expand all</button></span>}</div>
            {!lines.length && <p className="no-sub">Nothing yet: pick a material or search, then press Add.</p>}
            {soCats.map((c) => { const ls = lines.filter((l) => l.category === c), chs = mergeCh(allCharges.filter((x) => x.cat === c)), sum = r2(ls.reduce((s, l) => s + r2(l.qty * l.price), 0) + chs.filter((x) => !x.off).reduce((s, x) => s + r2(x.qty * x.price), 0)); return (
              <div key={c} className="no-grp">
                <div className="no-gh no-ghb" style={{ background: HEAD[c] }}><button type="button" className="no-fold" aria-expanded={!folded[c]} aria-label={(folded[c] ? 'Expand ' : 'Minimise ') + c} onClick={() => setFolded((f) => ({ ...f, [c]: !f[c] }))}>{folded[c] ? '▸' : '▾'}</button>{c} <small>{ls.length} product{ls.length === 1 ? '' : 's'} · {cash(sum)}</small>{(() => { const cs = r2(ls.reduce((t, l) => t + costOf(l), 0) + chs.filter((x) => !x.off).reduce((t, x) => t + costOf(x), 0)), pr = r2(sum - cs); return <span className="no-ghp">Profit {cash(pr)} · {pct(pr, sum)}%</span>; })()}</div>
                {!folded[c] && <>
                <div className="no-tw"><table className="no-t">
                  <thead><tr><th>Product</th><th>Qty</th><th className="r">Unit ex GST</th><th className="r">Amount</th><th className="r">Cost</th><th className="r">Profit $</th><th className="r">Profit %</th><th /></tr></thead>
                  <tbody>
                    {ls.map((l) => { const changed = Math.abs(l.price - l.list) >= 0.005; return (
                      <tr key={l.key} id={'go-line-' + l.key}><td><b>{lineName(l)}</b><small>{l.code} · {l.unit}</small>
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
                    {chs.filter((x) => x.asItem).map((x) => chargeRow(x))}
                    {chs.some((x) => !x.asItem) && <tr className="no-chh"><td colSpan="8">ADDITIONAL CHARGES <span>(from Build Load)</span></td></tr>}
                    {chs.filter((x) => !x.asItem).map((x) => chargeRow(x))}
                  </tbody>
                </table></div>
                </>}
              </div>); })}
          </section>
          </>}

          {tab === 'po' && <section className="no-card" aria-label="Build PO">
            <div className="no-ct">Build PO <small>one PO per supplier</small>{pos.length > 1 && <span className="no-foldall"><button type="button" className="link" onClick={() => setFoldedPo(Object.fromEntries(pos.map((P) => [P.uid, true])))}>Minimise all</button><button type="button" className="link" onClick={() => setFoldedPo({})}>Expand all</button></span>}</div>
            {!lines.length && <p className="no-sub">Add products in Build SO first.</p>}
            {pos.map((P, i) => (
              <div key={P.uid} className="no-grp" id={'go-po-' + (i + 1)}>
                <div className="no-gh no-ghb" style={{ background: '#1E1A17' }}><button type="button" className="no-fold" aria-expanded={!foldedPo[P.uid]} aria-label={(foldedPo[P.uid] ? 'Expand ' : 'Minimise ') + 'PO ' + (i + 1)} onClick={() => setFoldedPo((f) => ({ ...f, [P.uid]: !f[P.uid] }))}>{foldedPo[P.uid] ? '▸' : '▾'}</button>PO {i + 1} <small>{P.supplier || 'No supplier yet'}{P.portal ? ' · ' + P.portal : ''}{P.portal === 'OrderSteel' && poCat(P) ? ' · ' + poCat(P) : ''}{foldedPo[P.uid] ? ' · ' + Object.keys(P.items).filter((k) => Number(P.items[k]) > 0).length + ' product' + (Object.keys(P.items).filter((k) => Number(P.items[k]) > 0).length === 1 ? '' : 's') + ' · Send ' + (P.send == null ? 'not chosen' : P.send ? 'Yes' : 'No') : ''}</small>{posHand && <button type="button" className="no-ghx" onClick={() => editPos((Ps) => Ps.filter((x) => x.uid !== P.uid))}>Remove PO</button>}</div>
                {!foldedPo[P.uid] && <>
                <div className="no-load">
                  <label className="no-f">Supplier<select value={P.supplier_id || ''} onChange={(e) => { const sp = suppliers.find((x) => String(x.id) === e.target.value); const rt = routes.find((r) => String(r.supplier_id) === e.target.value); editPos((Ps) => Ps.map((x, j) => (j === i ? { ...x, supplier_id: sp?.id || null, supplier: sp?.name || '', portal: rt?.portal || '' } : x))); }}><option value="">Choose…</option>{suppliers.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}</select></label>
                  {isConcretePO(P) ? <div className="no-f">Delivery<b className="no-fixed">Delivered to the site (concrete)</b></div> : <>
                  <div className="no-f">Delivery or pick-up <span className="req">*</span><Seg value={poFulfil(P)} set={(v) => setPoFulfil(P, v)} options={[['delivery', 'Delivery'], ['pickup', 'Pick-up']]} /></div>
                  {poFulfil(P) === 'delivery' && <label className="no-f">Deliver to<Seg value={P.deliverTo} set={(v) => editPos((Ps) => Ps.map((x, j) => (j === i ? { ...x, deliverTo: v } : x)))} options={[['site', "Customer's site"], ['penrith', 'Penrith warehouse']]} /></label>}</>}
                  <div className={'no-f' + (o.kind === 'order' && P.send == null ? ' no-need' : '')}>Send order <span className="req">*</span><Seg value={P.send == null ? '' : P.send ? 'yes' : 'no'} set={(v) => setPoSend(P, v === 'yes')} options={[['yes', 'Yes'], ['no', 'No']]} /></div>
                  <label className="no-f no-grow">Note to the supplier<input value={P.notes} onChange={(e) => editPos((Ps) => Ps.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)))} placeholder="Optional" /></label>
                </div>
                {(() => { const cats = new Set(Object.keys(P.items).filter((k) => Number(P.items[k]) > 0).map((k) => lineOf(k)?.category)); return <>
                  {cats.has('Concrete') && questions('Concrete', catAnswers('Concrete'), (ch) => setCatAns('Concrete', ch))}
                  {cats.has('Wafflepods') && (poFulfil(P) === 'delivery' || catDelivery('Wafflepods')) && questions('Wafflepods', catAnswers('Wafflepods'), (ch) => setCatAns('Wafflepods', ch))}</>; })()}
                <div className="no-poem">{P.send === false ? <span>Not sent: kept with the order only.</span> : (() => { const em = emailOf(P); return em.to ? <span>{P.portal ? <>Into <b>{P.portal}</b> (items only) and email</> : 'Email'} to <b>{em.to}</b>{em.cc ? <> · CC {em.cc}</> : null}</span> : <span className="no-warn">No email for {P.supplier || 'this supplier'}: add it in Admin › Suppliers.</span>; })()}
                  <button type="button" className="btn" onClick={() => setPreview(poMail(P, ''))}>Preview email</button></div>
                <div className="no-tw"><table className="no-t"><thead><tr><th>Product</th><th>Sold</th><th>Order</th><th className="r">Unit cost</th><th className="r">Cost</th><th>Move to</th></tr></thead><tbody>
                  {Object.entries(P.items).filter(([, v]) => Number(v) > 0).map(([k, v]) => { const l = lineOf(k); if (!l) return null; return (
                    <tr key={k}><td><b>{lineName(l)}</b><small>{l.code}</small></td><td>{l.qty} {l.unit}</td>
                      <td><input className="no-price" value={v} inputMode="decimal" onChange={(e) => editPos((Ps) => Ps.map((x, j) => (j === i ? { ...x, items: { ...x.items, [k]: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 } } : x)))} aria-label={'Order quantity of ' + l.name} /></td>
                      <td className="r no-cost">{unitCost(l) ? cash(unitCost(l)) : '—'}</td><td className="r"><b>{cash(r2(unitCost(l) * Number(v)))}</b></td>
                      <td><select className="no-move" value="" onChange={(e) => { const to = e.target.value; setStockByHand((m) => ({ ...m, [k]: to === 'stock' })); editPos((Ps) => Ps.map((x, j) => (j === i ? { ...x, items: { ...x.items, [k]: 0 } } : to !== 'stock' && x.uid === to ? { ...x, items: { ...x.items, [k]: qtyIn(x.items, k) + Number(v) } } : x))); }}>
                        <option value="">Move…</option>{pos.filter((x) => x.uid !== P.uid).map((x, j) => <option key={x.uid} value={x.uid}>PO {pos.indexOf(x) + 1} · {x.supplier || 'no supplier'}</option>)}<option value="stock">From Penrith stock (no PO)</option></select></td></tr>); })}
                  {(() => { const ks = Object.keys(P.items).filter((k) => Number(P.items[k]) > 0), ex = poExtraMerged(P, ks), its = ex.filter((x) => x.asItem), chs2 = ex.filter((x) => !x.asItem);
                    const xrow = (x) => <tr key={'x' + x.load + x.key} className={x.asItem ? 'no-autoi' : 'no-chr'}><td>{x.asItem ? <b>{x.name}</b> : x.name}<small className="no-code">{x.code}{x.asItem ? ' · added by itself' : ''}</small></td><td>{x.qty}</td><td>{x.qty}</td>
                      <td className="r no-cost">{x.free ? cash(0) : unitCost(x) ? cash(unitCost(x)) : '—'}</td><td className="r"><b>{cash(x.free ? 0 : costOf(x))}</b></td><td className="no-sub">follows the order</td></tr>;
                    const total = r2(ks.reduce((t, k) => t + unitCost(lineOf(k)) * Number(P.items[k]), 0) + ex.reduce((t, x) => t + (x.free ? 0 : costOf(x)), 0));
                    return <>{its.map(xrow)}{chs2.length > 0 && <tr className="no-chh"><td colSpan="6">ADDITIONAL CHARGES</td></tr>}{chs2.map(xrow)}
                      <tr className="no-pot"><td colSpan="4">PO total (cost, ex GST) · to Xero as {P.send ? 'the purchase order' : 'nothing (not sent)'}</td><td className="r"><b>{cash(total)}</b></td><td /></tr></>; })()}
                </tbody></table></div>
                </>}
              </div>))}
            {stockKeys.length > 0 && <div className="no-grp"><div className="no-gh" style={{ background: '#57534E' }}>From Penrith stock <small>no PO</small></div>
              <div className="no-tw"><table className="no-t"><tbody>{stockKeys.map((k) => { const l = lineOf(k); return (
                <tr key={k}><td><b>{lineName(l)}</b><small>{l.code}</small></td><td>{l.qty} {l.unit}</td>
                  <td><select className="no-move" value="" onChange={(e) => { const to = e.target.value; setStockByHand((m) => ({ ...m, [k]: false })); if (to === 'new') editPos((Ps) => [...Ps, { uid: key(), supplier_id: null, supplier: '', portal: '', deliverTo: 'site', notes: '', items: { [k]: l.qty } }]); else editPos((Ps) => Ps.map((x) => (x.uid === to ? { ...x, items: { ...x.items, [k]: l.qty } } : x))); }}>
                    <option value="">Put on a PO…</option>{pos.map((x, j) => <option key={x.uid} value={x.uid}>PO {j + 1} · {x.supplier || 'no supplier'}</option>)}<option value="new">A new PO</option></select></td></tr>); })}</tbody></table></div></div>}
            {lines.length > 0 && <button type="button" className="btn" onClick={() => editPos((Ps) => [...Ps, { uid: key(), supplier_id: null, supplier: '', portal: '', deliverTo: 'site', notes: '', items: {} }])}>+ Add a PO</button>}
          </section>}

          {tab === 'load' && <section className="no-card" aria-label="Build Load">
            <div className="no-ct">Build Load <small>trucks and pick-ups</small></div>
            {!lines.length && <p className="no-sub">Add products in Build SO first.</p>}
            {loadCharges.map(({ L, inLoad, cats, ch }) => { const a = L.answers || {}; return (
              <div key={L.uid} className="no-grp" id={'go-load-' + L.n}>
                <div className="no-gh" style={{ background: cats.length === 1 ? HEAD[cats[0]] : '#1E1A17' }}>Load {L.n} <small>{cats.join(' · ') || 'empty'}</small>{loads.length > 1 && <button type="button" className="no-ghx" onClick={() => removeLoad(L.uid)}>Remove load</button>}</div>
                <div className="no-load">
                  {cats.includes('Concrete') ? <div className="no-f">Delivery<b className="no-fixed">Concrete: delivered to the site</b></div> : <Seg value={L.fulfil} set={(v) => setLoad(L.uid, { fulfil: v })} options={[['delivery', 'Delivery'], ['pickup', 'Pick-up']]} />}
                  {L.fulfil === 'delivery' && <div className="no-f no-dby">Delivered by <span className="req">*</span><Seg value={deliveredBy(L)} set={(v) => answerDelivery(L, v)} options={[['supplier', 'Supplier'], ['internal', 'Internal']]} />
                    <small>{deliveredBy(L) === 'internal' ? "Direct's own truck: sales order only" : "The supplier delivers: on its PO too"}</small></div>}
                  {L.fulfil === 'delivery' && <label className="no-f no-grow">Site address <span className="req">*</span><AddressInput value={L.site || ''} onChange={(v) => setLoad(L.uid, { site: v })} onPick={(r) => setLoad(L.uid, { site: r.full })} placeholder="Street, suburb, postcode" ariaLabel={'Site address of load ' + L.n} /></label>}
                  <label className="no-f">{L.fulfil === 'delivery' ? 'Delivery date' : 'Pick-up date'}{o.kind === 'order' && <span className="req"> *</span>}<input type="date" value={L.date || ''} onChange={(e) => setLoad(L.uid, { date: e.target.value })} /></label>
                  <label className="no-f">Time<select value={L.time || 'Any time'} onChange={(e) => setLoad(L.uid, { time: e.target.value })}>{TIMES.map((t) => <option key={t}>{t}</option>)}</select></label>
                </div>
                <div className="no-tw"><table className="no-t"><thead><tr><th>On this load</th><th>Sold</th><th>On it</th><th>Move to</th></tr></thead><tbody>
                  {lines.filter((l) => qtyIn(L.items, l.key) > 0).map((l) => (
                    <tr key={l.key}><td><b>{lineName(l)}</b><small>{l.code}</small></td><td>{l.qty} {l.unit}</td>
                      <td><input className="no-price" value={qtyIn(L.items, l.key)} inputMode="decimal" onChange={(e) => setLoadQty(L.uid, l.key, Number(e.target.value.replace(/[^0-9.]/g, '')) || 0)} aria-label={'Quantity of ' + l.name + ' on load ' + L.n} /></td>
                      <td><select className="no-move" value="" onChange={(e) => e.target.value && moveToLoad(l.key, L.uid, e.target.value)}><option value="">Move…</option>{loads.filter((x) => x.uid !== L.uid).map((x) => <option key={x.uid} value={x.uid}>Load {x.n}</option>)}</select></td></tr>))}
                  {/* items the form adds itself for this load (e.g. the free scrap bags): they go on it with its pods */}
                  {ch.filter((x) => x.asItem && !x.off).map((x) => (
                    <tr key={'a' + x.key} className="no-autoi"><td><b>{x.name}</b><small className="no-code">{x.code} · added by itself</small></td><td>{x.qty}</td><td>{x.qty}</td><td className="no-sub">follows the pods</td></tr>))}
                </tbody></table></div>
              </div>); })}
            {(() => { const left = lines.map((l) => ({ l, rest: r2(l.qty - loads.reduce((t, L) => t + qtyIn(L.items, l.key), 0)) })).filter((x) => x.rest > 1e-6);
              const over = lines.filter((l) => loads.reduce((t, L) => t + qtyIn(L.items, l.key), 0) - l.qty > 1e-6);
              return <>
                {over.map((l) => <p key={l.key} className="no-miss">{lineName(l)}: more on loads than sold ({l.qty}).</p>)}
                {left.length > 0 && <div className="no-grp"><div className="no-gh" style={{ background: '#57534E' }}>Not on a load yet <small>optional: to go later, or put it on a load now</small></div>
                  <div className="no-tw"><table className="no-t"><thead><tr><th>Product</th><th>Sold</th><th>Not on a load</th><th>Put on</th></tr></thead><tbody>
                    {left.map(({ l, rest }) => <tr key={l.key}><td><b>{lineName(l)}</b><small>{l.code}</small></td><td>{l.qty} {l.unit}</td><td><b>{rest}</b></td>
                      <td><select className="no-move" value="" onChange={(e) => { const to = e.target.value; if (!to) return;
                        if (to === 'new') setLoadsHand((Ls) => { const base = Ls || loads.map((L) => ({ ...L, auto: undefined })); return [...base, { ...blankLoad(base.length + 1, headLoad), items: { [l.key]: rest } }]; });
                        else setLoadQty(to, l.key, r2(qtyIn((loads.find((x) => x.uid === to) || {}).items, l.key) + rest)); }}>
                        <option value="">Put on…</option>{loads.map((x) => <option key={x.uid} value={x.uid}>Load {x.n}</option>)}<option value="new">A new load</option></select></td></tr>)}
                  </tbody></table></div></div>}
              </>; })()}
            {lines.length > 0 && <button type="button" className="btn" onClick={addLoad}>+ Add a load</button>}
          </section>}
          </fieldset>
        </div>

        {(!view || editPart) && askDelivery && <div className="ap-wrap no-prev" role="dialog" aria-modal="true" aria-labelledby="dl-t">
          <div className="no-prevbox no-askd"><div className="no-prevh"><b id="dl-t">A delivery was added</b></div>
            <div className="no-askb"><p><b>Load {askDelivery.L.n}</b> · {askDelivery.cats.join(', ')} is another delivery. It goes on the customer's sales order (the delivery quantity goes up).</p>
              <p>Who delivers it?</p>
              <button type="button" className="btn btn-red" onClick={() => answerDelivery(askDelivery.L, 'supplier')}>Supplier delivery<small>also added to the supplier's PO (its delivery quantity goes up)</small></button>
              <button type="button" className="btn" onClick={() => answerDelivery(askDelivery.L, 'internal')}>Internal delivery<small>Direct's own truck: on the sales order only, the PO stays as it is</small></button></div></div></div>}
        {preview && <div className="ap-wrap no-prev" role="dialog" aria-modal="true" aria-label="Email preview" onClick={(e) => { if (e.target === e.currentTarget) setPreview(null); }}>
          <div className="no-prevbox"><div className="no-prevh"><b>Email preview</b><small>Subject: {preview.subject}</small><button type="button" className="ap-x" onClick={() => setPreview(null)} aria-label="Close">×</button></div>
            <div className="no-prevmail" dangerouslySetInnerHTML={{ __html: preview.html }} /></div></div>}
        <aside className="no-side" aria-label="The order">
          <section className="no-card">
            {!(view && !editPart) && <><div className="no-sidehd">{o.kind === 'quote' ? 'QUOTE' : 'ORDER'}</div>
            {orderListJsx}</>}
            {view ? <div className="no-acts"><div className="no-sidehd">{tab === 'po' ? 'PURCHASE ORDERS' : tab === 'load' ? 'LOADS' : 'ACTIONS'}</div>
              {placedInfo && placedInfo.number === o.number && <div className="no-placed">{[...(placedInfo.xero || []), ...(placedInfo.sent || []).map((t) => ({ ok: true, text: 'PO email sent: ' + t })), ...(placedInfo.failed || []).map((t) => ({ ok: false, text: 'PO email not sent: ' + t })), ...(placedInfo.portal || [])].map((x, i) => <p key={i} className={x.ok ? 'no-okl' : 'no-badl'}>{x.ok ? '✓ ' : '✕ '}{x.text}</p>)}{!placedInfo.upload && <p className="no-sub">Not uploaded to Xero.</p>}</div>}
              {actMsg && <p className={actMsg.bad ? 'msg bad' : 'msg'} role="status">{actMsg.text}</p>}
              {o.status !== 'cancelled' && <>
{tab === 'load' && <>              <div className="no-ah">LOADS</div>
              {loads.map((L) => { const cats = [...new Set(lines.filter((l) => qtyIn(L.items, l.key) > 0).map((l) => l.category))].join(', '); return (
                <div key={L.uid} className="no-al"><b>Load {L.n}</b> · {cats} · {L.fulfil === 'pickup' ? 'Pick-up' : 'Delivery'}
                  {L.status === 'booked' ? <><small className="no-okl">Booked {L.booked_date ? new Date(L.booked_date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : ''} {L.booked_time || ''}</small>
                    <span className="no-row"><button type="button" className="btn btn-red" disabled={!!act} onClick={() => loadStatus(L, 'delivered')}>{L.fulfil === 'pickup' ? 'Picked up' : 'Delivered'}</button><button type="button" className="btn" disabled={!!act} onClick={() => loadStatus(L, 'pending')}>Unbook</button></span></>
                  : L.status === 'delivered' ? <small className="no-okl">✓ {L.fulfil === 'pickup' ? 'Picked up' : 'Delivered'}</small>
                  : <span className="no-book"><input type="date" value={(bookAt[L.uid] || {}).date ?? L.date ?? ''} onChange={(e) => setBookAt((m) => ({ ...m, [L.uid]: { ...(m[L.uid] || {}), date: e.target.value } }))} aria-label={'Day for load ' + L.n} />
                    <select value={(bookAt[L.uid] || {}).time ?? L.time ?? 'Any time'} onChange={(e) => setBookAt((m) => ({ ...m, [L.uid]: { ...(m[L.uid] || {}), time: e.target.value } }))} aria-label={'Time for load ' + L.n}>{TIMES.map((t) => <option key={t}>{t}</option>)}</select>
                    <button type="button" className="btn btn-red" disabled={!!act} onClick={() => bookLoad(L)}>{act === 'book' + L.uid ? 'Booking…' : 'Book'}</button>{L.status === 'on_hold' && <small className="no-badl">On hold</small>}</span>}
                </div>); })}
</>}{tab === 'po' && <>              <div className="no-ah">PURCHASE ORDERS</div>
              {!pos.length && <p className="no-sub">No POs.</p>}
              {pos.map((P) => <div key={P.uid} className="no-al"><b>{P.number || 'PO'}</b> · {P.supplier}{P.portal ? ' · ' + P.portal : ''}
                <small>{P.send ? 'Sent to the supplier' : 'Not sent'}{P.supplier_ref ? ' · in ' + P.portal + ' as ' + P.supplier_ref : ''}{P.portal_error && P.portal_error !== 'sending' ? ' · portal: ' + P.portal_error : ''}</small>
                <span className="no-row"><button type="button" className="btn" onClick={() => setPreview(poMail(P, P.number, o.number))}>Preview</button><button type="button" className="btn" disabled={!!act} onClick={() => resendPo(P)}>{act === 'mail' + P.uid ? 'Sending…' : P.send ? 'Resend email' : 'Email it'}</button>
                  {P.portal && !P.supplier_ref && <button type="button" className="btn" disabled={!!act} onClick={() => toPortal(P)}>{act === 'portal' + P.uid ? 'Sending…' : 'To ' + P.portal}</button>}</span></div>)}
</>}              {tab === 'so' && o.kind === 'order' && (() => { const inX = soXero.find((x) => x.status === 'done' && x.xero_id && x.action !== 'delete'), last = soXero[0], inv = 'INV-' + String(o.number || '').replace(/\D/g, '');
                return <><div className="no-ah">XERO</div>
                  <p className="no-xst">{inX ? <><b className="no-okl">{inv} is in Xero</b>{last?.sent_at ? ' · last ' + new Date(last.sent_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''}</> : last?.status === 'failed' ? <b className="no-badl">{inv}: Xero refused it · {last.last_error}</b> : <>{inv} is not in Xero{o.upload_xero === false ? ' (placed without uploading)' : ''}</>}</p>
                  <button type="button" className="btn" disabled={!!act} onClick={uploadSo}>{act === 'xero' ? 'Sending to Xero…' : inX ? 'Update in Xero' : 'Upload to Xero'}</button></>; })()}
              {tab === 'so' && <><div className="no-ah">CUSTOMER</div>
              <button type="button" className="btn" disabled={!!act} onClick={emailCustomer}>{act === 'cust' ? 'Sending…' : 'Email the order confirmation'}</button></>}
              </>}
              <div className="no-ah">HISTORY · {tab === 'po' ? 'PURCHASE ORDERS' : tab === 'load' ? 'LOADS' : 'SALES ORDER'}</div>
              {(() => { const ev = orderNotes.filter((n) => n.part === tab); return !ev.length ? <p className="no-sub">Nothing yet.</p> : ev.map((n) => <div key={n.id} className={'no-onote' + (/refused|failed|not sent|not in|cancelled/i.test(n.text) ? ' no-onote-bad' : /placed as|made in Xero|is in |delivered|picked up/i.test(n.text) ? ' no-onote-ev' : '')}><p>{n.text}</p><small>{n.by_name || n.by_email} · {new Date(n.at).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</small></div>); })()}
              {tab === 'so' && o.status !== 'cancelled' && <button type="button" className="btn no-cancel" disabled={!!act} onClick={cancelOrder}>{act === 'cancel' ? 'Cancelling…' : 'Cancel order'}</button>}
            </div> : <>
            {o.customer?.on_hold && <div className="no-alert"><b>On hold:</b> this customer is on hold. Check before placing.</div>}
            {overLimit && <div className="no-alert"><b>Over the credit limit:</b> owes {cash(owes)} + this order {cash(total)} = {cash(owes + total)} (limit {cash(o.customer.credit_limit)}).</div>}
            {o.kind === 'order' && <div className="no-f no-upx">Upload to Xero <span className="req">*</span><Seg value={o.upload_xero === false ? 'no' : 'yes'} set={(v) => setO({ ...o, upload_xero: v === 'yes' })} options={[['yes', 'Yes'], ['no', 'No']]} />
              <small>{o.upload_xero === false ? 'Nothing goes to Xero.' : 'On placing: the sales order' + (pos.length ? ' and ' + pos.length + ' purchase order' + (pos.length === 1 ? '' : 's') : '') + ' in Xero.'}</small></div>}
            {msg && (msg.bad && !/^Not placed:/.test(msg.text) ? <button type="button" className="msg bad no-go" onClick={() => goTo(msg.text)} title="Go there">{msg.text} <i>→</i></button> : <p className={msg.bad ? 'msg bad' : 'msg'} role="status">{msg.text}</p>)}
            {missingAll.length > 0 && <div className="no-misslist"><b>Still to fill in ({missingAll.length})</b>
              {missingAll.map((t) => <button type="button" key={t} className="no-miss no-go" onClick={() => goTo(t)} title="Go there">{t} <i>→</i></button>)}</div>}
            {[...new Set(allCharges.filter((x) => !x.off && x.note && !/location|driving time/i.test(x.note)).map((x) => x.note))].map((t) => <button type="button" key={t} className="no-warnbox no-go" onClick={() => goTo(t)} title="Go there">Warning: {t} <i>→</i></button>)}
            <button type="button" className={'btn btn-red btn-big' + (missingAll.length ? ' no-wait' : '')} disabled={busy} onClick={place} title={missingAll.length ? 'Fill in the ' + missingAll.length + ' item(s) listed above first' : ''}>{busy ? 'Placing…' : missingAll.length ? (o.kind === 'quote' ? 'Save quote' : 'Place order') + ' · ' + missingAll.length + ' to fill in' : o.kind === 'quote' ? 'Save quote' : 'Place order'}</button>
            <div className="no-row"><button type="button" className="btn" onClick={async () => { await save(); setMsg({ text: 'Draft saved.' }); }}>Save draft</button><button type="button" className="btn" onClick={() => { if (window.confirm('Clear the form? The draft stays saved.')) restart(); }}>Clear</button></div>
            </>}
          </section>
        </aside>
      </div>
      </div>
    </>
  );
}
