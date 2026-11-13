import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import PageHeader from '../components/PageHeader.jsx';
import Icon from '../components/Icon.jsx';

/* Admin > Suppliers (13 Nov 2026): each supplier, its portals, and the emails a purchase order goes To and is copied to (CC). */
const PORTALS = ['OrderConcrete', 'OrderSteel', 'OrderPods'];
const emails = (t) => String(t || '').split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
const okEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function Route({ r, onSaved, onRemove }) {
  const [f, setF] = useState({ portal: r.portal, to: (r.email_to || []).join(', '), cc: (r.email_cc || []).join(', ') });
  const [state, setState] = useState('');
  const dirty = f.portal !== r.portal || emails(f.to).join() !== (r.email_to || []).join() || emails(f.cc).join() !== (r.email_cc || []).join();
  const bad = [...emails(f.to), ...emails(f.cc)].filter((e) => !okEmail(e));
  const save = async () => {
    if (bad.length) { setState('Not an email: ' + bad.join(', ')); return; }
    if (!emails(f.to).length) { setState('Add at least one To email.'); return; }
    setState('Saving…');
    const row = { portal: f.portal, email_to: emails(f.to), email_cc: emails(f.cc), updated_at: new Date().toISOString() };
    const { error } = await supabase.from('supplier_routes').update(row).eq('id', r.id);
    if (error) setState(error.message); else { setState('Saved'); onSaved(r.id, row); setTimeout(() => setState(''), 1500); }
  };
  return (
    <div className="sp-route">
      <div className="sp-r-head">
        <label className="sp-portal">Through
          <select value={f.portal} onChange={(e) => setF({ ...f, portal: e.target.value })}><option value="">Email only (no portal)</option>{PORTALS.map((p) => <option key={p}>{p}</option>)}</select>
        </label>
        <div className="sp-r-acts">
          {state && <span className={'sp-state' + (state === 'Saved' ? ' ok' : state === 'Saving…' ? '' : ' bad')}>{state}</span>}
          <button type="button" className="btn btn-red" disabled={!dirty} onClick={save}>Save</button>
          <button type="button" className="link" onClick={() => onRemove(r)}>Remove</button>
        </div>
      </div>
      <label className="sp-field"><span>Email to</span><input value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} placeholder="orders@supplier.com.au (several: separate with commas)" /></label>
      <label className="sp-field"><span>CC</span><input value={f.cc} onChange={(e) => setF({ ...f, cc: e.target.value })} placeholder="Copies (optional), separated with commas" /></label>
    </div>
  );
}

export default function AdminSuppliers() {
  const [sup, setSup] = useState(null);
  const [routes, setRoutes] = useState([]);
  const [msg, setMsg] = useState(null);
  const load = async () => {
    const [a, b] = await Promise.all([supabase.from('suppliers').select('*').order('name'), supabase.from('supplier_routes').select('*').order('sort').order('id')]);
    if (a.error || b.error) setMsg({ bad: true, text: (a.error || b.error).message });
    setSup(a.data || []); setRoutes(b.data || []);
  };
  useEffect(() => { load(); }, []);

  const addSupplier = async () => {
    const name = (window.prompt('Supplier name:') || '').trim(); if (!name) return;
    const { error } = await supabase.from('suppliers').insert({ name });
    if (error) setMsg({ bad: true, text: /duplicate/i.test(error.message) ? name + ' is already a supplier.' : error.message }); else load();
  };
  const addRoute = async (s) => { const { error } = await supabase.from('supplier_routes').insert({ supplier_id: s.id, sort: routes.filter((r) => r.supplier_id === s.id).length + 1 }); if (error) setMsg({ bad: true, text: error.message }); else load(); };
  const removeRoute = async (r) => { if (!window.confirm('Remove this way of ordering (' + (r.portal || 'email only') + ')?')) return; const { error } = await supabase.from('supplier_routes').delete().eq('id', r.id); if (error) setMsg({ bad: true, text: error.message }); else load(); };
  const toggleSupplier = async (s) => { const { error } = await supabase.from('suppliers').update({ active: !s.active, updated_at: new Date().toISOString() }).eq('id', s.id); if (error) setMsg({ bad: true, text: error.message }); else load(); };
  const rename = async (s) => { const name = (window.prompt('Supplier name:', s.name) || '').trim(); if (!name || name === s.name) return; const { error } = await supabase.from('suppliers').update({ name }).eq('id', s.id); if (error) setMsg({ bad: true, text: error.message }); else load(); };
  const patch = (id, row) => setRoutes((rs) => rs.map((r) => (r.id === id ? { ...r, ...row } : r)));

  return (
    <>
      <PageHeader title="SUPPLIERS" sub="Who Direct orders from, through which portal, and where each purchase order is emailed." back={<Link to="/admin" className="page-back"><Icon name="back" size={14} /> Admin</Link>} />
      <div className="ad">
        {msg && <p className={msg.bad ? 'msg bad' : 'msg'} role="status">{msg.text}</p>}
        {sup === null ? <div className="empty">Loading…</div> : sup.map((s) => (
          <section key={s.id} className={'ad-sec' + (s.active ? '' : ' sp-off')}>
            <div className="ad-left">
              <h2>{s.name}</h2>
              <p>{routes.filter((r) => r.supplier_id === s.id).map((r) => r.portal || 'Email only').join(' · ') || 'No way of ordering yet'}</p>
              <p className="sp-left-acts"><button type="button" className="link" onClick={() => rename(s)}>Rename</button> · <button type="button" className="link" onClick={() => toggleSupplier(s)}>{s.active ? 'Switch off' : 'Switch on'}</button></p>
            </div>
            <div className="ad-card sp-card">
              {routes.filter((r) => r.supplier_id === s.id).map((r) => <Route key={r.id + ':' + r.updated_at} r={r} onSaved={patch} onRemove={removeRoute} />)}
              <button type="button" className="sp-add" onClick={() => addRoute(s)}>+ Another portal or email for {s.name}</button>
            </div>
          </section>
        ))}
        <div><button type="button" className="btn" onClick={addSupplier}>+ Supplier</button></div>
      </div>
    </>
  );
}
