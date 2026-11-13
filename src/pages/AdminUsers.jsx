import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../auth/AuthProvider.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Icon from '../components/Icon.jsx';

/* Admin > Users (13 Nov 2026), laid out as OrderConcrete's with Direct's roles: tiles (can sign in, no login yet, needs a
   role, everyone), search, role chips with counts, people grouped by role with Show / Hide, select for a bulk sign-in
   link or switch-off, and per person: role, status, last signed in, and the actions. */
const ROLES = [['admin', 'Admin'], ['office', 'Office'], ['warehouse', 'Warehouse'], ['driver', 'Driver']];
const ROLE = Object.fromEntries(ROLES);
const when = (t) => (t ? new Date(t).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

export default function AdminUsers() {
  const { staff: me } = useAuth();
  const [rows, setRows] = useState(null);
  const [msg, setMsg] = useState(null);
  const [tile, setTile] = useState('signin');
  const [role, setRole] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState({});
  const [sel, setSel] = useState({});
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ email: '', name: '', role: 'office' });

  const load = async () => { const { data, error } = await supabase.rpc('staff_overview'); if (error) setMsg({ bad: true, text: error.message }); setRows(data || []); };
  useEffect(() => { load(); }, []);
  const say = (bad, text) => setMsg({ bad, text });

  const T = useMemo(() => {
    const r = rows || [];
    return { signin: r.filter((x) => x.on_list && x.active && x.has_login), nologin: r.filter((x) => x.on_list && x.active && !x.has_login), needs: r.filter((x) => !x.on_list), all: r };
  }, [rows]);
  const base = tile === 'signin' ? T.signin : tile === 'nologin' ? T.nologin : tile === 'needs' ? T.needs : T.all;
  const list = useMemo(() => { const t = q.trim().toLowerCase(); return base.filter((x) => (!role || x.role === role) && (!t || (x.name + ' ' + x.email + ' ' + (ROLE[x.role] || '')).toLowerCase().includes(t))); }, [base, role, q]);
  const groups = useMemo(() => [...ROLES.map(([k, l]) => ({ key: k, label: l })), { key: '', label: 'Needs a role' }].map((g) => ({ ...g, rows: list.filter((x) => (x.on_list ? x.role : '') === g.key) })).filter((g) => g.rows.length), [list]);
  const isOpen = (k) => !!q.trim() || open[k] !== false;
  const chosen = list.filter((x) => sel[x.email]);

  const add = async (e) => {
    e.preventDefault();
    const email = form.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return say(true, 'Enter a valid email.');
    const { error } = await supabase.from('staff').insert({ email, name: form.name.trim(), role: form.role });
    if (error) return say(true, /duplicate/i.test(error.message) ? email + ' is already on the list.' : error.message);
    setForm({ email: '', name: '', role: 'office' }); setAdding(false); say(false, email + ' added. Use "Email sign-in link" to invite them.'); load();
  };
  const save = async (email, patch) => { const { error } = await supabase.from('staff').update({ ...patch, updated_at: new Date().toISOString() }).eq('email', email); if (error) say(true, error.message); else load(); };
  const giveRole = async (x, r) => { if (!r) return; const { error } = await supabase.from('staff').insert({ email: x.email, name: x.name || '', role: r }); if (error) say(true, error.message); else { say(false, x.email + ' can now sign in as ' + ROLE[r] + '.'); load(); } };
  const rename = async (x) => { const name = window.prompt('Name for ' + x.email + ':', x.name || ''); if (name === null || name.trim() === x.name) return; save(x.email, { name: name.trim() }); };
  const invite = async (emails) => {
    let ok = 0, bad = [];
    for (const email of emails) { const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: window.location.origin } }); if (error) bad.push(email + ': ' + error.message); else ok++; }
    say(!!bad.length, (ok ? 'Sign-in link emailed to ' + ok + (ok === 1 ? ' person' : ' people') + '. ' : '') + bad.join(' · '));
  };
  const switchOff = async (emails) => { if (!window.confirm('Switch off ' + emails.length + (emails.length === 1 ? ' person' : ' people') + '? They stay on the list and can be switched back on.')) return;
    const { error } = await supabase.from('staff').update({ active: false, updated_at: new Date().toISOString() }).in('email', emails.filter((e) => e !== me.email)); if (error) say(true, error.message); else { setSel({}); load(); } };

  const tiles = [['signin', 'Can sign in', T.signin.length, 'signin'], ['nologin', 'No login yet', T.nologin.length, 'dash'], ['needs', 'Needs a role', T.needs.length, 'warn'], ['all', 'Everyone', T.all.length, 'search']];
  const roleCount = (k) => base.filter((x) => x.role === k).length;

  return (
    <>
      <PageHeader title="USERS" sub="Who can sign in to the portal, and what each of them sees." back={<Link to="/admin" className="page-back"><Icon name="back" size={14} /> Admin</Link>} />
      <div className="ad us">
        <div className="us-tiles">
          {tiles.map(([k, l, n, ic]) => (
            <button key={k} type="button" className={'us-tile' + (tile === k ? ' on' : '')} onClick={() => { setTile(k); setRole(''); setSel({}); }} aria-pressed={tile === k}>
              <span className="us-ti"><Icon name={ic === 'signin' ? 'logout' : ic === 'search' ? 'list' : ic === 'warn' ? 'admin' : 'users'} size={18} /></span>
              <span><b>{rows === null ? '…' : n}</b><small>{l}</small></span>
            </button>
          ))}
        </div>
        <div className="us-find">
          <div className="us-search"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email…" aria-label="Search people" /></div>
          <div className="us-chips" role="group" aria-label="Roles">
            <button type="button" className={'us-chip' + (!role ? ' on' : '')} onClick={() => setRole('')}>All roles <b>{base.length}</b></button>
            {ROLES.map(([k, l]) => <button key={k} type="button" className={'us-chip' + (role === k ? ' on' : '')} onClick={() => setRole(role === k ? '' : k)}>{l} <b>{roleCount(k)}</b></button>)}
            <button type="button" className="btn btn-red us-addbtn" onClick={() => setAdding(!adding)}>{adding ? 'Close' : '+ Add person'}</button>
          </div>
          {adding && (
            <form className="us-add" onSubmit={add}>
              <label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@directbuildingmaterial.com.au" required /></label>
              <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="First name and initial" /></label>
              <label>Role<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              <button type="submit" className="btn btn-red">Add</button>
            </form>
          )}
        </div>
        {msg && <p className={msg.bad ? 'msg bad' : 'msg'} role="status">{msg.text}</p>}
        <div className="us-card">
          <div className="us-top">
            <label className="us-all"><input type="checkbox" checked={!!list.length && chosen.length === list.filter((x) => x.on_list).length} onChange={(e) => setSel(e.target.checked ? Object.fromEntries(list.filter((x) => x.on_list).map((x) => [x.email, true])) : {})} /> SELECT ALL {list.length} SHOWN</label>
            {chosen.length > 0 && <span className="us-bulk"><b>{chosen.length} selected</b><button type="button" className="btn" onClick={() => invite(chosen.map((x) => x.email))}>Email sign-in link</button><button type="button" className="btn" onClick={() => switchOff(chosen.map((x) => x.email))}>Switch off</button></span>}
            <span className="us-sh"><button type="button" className="link" onClick={() => setOpen({})}>Show all</button><button type="button" className="link" onClick={() => setOpen(Object.fromEntries(groups.map((g) => [g.key, false])))}>Hide all</button></span>
          </div>
          <table className="us-table">
            <thead><tr><th>Person</th><th>Role</th><th>Status</th><th>Last signed in</th><th className="r">Actions</th></tr></thead>
            <tbody>
              {rows === null && <tr><td colSpan="5" className="pp-empty">Loading…</td></tr>}
              {rows !== null && !groups.length && <tr><td colSpan="5" className="pp-empty">Nobody here.</td></tr>}
              {groups.map((g) => (
                <Fragment key={g.key || '-'}>
                  <tr className="us-grp"><td colSpan="5">
                    <label className="us-gsel"><input type="checkbox" disabled={!g.key} checked={g.rows.every((x) => sel[x.email])} onChange={(e) => setSel({ ...sel, ...Object.fromEntries(g.rows.filter((x) => x.on_list).map((x) => [x.email, e.target.checked])) })} aria-label={'Select every ' + g.label} /></label>
                    <b>{g.label}</b> <span className="us-gn">{g.rows.length}</span>
                    <button type="button" className="us-gtog" onClick={() => setOpen({ ...open, [g.key]: !isOpen(g.key) })} aria-expanded={isOpen(g.key)}>{isOpen(g.key) ? '▾ Hide' : '▸ Show'}</button>
                  </td></tr>
                  {isOpen(g.key) && g.rows.map((x) => (
                    <tr key={x.email} className={x.on_list && !x.active ? 'us-off' : ''}>
                      <td><label className="us-p"><input type="checkbox" disabled={!x.on_list} checked={!!sel[x.email]} onChange={(e) => setSel({ ...sel, [x.email]: e.target.checked })} aria-label={'Select ' + x.email} /><span><b>{x.name || x.email.split('@')[0]}</b><small>{x.email}</small></span></label></td>
                      <td>{x.on_list
                        ? <select className="pp-pick" value={x.role} disabled={x.email === me.email} onChange={(e) => save(x.email, { role: e.target.value })} aria-label={'Role of ' + x.email}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                        : <select className="pp-pick us-need" defaultValue="" onChange={(e) => giveRole(x, e.target.value)} aria-label={'Give ' + x.email + ' a role'}><option value="">Give a role…</option>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}</td>
                      <td>{!x.on_list ? <span className="us-tag us-t-need">No role</span> : !x.active ? <span className="us-tag us-t-off">Switched off</span> : x.has_login ? <span className="us-tag us-t-ok">Can sign in</span> : <span className="us-tag us-t-wait">No login yet</span>}</td>
                      <td className="us-last">{x.last_sign_in ? when(x.last_sign_in) : <span className="pp-muted">Never</span>}</td>
                      <td className="r us-acts">
                        {x.on_list && <button type="button" className="link" onClick={() => rename(x)}>Rename</button>}
                        {x.on_list && x.active && <button type="button" className="link" onClick={() => invite([x.email])}>{x.has_login ? 'Sign-in link' : 'Invite'}</button>}
                        {x.on_list && x.email !== me.email && <button type="button" className="link" onClick={() => (x.active ? switchOff([x.email]) : save(x.email, { active: true }))}>{x.active ? 'Switch off' : 'Switch on'}</button>}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
