import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../auth/AuthProvider.jsx';
import PageHeader from '../components/PageHeader.jsx';

/* Home, option A as approved (13 Nov 2026): the day summed up in the header; one search bar for everything; the date
   filter (‹ day ›, Today, Tomorrow, This week); four columns: Pending (with On hold), the chosen day, COD balance and
   Website enquiries. Orders are not built yet, so Pending and the day are empty until New Order is. Search finds
   customers and enquiries now, orders and invoices as they come. */
const cash = (v) => '$' + Number(v || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ago = (t) => { const d = Math.floor((Date.now() - new Date(t).getTime()) / 86400000); return d <= 0 ? 'today' : d === 1 ? '1 day' : d + ' days'; };
const dayName = (d) => d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');   /* the local day (not UTC) */
const startOf = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

/* an enquiry in full: who, how to reach them, what they want, their plans, who has it, its status and notes */
const ESTATUS = [['new', 'New'], ['working', 'Working on it'], ['quoted', 'Quoted'], ['closed', 'Closed (lost)']];
function EnquiryPanel({ e, me, onClose, onSaved }) {
  const [notes, setNotes] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [cur, setCur] = useState(e);
  const loadNotes = () => supabase.from('enquiry_notes').select('*').eq('enquiry_id', e.id).order('created_at', { ascending: false }).then(({ data }) => setNotes(data || []));
  useEffect(() => { loadNotes(); }, [e.id]);
  const save = async (patch) => { setBusy(true); setErr(''); const { error } = await supabase.from('enquiries').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', e.id); setBusy(false); if (error) setErr(error.message); else { setCur({ ...cur, ...patch }); onSaved(); } };
  const addNote = async () => { const t = text.trim(); if (!t) return; setBusy(true); setErr('');
    const { error } = await supabase.from('enquiry_notes').insert({ enquiry_id: e.id, text: t, by_email: me.email, by_name: me.name || me.email.split('@')[0] });
    setBusy(false); if (error) setErr(error.message); else { setText(''); loadNotes(); } };
  const mine = cur.taken_by === me.email;
  const when = (t) => new Date(t).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  return (
    <div className="ap-wrap" role="dialog" aria-modal="true" aria-labelledby="en-t">
      <div className="ap">
        <header className="ap-h"><div><h3 id="en-t">{e.name || 'No name'}</h3><p>Website enquiry · {when(e.created_at)} · {ago(e.created_at)} ago</p></div><button type="button" className="ap-x" onClick={onClose} aria-label="Close">×</button></header>
        <section className="ap-s en-d">
          {[['Phone', e.phone && <a href={'tel:' + e.phone.replace(/[^0-9+]/g, '')}>{e.phone}</a>], ['Email', e.email && <a href={'mailto:' + e.email}>{e.email}</a>], ['Site address', e.site_address || e.location], ['Product', e.product], ['How warm', e.temp]].filter((x) => x[1]).map(([k, v]) => <div key={k}><small>{k}</small><span>{v}</span></div>)}
        </section>
        {e.message && <section className="ap-s"><h4>What they wrote</h4><p className="en-msg">{e.message}</p></section>}
        {e.attachment_url && <section className="ap-s"><h4>Their plans</h4><a className="hm-btn" href={e.attachment_url} target="_blank" rel="noreferrer">Open the file ↗</a></section>}
        <section className="ap-s">
          <h4>Who has it</h4>
          <p className="en-who">{cur.taken_by_name ? <><b>{cur.taken_by_name}</b>{mine ? ' (you)' : ''}</> : 'Nobody yet'}</p>
          {!mine && <button type="button" className="hm-btn hm-red-btn" disabled={busy} onClick={() => save({ status: cur.status === 'new' ? 'working' : cur.status, taken_by: me.email, taken_by_name: me.name || me.email.split('@')[0] })}>{cur.taken_by ? 'Take it over' : "I'll take it"}</button>}
          <label className="ap-f">STATUS<select value={cur.status} disabled={busy} onChange={(ev) => save({ status: ev.target.value })} className="en-sel">{ESTATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        </section>
        <section className="ap-s">
          <h4>Notes {notes && notes.length ? <span className="en-nc">{notes.length}</span> : null}</h4>
          <div className="en-add"><textarea rows={2} value={text} onChange={(ev) => setText(ev.target.value)} placeholder="Add a note: called, left a message; quote sent…" className="en-note" /><button type="button" className="btn btn-red" disabled={busy || !text.trim()} onClick={addNote}>Add note</button></div>
          {notes === null ? <p className="ap-sub">Loading…</p> : !notes.length ? <p className="ap-sub">No notes yet.</p> : notes.map((n) => (
            <div key={n.id} className="en-n"><p>{n.text}</p><small>Added by <b>{n.by_name || n.by_email}</b> · {when(n.created_at)}</small></div>
          ))}
          {err && <p className="msg bad">{err}</p>}
        </section>
        <div className="ap-foot"><button type="button" className="btn" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

/* the calendar under the date box: a month at a time, today marked, the chosen day dark (13 Nov 2026) */
function MonthPicker({ value, onPick, onClose }) {
  const [m, setM] = useState(new Date(value.getFullYear(), value.getMonth(), 1));
  const today = startOf(new Date());
  const first = (m.getDay() + 6) % 7;   /* Monday first */
  const days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => new Date(m.getFullYear(), m.getMonth(), i + 1))];
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="hm-cal" role="dialog" aria-label="Choose a day">
      <div className="hm-cal-h"><button type="button" aria-label="Month before" onClick={() => setM(new Date(m.getFullYear(), m.getMonth() - 1, 1))}>‹</button><b>{m.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}</b><button type="button" aria-label="Month after" onClick={() => setM(new Date(m.getFullYear(), m.getMonth() + 1, 1))}>›</button></div>
      <div className="hm-cal-g">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="hm-cal-w">{d}</span>)}
        {cells.map((d, i) => d ? <button key={i} type="button" className={'hm-cal-d' + (d.getTime() === value.getTime() ? ' on' : '') + (d.getTime() === today.getTime() ? ' now' : '')} onClick={() => onPick(d)}>{d.getDate()}</button> : <span key={i} />)}</div>
      <div className="hm-cal-f"><button type="button" className="link" onClick={() => onPick(today)}>Today</button><button type="button" className="link" onClick={onClose}>Close</button></div>
    </div>
  );
}

const CATC = { Concrete: '#CA8A04', Wafflepods: '#7C3AED', Rediwall: '#EA580C', Reinforcement: '#92400E', Hebel: '#2563EB', Bricks: '#B91C1C', NRG: '#16A34A', Bluedeck: '#0891B2', Others: '#78716C' };
function OrderCard({ g }) {
  return (
    <Link to={'/orders/' + g.id} className="hm-card hm-link" style={{ '--c': CATC[String(g.loads[0].category).split(', ')[0]] || '#78716C' }}>
      <div className="hm-row"><b>{g.o.customer_name}</b><span className="hm-ref">{g.o.number}</span><span className="hm-amt">{cash(Number(g.o.total))}</span></div>
      {g.loads.map((l) => <div key={l.id} className="hm-meta"><span className="hm-cdot" style={{ background: CATC[String(l.category).split(', ')[0]] || '#78716C' }} />{l.category} · {l.fulfil === 'pickup' ? 'Pick-up' : 'Delivery'}{l.want_date ? ' · wants ' + dayName(new Date(l.want_date + 'T00:00:00')) : ''}{l.want_time && l.want_time !== 'Any time' ? ' ' + l.want_time : ''}</div>)}
      <div className="hm-row"><span className="hm-chip" style={{ marginLeft: 0, background: g.o.terms === 'account' ? '#FEF3C7' : '#F5F5F4', color: g.o.terms === 'account' ? '#92400E' : '#44403C' }}>{g.o.terms === 'account' ? 'Account' : 'COD'}</span></div>
    </Link>
  );
}

function Col({ dot, title, sub, n, nColor, children, label }) {
  return (
    <section className="hm-col" aria-label={label || title}>
      <div className="hm-ch hm-ch-fill" style={{ background: dot }}><div><b>{title}</b><small>{sub}</small></div>{n != null && <span className="hm-n hm-n-fill" style={{ color: dot }}>{n}</span>}</div>
      {children}
    </section>
  );
}
function Tabs({ value, set, counts }) {
  return <div className="hm-tabs" role="group" aria-label="Delivery or pick-up">{[['all', 'All'], ['delivery', 'Delivery'], ['pickup', 'Pick-up']].map(([k, l]) => <button key={k} type="button" className={'hm-tab' + (value === k ? ' on' : '')} aria-pressed={value === k} onClick={() => set(k)}>{l} {counts[k]}</button>)}</div>;
}

export default function Home() {
  const { staff } = useAuth();
  const [day, setDay] = useState(startOf(new Date()));
  const range = 'day';   /* always one day: today, unless the arrows or the calendar move it (13 Nov 2026) */
  const [ptab, setPtab] = useState('all');
  const [dtab, setDtab] = useState('all');
  const [q, setQ] = useState('');
  const [cod, setCod] = useState(null);
  const [pend, setPend] = useState(null);
  const [booked, setBooked] = useState(null);
  const [enq, setEnq] = useState(null);
  const [codAll, setCodAll] = useState(false);
  const [hits, setHits] = useState(null);
  const [openEnq, setOpenEnq] = useState(null);
  const [calOpen, setCalOpen] = useState(false);

  const load = async () => {
    /* COD balance: the portal's own COD orders that still have money owing (13 Nov 2026). Orders are not in the new
       portal yet, so it stays empty until New Order is built; Xero's own invoices are not listed here. */
    /* COD balance: the placed COD orders still owing (total less the payments taken), oldest first */
    const co = await supabase.from('orders').select('id, number, customer_name, contact_phone, total, paid, placed_at').eq('status', 'placed').eq('kind', 'order').eq('terms', 'cod').order('placed_at', { ascending: true });
    setCod((co.data || []).map((x) => ({ ...x, owing: Math.round((Number(x.total) - Number(x.paid || 0)) * 100) / 100 })).filter((x) => x.owing > 0.005));
    /* Pending: the loads of placed orders not booked yet (on hold apart); the day: loads booked for it */
    const pl = await supabase.from('order_loads').select('id, order_id, category, fulfil, site_address, want_date, want_time, status, booked_date, booked_time, orders!inner(number, status, customer_name, total, terms)').eq('orders.status', 'placed').in('status', ['pending', 'on_hold', 'booked']);
    const rows = pl.data || [];
    setPend(rows.filter((r) => r.status !== 'booked'));
    setBooked(rows.filter((r) => r.status === 'booked'));
    const e = await supabase.from('enquiries').select('*').in('status', ['new', 'working']).order('created_at', { ascending: false });
    setEnq(e.data || []);
  };
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);

  /* search: customers and enquiries now; orders and invoices join when they are built */
  useEffect(() => {
    const t = q.trim(); if (t.length < 2) { setHits(null); return; }
    const like = '%' + t.replace(/[%_]/g, '') + '%';
    const h = setTimeout(async () => {
      /* Home's search is for orders (13 Nov 2026): the portal's orders once New Order is built, and website enquiries */
      const [ord, e] = await Promise.all([
        supabase.from('orders').select('id, number, status, kind, customer_name, contact_phone, their_po, total, placed_at').neq('status', 'draft').or(`number.ilike.${like},customer_name.ilike.${like},their_po.ilike.${like},contact_phone.ilike.${like},contact_name.ilike.${like}`).order('placed_at', { ascending: false }).limit(30),
        supabase.from('enquiries').select('*').or(`name.ilike.${like},phone.ilike.${like},email.ilike.${like},product.ilike.${like},site_address.ilike.${like}`).limit(20),
      ]);
      setHits({ customers: [], enquiries: e.data || [], orders: ord.data || [], invoices: [] });
    }, 200);
    return () => clearTimeout(h);
  }, [q]);

  const byOrder = (rs) => { const m = new Map(); (rs || []).forEach((r) => { const k = r.order_id; if (!m.has(k)) m.set(k, { id: k, o: r.orders, loads: [] }); m.get(k).loads.push(r); }); return [...m.values()]; };
  const fit = (g, tab) => tab === 'all' || g.loads.some((l) => (tab === 'pickup') === (l.fulfil === 'pickup'));
  const pendOrders = byOrder((pend || []).filter((r) => r.status === 'pending')), holdOrders = byOrder((pend || []).filter((r) => r.status === 'on_hold'));
  const dayOrders = byOrder((booked || []).filter((r) => r.booked_date === ymd(day)));
  const todayYmd = ymd(new Date());
  const isOver = (x) => x.status === 'AUTHORISED' && x.due_date && x.due_date < todayYmd;
  const codTotal = useMemo(() => (cod || []).reduce((a, x) => a + Number(x.owing || 0), 0), [cod]);
  const codOver = 0;
  const newEnq = (enq || []).filter((e) => e.status === 'new').length;
  const take = async (e) => { const { error } = await supabase.from('enquiries').update({ status: e.status === 'new' ? 'working' : e.status, taken_by: staff.email, taken_by_name: staff.name || staff.email.split('@')[0], updated_at: new Date().toISOString() }).eq('id', e.id); if (!error) load(); };
  const shift = (n) => { const d = new Date(day); d.setDate(d.getDate() + n * (range === 'week' ? 7 : 1)); setDay(d); };
  const today = startOf(new Date()), tomorrow = new Date(today.getTime() + 86400000);
  const dayLabel = day.getTime() === today.getTime() ? 'Today' : dayName(day);
  const hl = (s) => { const t = q.trim(); if (!t) return s; const i = String(s || '').toLowerCase().indexOf(t.toLowerCase()); if (i < 0) return s; return <>{s.slice(0, i)}<mark>{s.slice(i, i + t.length)}</mark>{s.slice(i + t.length)}</>; };
  const found = hits ? hits.customers.length + hits.enquiries.length + hits.orders.length + hits.invoices.length : 0;

  return (
    <>
      <PageHeader title="HOME" sub={new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }) + ' · ' + pendOrders.length + ' to book · ' + cash(codTotal) + ' COD owing · ' + newEnq + ' new enquir' + (newEnq === 1 ? 'y' : 'ies')} />
      {openEnq && <EnquiryPanel e={openEnq} me={staff} onClose={() => setOpenEnq(null)} onSaved={() => { setOpenEnq(null); load(); }} />}
      <div className="hm">
        <div className="hm-bar">
          <label className={'hm-search' + (q ? ' on' : '')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setQ(''); }} placeholder="Search an order: number, company, site, PO or phone…" aria-label="Search orders" />
            {q && <button type="button" className="hm-btn" onClick={() => setQ('')}>Clear</button>}
          </label>
          <div className="hm-date">
            <button type="button" aria-label={range === 'week' ? 'Week before' : 'Day before'} onClick={() => shift(-1)}>‹</button>
            <button type="button" className="hm-dpick" onClick={() => setCalOpen(!calOpen)} aria-expanded={calOpen} aria-label={'Choose a day: ' + dayName(day)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
              <span>{dayName(day)}</span>
            </button>
            {calOpen && <><div className="hm-cal-shade" aria-hidden="true" onClick={() => setCalOpen(false)} /><MonthPicker value={day} onPick={(d) => { setDay(d); setCalOpen(false); }} onClose={() => setCalOpen(false)} /></>}
            <button type="button" aria-label={range === 'week' ? 'Week after' : 'Day after'} onClick={() => shift(1)}>›</button>
          </div>
        </div>

        {hits ? (
          <div className="hm-results">
            <div className="hm-rbar"><span><b>{found} found</b> for "{q.trim()}"</span><span className="hm-esc">Esc or Clear goes back to Home</span></div>
                        <section className="hm-grp"><div className="hm-gh hm-gh-fill" style={{ background: '#B45309' }}>Orders <i>{hits.orders.length}</i></div>
              {!hits.orders.length && <div className="hm-hit hm-none">No order matches.</div>}
              {hits.orders.map((x) => <Link key={x.id} to={'/orders/' + x.id} className="hm-hit hm-link"><div><b>{hl(x.customer_name)} <span className="hm-ref">{hl(x.number || '')}</span></b><small>{[x.their_po && 'PO ' + x.their_po, x.contact_phone, x.placed_at && new Date(x.placed_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })].filter(Boolean).join(' · ')}</small></div>
                <span className={'hm-chip ' + (x.status === 'quote' ? 'hm-st-new' : x.status === 'cancelled' ? 'hm-st-closed' : 'hm-st-working')}>{x.status === 'quote' ? 'Quote' : x.status === 'cancelled' ? 'Cancelled' : 'Placed'}</span><span className="hm-amt">{cash(Number(x.total))}</span></Link>)}</section>
            {hits.enquiries.length > 0 && <section className="hm-grp"><div className="hm-gh hm-gh-fill" style={{ background: '#0E7490' }}>Website enquiries <i>{hits.enquiries.length}</i></div>
              {hits.enquiries.map((e) => <div key={e.id} className="hm-hit"><div><b>{hl(e.name)}</b><small>{[e.product, e.location, e.phone].filter(Boolean).join(' · ')} · {ago(e.created_at)}</small></div><span className={'hm-chip hm-st-' + e.status}>{(ESTATUS.find((x) => x[0] === e.status) || [, e.status])[1]}</span>{e.taken_by_name && <span className="hm-with">With <b>{e.taken_by_name}</b></span>}<button type="button" className="hm-btn" onClick={() => setOpenEnq(e)}>View details</button></div>)}</section>}
          </div>
        ) : (
          <div className="hm-cols">
            <Col dot="#B45309" title="Pending" sub="Not booked yet" n={pendOrders.length}>
              <Tabs value={ptab} set={setPtab} counts={{ all: pendOrders.length, delivery: pendOrders.filter((g) => fit(g, 'delivery')).length, pickup: pendOrders.filter((g) => fit(g, 'pickup')).length }} />
              <div className="hm-list">{pendOrders.filter((g) => fit(g, ptab)).length ? pendOrders.filter((g) => fit(g, ptab)).map((g) => <OrderCard key={g.id} g={g} />) : <div className="hm-empty">Nothing to book.</div>}</div>
              <div className="hm-sec"><span className="hm-dot" style={{ background: '#EA580C' }} />ON HOLD {holdOrders.length}</div>
              <div className="hm-list">{holdOrders.length ? holdOrders.map((g) => <OrderCard key={g.id} g={g} />) : <div className="hm-empty hm-small">No order on hold.</div>}</div>
            </Col>
            <Col dot="#15803D" title={dayLabel} sub={day.getTime() === today.getTime() ? dayName(day) + ' · booked for today' : 'Booked for this day'} n={dayOrders.length} nColor="#16A34A" label="The chosen day">
              <Tabs value={dtab} set={setDtab} counts={{ all: dayOrders.length, delivery: dayOrders.filter((g) => fit(g, 'delivery')).length, pickup: dayOrders.filter((g) => fit(g, 'pickup')).length }} />
              <div className="hm-list">{dayOrders.filter((g) => fit(g, dtab)).length ? dayOrders.filter((g) => fit(g, dtab)).map((g) => <OrderCard key={g.id} g={g} />) : <div className="hm-empty">No booked orders on {dayName(day)}.</div>}</div>
            </Col>
            <Col dot="#B91C1C" title="COD balance" sub={cod === null ? 'Loading…' : cash(codTotal) + ' owing on ' + cod.length + ' order' + (cod.length === 1 ? '' : 's') + (codOver ? ' · ' + cash(codOver) + ' overdue' : '')} n={cod ? cod.length : null}>
              <div className="hm-list hm-rows">
                {cod !== null && !cod.length && <div className="hm-empty">No COD orders with a balance. Orders placed in this portal show here while they still owe money.</div>}
                {(cod || []).slice(0, codAll ? 999 : 6).map((x) => (
                  <Link key={x.id} to={'/orders/' + x.id} className="hm-line hm-link"><div><b>{x.customer_name}</b>
                    <small>{x.number} · {ago(x.placed_at)} old{Number(x.paid) > 0 ? ' · paid ' + cash(x.paid) + ' of ' + cash(x.total) : ''}</small></div>
                    <span className="hm-amt hm-red">{cash(x.owing)}</span></Link>
                ))}
                {(cod || []).length > 6 && <button type="button" className="link hm-more" onClick={() => setCodAll(!codAll)}>{codAll ? 'Show fewer' : 'See all ' + cod.length}</button>}
              </div>
            </Col>
            <Col dot="#0E7490" title="Website enquiries" sub={enq === null ? 'Loading…' : newEnq + ' new · ' + ((enq || []).length - newEnq) + ' being worked on'} n={enq ? enq.length : null} nColor="#0891B2">
              <div className="hm-list">
                {enq !== null && !enq.length && <div className="hm-empty">No open enquiries. New ones from the website show here.</div>}
                {(enq || []).map((e) => (
                  <div key={e.id} className="hm-card" style={{ '--c': e.status === 'new' ? '#0891B2' : '#94A3B8' }}>
                    <div className="hm-row"><b>{e.name || 'No name'}</b><span className={'hm-chip hm-st-' + e.status}>{(ESTATUS.find((x) => x[0] === e.status) || [, e.status])[1]}</span></div>
                    <div className="hm-owner">{e.taken_by_name ? <>With <b>{e.taken_by_name}</b></> : 'Nobody has it yet'} · {ago(e.created_at)} ago</div>
                    <div className="hm-meta">{[e.product, e.site_address || e.location, e.phone].filter(Boolean).join(' · ')}</div>
                    {e.message && <div className="hm-msg">{e.message}</div>}
                    {e.attachment_url && <a className="hm-att" href={e.attachment_url} target="_blank" rel="noreferrer">Their plans ↗</a>}
                    <div className="hm-row hm-acts">{e.taken_by !== staff.email && <button type="button" className="hm-btn hm-red-btn" onClick={() => take(e)}>{e.taken_by ? 'Take it over' : "I'll take it"}</button>}<button type="button" className="hm-btn" onClick={() => setOpenEnq(e)}>View details</button></div>
                  </div>
                ))}
              </div>
            </Col>
          </div>
        )}
      </div>
    </>
  );
}
