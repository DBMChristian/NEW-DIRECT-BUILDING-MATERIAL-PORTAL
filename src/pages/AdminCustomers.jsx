import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../auth/AuthProvider.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Icon from '../components/Icon.jsx';

/* Admin > Customers (13 Nov 2026): every Xero contact (Sync from Xero, and by itself every 30 minutes), with what Direct
   keeps on top: COD or account, the customer's price list, and the team's notes, shown on every order of theirs.
   Click a customer to see and write their notes. */
const when = (t) => (t ? new Date(t).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
/* Xero's sales terms, in words: 30 / DAYSAFTERBILLMONTH is "30 days EOM" */
const ord = (n) => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');
const termsText = (c) => { const d = c.xero_terms_day ?? c.day, t = c.xero_terms_type ?? c.type; if (!t || d == null) return '';
  return t === 'DAYSAFTERBILLDATE' ? d + ' days' : t === 'DAYSAFTERBILLMONTH' ? d + ' days EOM' : t === 'OFCURRENTMONTH' ? ord(d) + ' of the month' : t === 'OFFOLLOWINGMONTH' ? ord(d) + ' of next month' : d + ' ' + t.toLowerCase(); };
async function xero(action, extra = {}) {
  const { data, error } = await supabase.functions.invoke('xero', { body: { action, ...extra } });
  if (error) { let m = error.message; try { const b = await error.context.json(); m = b.error || (b.contacts && b.contacts.error) || m; } catch { /* as it is */ } throw new Error(m); }
  if (data?.error) throw new Error(data.error);
  return data;
}

/* the credit limit: typed, saved when you leave the box; empty = no limit */
function Limit({ c, canEdit, onSave }) {
  const [v, setV] = useState(c.credit_limit ?? '');
  useEffect(() => { setV(c.credit_limit ?? ''); }, [c.credit_limit]);
  const save = () => { const n = String(v).trim() === '' ? null : Number(String(v).replace(/[^0-9.]/g, ''));
    if (n !== null && !Number.isFinite(n)) { setV(c.credit_limit ?? ''); return; }
    if (n === (c.credit_limit == null ? null : Number(c.credit_limit))) return; onSave(c, { credit_limit: n }); };
  return <span className="cu-lim"><i>$</i><input inputMode="decimal" value={v} disabled={!canEdit} placeholder="No limit" onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} aria-label={'Credit limit of ' + c.name} /></span>;
}

/* the history: every change on this page, who made it and when, from what to what */
const FIELD = { name: 'Name', email: 'Email', phone: 'Phone', mobile: 'Mobile', street: 'Street', suburb: 'Suburb', state: 'State', postcode: 'Postcode', abn: 'ABN',
  account_number: 'Xero account no.', is_customer: 'Customer in Xero', is_supplier: 'Supplier in Xero', xero_status: 'Xero status', in_xero: 'In Xero',
  xero_terms_day: 'Xero terms (day)', xero_terms_type: 'Xero terms (type)', terms: 'COD or account', price_list: 'Price list', credit_limit: 'Credit limit', on_hold: 'On hold', note: 'Note' };
function showVal(f, v, lists) {
  if (v === null || v === undefined || v === '') return '—';
  if (f === 'terms') return v === 'account' ? 'Account' : 'COD';
  if (['on_hold', 'is_customer', 'is_supplier', 'in_xero'].includes(f)) return v === 'true' ? 'Yes' : 'No';
  if (f === 'credit_limit') return '$' + Number(v).toLocaleString('en-AU', { minimumFractionDigits: 2 });
  if (f === 'price_list') { const m = /^list:(\d+)$/.exec(v); return m ? ((lists.find((l) => String(l.id) === m[1]) || {}).name || 'A removed list') : v.charAt(0).toUpperCase() + v.slice(1); }
  return v;
}
function History({ rows, lists, withName }) {
  if (rows === null) return <p className="cu-none">Loading…</p>;
  if (!rows.length) return <p className="cu-none">No changes yet.</p>;
  return (
    <ol className="cu-hist">
      {rows.map((h) => (
        <li key={h.id}>
          <span className="cu-h-when">{when(h.at)}</span>
          <span className="cu-h-who" title={h.by_email}>{h.by_name || h.by_email}</span>
          <span className="cu-h-what">
            {withName && <b className="cu-h-cust">{h.customer_name}</b>}
            {h.action === 'Changed' ? <><b>{FIELD[h.field] || h.field}</b>: <s>{showVal(h.field, h.old_value, lists)}</s> → <em>{showVal(h.field, h.new_value, lists)}</em></>
              : h.action.startsWith('Note') ? <><b>{h.action}</b>{h.action === 'Note edited' ? <>: <s>{h.old_value}</s> → <em>{h.new_value}</em></> : <>: <em>{h.new_value || h.old_value}</em></>}</>
              : <b>{h.action}</b>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Notes({ c, notes, me, myName, onChange, lists }) {
  const [tab, setTab] = useState('notes');
  const [hist, setHist] = useState(null);
  useEffect(() => { if (tab === 'history') supabase.from('customer_history').select('*').eq('customer_id', c.id).order('at', { ascending: false }).limit(300).then(({ data }) => setHist(data || [])); }, [tab, c.id, notes]);
  const [histN, setHistN] = useState(null);
  useEffect(() => { supabase.from('customer_history').select('id', { count: 'exact', head: true }).eq('customer_id', c.id).then(({ count }) => setHistN(count ?? 0)); }, [c.id, notes, c.on_hold, c.terms, c.credit_limit, c.price_list]);
  const [text, setText] = useState('');
  const [edit, setEdit] = useState(null);
  const add = async () => { const t = text.trim(); if (!t) return; const { error } = await supabase.from('customer_notes').insert({ customer_id: c.id, text: t, by_email: me, by_name: myName }); if (!error) { setText(''); onChange(); } };
  const save = async () => { const t = edit.text.trim(); if (!t) return; const { error } = await supabase.from('customer_notes').update({ text: t, edited_by_name: myName, updated_at: new Date().toISOString() }).eq('id', edit.id); if (!error) { setEdit(null); onChange(); } };
  const del = async (n) => { if (!window.confirm('Delete this note?')) return; const { error } = await supabase.from('customer_notes').delete().eq('id', n.id); if (!error) onChange(); };
  return (
    <div className="cu-notes">
      <div className="cu-det">
        {[['Email', c.email], ['Phone', c.phone], ['Mobile', c.mobile], ['Address', [c.street, c.suburb, c.state, c.postcode].filter(Boolean).join(', ')], ['ABN', c.abn], ['Xero account no.', c.account_number]].filter((x) => x[1]).map(([k, v]) => <span key={k}><small>{k}</small>{v}</span>)}
      </div>
      <div className="cu-tabs" role="tablist"><button type="button" role="tab" aria-selected={tab === 'notes'} className={tab === 'notes' ? 'on' : ''} onClick={() => setTab('notes')}>Notes ({notes.length})</button><button type="button" role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>History{histN != null ? ' (' + histN + ')' : ''}</button></div>
      {tab === 'history' ? <History rows={hist} lists={lists} /> : <>
      <b className="cu-nh">Notes <small>shown in red on every order of {c.name}</small></b>
      {!notes.length && <p className="cu-none">No notes yet.</p>}
      {notes.map((n) => (
        <div key={n.id} className="cu-note">
          {edit && edit.id === n.id
            ? <><textarea value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} rows={2} /><div className="cu-na"><button type="button" className="btn btn-red" onClick={save}>Save</button><button type="button" className="link" onClick={() => setEdit(null)}>Cancel</button></div></>
            : <><p>{n.text}</p><small>Added by <b>{n.by_name || String(n.by_email || '').split('@')[0]}</b> · {when(n.created_at)}{n.edited_by_name ? <> · edited by <b>{n.edited_by_name}</b> · {when(n.updated_at)}</> : ''}</small>
              <div className="cu-na"><button type="button" className="link" onClick={() => setEdit({ id: n.id, text: n.text })}>Edit</button><button type="button" className="link" onClick={() => del(n)}>Delete</button></div></>}
        </div>
      ))}
      <div className="cu-add"><textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder={'A note about ' + c.name + ': delivery quirks, account notes…'} /><button type="button" className="btn btn-red" onClick={add} disabled={!text.trim()}>Add note</button></div>
      </>}
    </div>
  );
}

export default function AdminCustomers() {
  const { staff } = useAuth();
  const [rows, setRows] = useState(null);
  const [notes, setNotes] = useState({});
  const [lists, setLists] = useState([]);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const [q, setQ] = useState('');
  const [show, setShow] = useState('customers');
  const [terms, setTerms] = useState('');
  const [open, setOpen] = useState(null);
  const [n, setN] = useState(100);


  const load = async () => {
    const all = []; let f = 0;
    for (;;) { const { data, error } = await supabase.from('customers').select('*').order('name').range(f, f + 999); if (error) { setMsg({ bad: true, text: error.message }); break; } all.push(...(data || [])); if (!data || data.length < 1000) break; f += 1000; }
    setRows(all);
    loadNotes();
    const pl = await supabase.from('price_lists').select('id, name').order('sort').order('id'); setLists(pl.data || []);
  };
  const loadNotes = async () => {
    const by = {}; let f = 0;
    for (;;) { const { data } = await supabase.from('customer_notes').select('*').order('created_at', { ascending: false }).range(f, f + 999); (data || []).forEach((x) => { (by[x.customer_id] = by[x.customer_id] || []).push(x); }); if (!data || data.length < 1000) break; f += 1000; }
    setNotes(by);
  };
  const loadStatus = () => xero('status', { kind: 'contacts' }).then(setStatus).catch((e) => setStatus({ error: e.message }));
  useEffect(() => { load(); loadStatus(); }, []);

  const sync = async () => {
    setBusy('sync'); setMsg(null);
    try { const r = await xero('sync_contacts'); setMsg({ text: 'Synced ' + r.contacts + ' contacts from Xero: ' + r.added + ' new, ' + r.updated + ' updated' + (r.gone ? ', ' + r.gone + ' no longer in Xero' : '') + '.' }); await load(); }
    catch (e) { setMsg({ bad: true, text: e.message }); }
    loadStatus(); setBusy('');
  };
  const reconnect = async () => { setBusy('connect'); try { const r = await xero('connect', { return_to: window.location.origin + '/admin/customers' }); window.location.href = r.url; } catch (e) { setMsg({ bad: true, text: e.message }); setBusy(''); } };
  const setField = async (c, ch) => { const { error } = await supabase.from('customers').update({ ...ch, updated_at: new Date().toISOString() }).eq('id', c.id); if (error) setMsg({ bad: true, text: error.message }); else setRows((rs) => rs.map((r) => (r.id === c.id ? { ...r, ...ch } : r))); };

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (rows || []).filter((r) => (show === 'all' ? true : show === 'archived' ? (r.xero_status === 'ARCHIVED' || !r.in_xero) : r.xero_status !== 'ARCHIVED' && r.in_xero && (show === 'customers' ? r.is_customer || !r.is_supplier : show === 'notes' ? (notes[r.id] || []).length : show === 'hold' ? r.on_hold : r.is_supplier)) && (!terms || r.terms === terms)
      && (!t || [r.name, r.email, r.phone, r.mobile, r.suburb, r.abn, r.account_number].join(' ').toLowerCase().includes(t)));
  }, [rows, q, show, terms, notes]);
  const last = status?.last_sync;
  const canEdit = ['admin', 'office'].includes(staff.role);

  return (
    <>
      <PageHeader title="CUSTOMERS" sub="Every Xero contact, with COD or account, their price list and the team's notes. Notes show in red on every order of that customer." back={<Link to="/admin" className="page-back"><Icon name="back" size={14} /> Admin</Link>} />
      <div className="pp">
        <div className="pp-bar">
          <div className="pp-xero"><span className={'pp-dot' + (status?.connected ? ' on' : '')} />
            <span>{status === null ? 'Checking Xero…' : status.error ? 'Xero: ' + status.error : status.connected ? <>Xero: <b>{status.tenant}</b> · syncs by itself every 30 minutes{last ? <> · last {when(last.finished_at || last.started_at)}{/^auto/.test(last.by_email || '') ? ' (auto)' : ' by ' + String(last.by_email || '').split('@')[0]}{last.ok === false ? ' · failed: ' + (last.error || '') : ''}</> : ' · not synced yet'}</> : 'Xero is not connected (Admin › Products)'}</span></div>
          {status?.connected && <button type="button" className="btn btn-red" onClick={sync} disabled={!!busy}><Icon name="sync" size={15} /> {busy === 'sync' ? 'Syncing…' : 'Sync from Xero'}</button>}
          {status?.connected && <button type="button" className="link" onClick={reconnect} disabled={!!busy}>Reconnect</button>}
        </div>
        {msg && <p className={msg.bad ? 'msg bad' : 'msg'} role="status">{msg.text}</p>}
        <div className="pp-filters">
          <input type="search" className="pp-search" value={q} onChange={(e) => { setQ(e.target.value); setN(100); }} placeholder="Search a name, email, phone, suburb or ABN…" aria-label="Search customers" />
          <select value={show} onChange={(e) => { setShow(e.target.value); setN(100); }} aria-label="Show"><option value="customers">Customers</option><option value="notes">With notes</option><option value="hold">On hold</option><option value="suppliers">Suppliers</option><option value="archived">Archived or gone from Xero</option><option value="all">Everyone</option></select>
          <select value={terms} onChange={(e) => { setTerms(e.target.value); setN(100); }} aria-label="Terms"><option value="">COD and account</option><option value="cod">COD</option><option value="account">Account</option></select>
          <span className="pp-count">{rows === null ? 'Loading…' : list.length + ' of ' + rows.length + ' contacts'}</span>
        </div>
        <div className="pp-table-wrap">
          <table className="pp-table cu-table">
            <thead><tr><th>Customer</th><th>Email</th><th>Phone</th><th>COD or account</th><th>On hold</th><th>Credit limit</th><th>Xero terms</th><th>Price list</th><th>Notes</th></tr></thead>
            <tbody>
              {rows !== null && !list.length && <tr><td colSpan="9" className="pp-empty">{rows.length ? 'No customer matches.' : 'No customers yet: press Sync from Xero.'}</td></tr>}
              {list.slice(0, n).map((c) => {
                const cn = notes[c.id] || [];
                return (
                  <Fragment key={c.id}>
                    <tr className={'cu-row' + (open === c.id ? ' on' : '') + (c.in_xero && c.xero_status !== 'ARCHIVED' ? '' : ' pp-gone')}>
                      <td><button type="button" className="cu-name" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}><span>{open === c.id ? '▾' : '▸'}</span><b>{c.name}</b></button>{c.on_hold && <small className="cu-holdtag">ON HOLD</small>}{c.xero_status === 'ARCHIVED' && <small className="pp-tag">Archived in Xero</small>}</td>
                      <td className="cu-em">{c.email ? <a href={'mailto:' + c.email}>{c.email}</a> : <span className="pp-muted">—</span>}</td>
                      <td className="cu-ph">{c.mobile || c.phone ? <a href={'tel:' + (c.mobile || c.phone).replace(/[^0-9+]/g, '')}>{c.mobile || c.phone}</a> : <span className="pp-muted">—</span>}</td>
                      <td><select className="pp-pick" value={c.terms} disabled={!canEdit} onChange={(e) => setField(c, { terms: e.target.value })} aria-label={'Terms of ' + c.name}><option value="cod">COD</option><option value="account">Account</option></select></td>
                      <td><select className={'pp-pick cu-hold' + (c.on_hold ? ' on' : '')} value={c.on_hold ? 'yes' : 'no'} disabled={!canEdit} onChange={(e) => setField(c, { on_hold: e.target.value === 'yes' })} aria-label={'On hold: ' + c.name}><option value="no">No</option><option value="yes">Yes</option></select></td>
                      <td><Limit c={c} canEdit={canEdit} onSave={setField} /></td>
                      <td className="cu-terms">{termsText(c) || <span className="pp-muted" title="No terms on this contact in Xero: Xero's organisation default applies">{status?.default_terms ? termsText(status.default_terms) + ' (default)' : 'None in Xero'}</span>}</td>
                      <td><select className="pp-pick" value={c.price_list} disabled={!canEdit} onChange={(e) => setField(c, { price_list: e.target.value })} aria-label={'Price list of ' + c.name}><option value="builder">Builder</option><option value="installer">Installer</option><option value="online">Online</option>{lists.map((l) => <option key={l.id} value={'list:' + l.id}>{l.name}</option>)}</select></td>
                      <td>{cn.length ? <button type="button" className="cu-badge" onClick={() => setOpen(c.id)}>{cn.length} note{cn.length === 1 ? '' : 's'}</button> : <button type="button" className="link" onClick={() => setOpen(c.id)}>+ Note</button>}</td>
                    </tr>
                    {open === c.id && <tr className="cu-open"><td colSpan="9"><Notes c={c} notes={cn} me={staff.email} myName={staff.name || staff.email.split('@')[0]} onChange={loadNotes} lists={lists} /></td></tr>}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {list.length > n && <div className="pp-more"><button type="button" className="btn" onClick={() => setN(n + 200)}>Show more ({list.length - n} left)</button></div>}
      </div>
    </>
  );
}
