import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import PageHeader from '../components/PageHeader.jsx';
import Icon from '../components/Icon.jsx';

/* Admin > Xero (13 Nov 2026): every upload waiting to go to Xero, sales orders (invoices) apart from purchase orders, each
   marked creating, updating or deleting, with its state and the reason when it failed, and "Sync now" to send it. */
const cash = (v) => (v == null ? '' : '$' + Number(v).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const when = (t) => (t ? new Date(t).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
const ACT = { create: 'Creating', update: 'Updating', delete: 'Deleting' };
const ST = { waiting: 'Waiting', sending: 'Sending…', failed: 'Failed', done: 'In Xero' };

function Queue({ title, sub, rows, busy, onSend }) {
  return (
    <section className="ad-sec">
      <div className="ad-left"><h2>{title} <span className="xq-n">{rows.filter((r) => r.status !== 'done').length}</span></h2><p>{sub}</p></div>
      <div className="ad-card">
        {!rows.length && <div className="xq-empty">Nothing waiting: everything is in Xero.</div>}
        {rows.map((r) => (
          <div key={r.id} className={'xq-row xq-' + r.status}>
            <span className={'xq-act xq-a-' + r.action}>{ACT[r.action]}</span>
            <span className="xq-main"><b>{r.ref || '#' + r.id}</b><small>{r.party}{r.amount != null ? ' · ' + cash(r.amount) : ''} · queued {when(r.created_at)}{r.created_by ? ' by ' + r.created_by.split('@')[0] : ''}{r.attempts ? ' · ' + r.attempts + ' attempt' + (r.attempts === 1 ? '' : 's') : ''}</small>
              {r.status === 'failed' && r.last_error && <small className="xq-err">{r.last_error}</small>}
              {r.status === 'done' && <small className="xq-ok">Sent {when(r.sent_at)}{r.sent_by ? ' by ' + r.sent_by.split('@')[0] : ''}</small>}</span>
            <span className={'xq-st xq-s-' + r.status}>{ST[r.status]}</span>
            {r.status !== 'done' && <button type="button" className="btn btn-red xq-btn" disabled={busy === r.id || r.status === 'sending'} onClick={() => onSend(r)}><Icon name="sync" size={14} /> {busy === r.id ? 'Sending…' : 'Sync now'}</button>}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function AdminXero() {
  const [rows, setRows] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const load = async () => {
    let q = supabase.from('xero_queue').select('*').order('created_at', { ascending: true });
    q = done ? q.limit(300) : q.neq('status', 'done');
    const { data, error } = await q; if (error) setMsg({ bad: true, text: error.message }); setRows(data || []);
  };
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [done]);
  const send = async (r) => {
    setBusy(r.id); setMsg(null);
    const { data, error } = await supabase.functions.invoke('xero', { body: { action: 'send_queue', id: r.id } });
    let m = data?.error; if (error) { m = error.message; try { const b = await error.context.json(); m = b.error || m; } catch { /* as it is */ } }
    setMsg(m ? { bad: true, text: (r.ref || '#' + r.id) + ': ' + m } : { text: (r.ref || '#' + r.id) + ' is in Xero.' });
    setBusy(null); load();
  };
  const all = rows || [];
  return (
    <>
      <PageHeader title="XERO" sub="Everything waiting to go to Xero: sales orders (invoices) and purchase orders, creating, updating or deleting. Sync now sends one straight away." back={<Link to="/admin" className="page-back"><Icon name="back" size={14} /> Admin</Link>} />
      <div className="ad">
        <div className="xq-bar">
          <span>{rows === null ? 'Loading…' : all.filter((r) => r.status === 'failed').length ? <b className="xq-err">{all.filter((r) => r.status === 'failed').length} failed</b> : 'No failures'} · {all.filter((r) => r.status === 'waiting').length} waiting</span>
          <label className="xq-done"><input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} /> Also show what has gone</label>
        </div>
        {msg && <p className={msg.bad ? 'msg bad' : 'msg'} role="status">{msg.text}</p>}
        <Queue title="Sales orders" sub="Invoices to Xero, one per order." rows={all.filter((r) => r.kind === 'SO')} busy={busy} onSend={send} />
        <Queue title="Purchase orders" sub="Purchase orders to Xero, one per supplier order." rows={all.filter((r) => r.kind === 'PO')} busy={busy} onSend={send} />
      </div>
    </>
  );
}
