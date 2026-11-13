import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import PageHeader from '../components/PageHeader.jsx';
import Icon from '../components/Icon.jsx';

/* Admin > Products and prices (13 Nov 2026): every product as Xero has it, pulled with "Sync from Xero", and Direct's own
   price lists (builder, installer, retail) beside Xero's price. Category, unit and the three prices are Direct's: typed
   here, saved when you leave the box, never changed by a sync. */
const money = (v) => (v === null || v === undefined || v === '' ? '' : '$' + Number(v).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const when = (t) => (t ? new Date(t).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');

async function xero(action, extra = {}) {
  const { data, error } = await supabase.functions.invoke('xero', { body: { action, ...extra } });
  if (error) { let m = error.message; try { const b = await error.context.json(); m = b.error || m; } catch { /* the message as it is */ } throw new Error(m); }
  if (data?.error) throw new Error(data.error);
  return data;
}

function PriceBox({ p, field, onSaved }) {
  const [v, setV] = useState(p[field] ?? '');
  useEffect(() => { setV(p[field] ?? ''); }, [p, field]);
  const save = async () => {
    const n = String(v).trim() === '' ? null : Number(String(v).replace(/[^0-9.]/g, ''));
    if (n !== null && !Number.isFinite(n)) { setV(p[field] ?? ''); return; }
    if (n === (p[field] === null ? null : Number(p[field]))) return;
    const { error } = await supabase.from('products').update({ [field]: n, updated_at: new Date().toISOString() }).eq('id', p.id);
    if (!error) onSaved(p.id, { [field]: n });
  };
  return <input className="pp-price" inputMode="decimal" value={v} placeholder={p.xero_sales_price != null ? Number(p.xero_sales_price).toFixed(2) : ''} onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} aria-label={field.replace('price_', '') + ' price of ' + p.code} />;
}
function TextBox({ p, field, onSaved, list }) {
  const [v, setV] = useState(p[field] ?? '');
  useEffect(() => { setV(p[field] ?? ''); }, [p, field]);
  const save = async () => { const t = String(v).trim(); if (t === (p[field] || '')) return;
    const { error } = await supabase.from('products').update({ [field]: t, updated_at: new Date().toISOString() }).eq('id', p.id); if (!error) onSaved(p.id, { [field]: t }); };
  return <input className="pp-text" list={list} value={v} onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} aria-label={field + ' of ' + p.code} />;
}

export default function AdminProducts() {
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [show, setShow] = useState('active');
  const [n, setN] = useState(100);
  const [params, setParams] = useSearchParams();

  const load = async () => {
    const all = []; let from = 0;
    for (;;) { const { data, error } = await supabase.from('products').select('*').order('name').range(from, from + 999); if (error) { setMsg({ bad: true, text: error.message }); break; } all.push(...(data || [])); if (!data || data.length < 1000) break; from += 1000; }
    setRows(all);
  };
  const loadStatus = () => xero('status').then(setStatus).catch((e) => setStatus({ error: e.message }));
  useEffect(() => { load(); loadStatus(); }, []);
  useEffect(() => { const x = params.get('xero'); if (x) { setMsg({ bad: x !== 'connected', text: params.get('msg') || (x === 'connected' ? 'Xero connected.' : 'Xero did not connect.') }); setParams({}, { replace: true }); loadStatus(); } }, [params]);

  const connect = async () => { setBusy('connect'); try { const r = await xero('connect', { return_to: window.location.origin + '/admin/products' }); window.location.href = r.url; } catch (e) { setMsg({ bad: true, text: e.message }); setBusy(''); } };
  const sync = async () => {
    setBusy('sync'); setMsg(null);
    try { const r = await xero('sync_items'); setMsg({ text: 'Synced ' + r.items + ' items from Xero: ' + r.added + ' new, ' + r.updated + ' updated' + (r.gone ? ', ' + r.gone + ' no longer in Xero' : '') + '.' }); await load(); loadStatus(); }
    catch (e) { setMsg({ bad: true, text: e.message }); loadStatus(); }
    setBusy('');
  };
  const patch = (id, ch) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...ch } : r)));

  const cats = useMemo(() => [...new Set((rows || []).map((r) => r.category).filter(Boolean))].sort(), [rows]);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (rows || []).filter((r) => (show === 'all' || (show === 'active' ? r.in_xero && r.active : !r.in_xero)) && (!cat || (cat === '-' ? !r.category : r.category === cat))
      && (!t || (r.code + ' ' + r.name + ' ' + r.description + ' ' + r.category).toLowerCase().includes(t)));
  }, [rows, q, cat, show]);
  const last = status?.last_sync;

  return (
    <>
      <PageHeader title="PRODUCTS" sub="Every product from Xero, with Direct's price lists. Sync from Xero pulls Xero's items; the categories, units and price lists are typed here." back={<Link to="/admin" className="page-back"><Icon name="back" size={14} /> Admin</Link>} />
      <div className="pp">
        <div className="pp-bar">
          <div className="pp-xero">
            <span className={'pp-dot' + (status?.connected ? ' on' : '')} />
            <span>{status === null ? 'Checking Xero…' : status.error ? 'Xero: ' + status.error : status.connected ? <>Xero: <b>{status.tenant}</b> · syncs by itself every 30 minutes{last ? <> · last {when(last.finished_at || last.started_at)}{/^auto/.test(last.by_email || '') ? ' (auto)' : ' by ' + String(last.by_email || '').split('@')[0]}{last.ok === false ? ' · failed: ' + (last.error || '') : ''}</> : ' · not synced yet'}</> : status.setup === false ? 'Xero is not set up yet (the app keys)' : 'Xero is not connected'}</span>
          </div>
          {status && !status.error && (status.connected
            ? <button type="button" className="btn btn-red" onClick={sync} disabled={!!busy}><Icon name="sync" size={15} /> {busy === 'sync' ? 'Syncing…' : 'Sync from Xero'}</button>
            : <button type="button" className="btn btn-red" onClick={connect} disabled={!!busy || status.setup === false}>{busy === 'connect' ? 'Opening Xero…' : 'Connect Xero'}</button>)}
          {status?.connected && <button type="button" className="link" onClick={connect} disabled={!!busy}>Reconnect</button>}
        </div>
        {msg && <p className={msg.bad ? 'msg bad' : 'msg'} role="status">{msg.text}</p>}
        <div className="pp-filters">
          <input type="search" className="pp-search" value={q} onChange={(e) => { setQ(e.target.value); setN(100); }} placeholder="Search a code, name or description…" aria-label="Search products" />
          <select value={cat} onChange={(e) => { setCat(e.target.value); setN(100); }} aria-label="Category"><option value="">All categories</option><option value="-">No category yet</option>{cats.map((c) => <option key={c}>{c}</option>)}</select>
          <select value={show} onChange={(e) => { setShow(e.target.value); setN(100); }} aria-label="Show"><option value="active">In Xero</option><option value="gone">No longer in Xero</option><option value="all">All</option></select>
          <span className="pp-count">{rows === null ? 'Loading…' : list.length + ' of ' + rows.length + ' products'}</span>
        </div>
        <datalist id="pp-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
        <div className="pp-table-wrap">
          <table className="pp-table">
            <thead><tr><th>Code</th><th>Product</th><th>Category</th><th>Unit</th><th className="r">Xero price</th><th className="r">Builder</th><th className="r">Installer</th><th className="r">Retail</th><th className="r">Xero cost</th></tr></thead>
            <tbody>
              {rows !== null && !list.length && <tr><td colSpan="9" className="pp-empty">{rows.length ? 'No product matches.' : status?.connected ? 'No products yet: press Sync from Xero.' : 'No products yet: connect Xero, then Sync from Xero.'}</td></tr>}
              {list.slice(0, n).map((p) => (
                <tr key={p.id} className={p.in_xero ? '' : 'pp-gone'}>
                  <td className="pp-code">{p.code}</td>
                  <td><b>{p.name}</b>{p.description && p.description !== p.name ? <small>{p.description}</small> : null}{!p.in_xero && <small className="pp-tag">No longer in Xero</small>}</td>
                  <td><TextBox p={p} field="category" list="pp-cats" onSaved={patch} /></td>
                  <td><TextBox p={p} field="unit" onSaved={patch} /></td>
                  <td className="r">{money(p.xero_sales_price)}</td>
                  <td className="r"><PriceBox p={p} field="price_builder" onSaved={patch} /></td>
                  <td className="r"><PriceBox p={p} field="price_installer" onSaved={patch} /></td>
                  <td className="r"><PriceBox p={p} field="price_retail" onSaved={patch} /></td>
                  <td className="r pp-muted">{money(p.xero_cost_price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.length > n && <div className="pp-more"><button type="button" className="btn" onClick={() => setN(n + 200)}>Show more ({list.length - n} left)</button></div>}
        <p className="pp-note">An empty price list box uses the Xero price (shown faint in the box). Type a price to set it for that list; clear it to go back to Xero's.</p>
      </div>
    </>
  );
}
