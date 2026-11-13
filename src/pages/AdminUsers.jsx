import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../auth/AuthProvider.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Icon from '../components/Icon.jsx';
import AddPerson, { resetPassword, removeLogin } from '../components/AddPerson.jsx';

/* Admin > Users (13 Nov 2026), laid out as OrderConcrete's with Direct's roles: tiles (can sign in, no login yet, needs a
   role, everyone), search, role chips with counts, people grouped by role with Show / Hide, select for a bulk sign-in
   link or switch-off, and per person: role, status, last signed in, and the actions. */
const ROLES = [['admin', 'Admin'], ['office', 'Office'], ['warehouse', 'Warehouse'], ['driver', 'Driver']];
const ROLE = Object.fromEntries(ROLES);
const when = (t) => (t ? new Date(t).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
const initials = (x) => { const w = String(x.name || x.email.split('@')[0]).trim().split(/[\s._-]+/).filter(Boolean); return ((w[0] || '')[0] || '').toUpperCase() + ((w[1] || w[0] || '')[w[1] ? 0 : 1] || '').toUpperCase(); };
const AV = ['#DCFCE7:#166534', '#DBEAFE:#1E40AF', '#FEF3C7:#92400E', '#FCE7F3:#9D174D', '#E0E7FF:#3730A3', '#CCFBF1:#115E59'];
const avatar = (e) => { let h = 0; for (const c of e) h = (h * 31 + c.charCodeAt(0)) >>> 0; const [bg, fg] = AV[h % AV.length].split(':'); return { background: bg, color: fg }; };

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
  const [editing, setEditing] = useState(null);

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

  const save = async (email, patch) => { const { error } = await supabase.from('staff').update({ ...patch, updated_at: new Date().toISOString() }).eq('email', email); if (error) say(true, error.message); else load(); };
  const giveRole = async (x, r) => { if (!r) return; const { error } = await supabase.from('staff').insert({ email: x.email, name: x.name || '', role: r }); if (error) say(true, error.message); else { say(false, x.email + ' can now sign in as ' + ROLE[r] + '.'); load(); } };
  const rename = async (x) => { const name = window.prompt('Name for ' + x.email + ':', x.name || ''); if (name === null || name.trim() === x.name) return; save(x.email, { name: name.trim() }); };
  const invite = async (emails) => {
    let ok = 0, bad = [];
    for (const email of emails) { const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: window.location.origin } }); if (error) bad.push(email + ': ' + error.message); else ok++; }
    say(!!bad.length, (ok ? 'Sign-in link emailed to ' + ok + (ok === 1 ? ' person' : ' people') + '. ' : '') + bad.join(' · '));
  };
  const reset = async (x) => { if (!window.confirm('Give ' + (x.name || x.email) + ' a new temporary password' + ' and email it to them?')) return;
    try { const r = await resetPassword(x); say(false, (x.name || x.email) + ': new temporary password ' + r.password + (r.emailed ? ', emailed to them.' : '. EmailJS is not set up: give it to them yourself.')); } catch (e) { say(true, e.message); } };
  const remove = async (x) => {
    if (!window.confirm('Remove ' + (x.name || x.email) + '? They come off the list and their login is deleted, so they can no longer sign in. (To stop them for a while instead, use Edit and switch them off.)')) return;
    try { await removeLogin(x.email); } catch (e) { say(true, e.message); return; }
    if (x.on_list) { const { error } = await supabase.from('staff').delete().eq('email', x.email); if (error) { say(true, error.message); return; } }
    say(false, (x.name || x.email) + ' removed.'); load(); };
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
            <button type="button" className="btn btn-red us-addbtn" onClick={() => setAdding(true)}>+ Add person</button>
          </div>
        </div>
        {msg && <p className={msg.bad ? 'msg bad' : 'msg'} role="status">{msg.text}</p>}
        {adding && <AddPerson onClose={() => setAdding(false)} onDone={(m) => { setAdding(false); setMsg(m); load(); }} />}
        {editing && <AddPerson person={editing} myEmail={me.email} onClose={() => setEditing(null)} onDone={(m) => { setEditing(null); setMsg(m); load(); }} />}
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
                      <td><label className="us-p"><input type="checkbox" disabled={!x.on_list} checked={!!sel[x.email]} onChange={(e) => setSel({ ...sel, [x.email]: e.target.checked })} aria-label={'Select ' + x.email} /><span className="us-av" style={avatar(x.email)} aria-hidden="true">{initials(x)}</span><span><b>{x.name || x.email}</b><small>{x.email}</small></span></label></td>
                      <td>{x.on_list ? <span className={'us-role us-r-' + x.role}>{(ROLE[x.role] || x.role).toUpperCase()}</span>
                        : <select className="pp-pick us-need" defaultValue="" onChange={(e) => giveRole(x, e.target.value)} aria-label={'Give ' + x.email + ' a role'}><option value="">Give a role…</option>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}</td>
                      <td>{!x.on_list ? <span className="us-tag us-t-need">No role</span> : !x.active ? <span className="us-tag us-t-off">Switched off</span> : x.has_login ? <span className="us-tag us-t-ok">Can sign in</span> : <span className="us-tag us-t-wait">No login yet</span>}</td>
                      <td className="us-last">{x.last_sign_in ? when(x.last_sign_in) : <span className="pp-muted">Never</span>}</td>
                      <td className="r us-acts">
                        {x.on_list && <button type="button" className="us-edit" onClick={() => setEditing(x)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg> Edit</button>}
                        {x.on_list && x.active && <button type="button" className="us-ico" onClick={() => (x.has_login ? reset(x) : invite([x.email]))} title={x.has_login ? 'Reset password (emailed)' : 'Invite: email a sign-in link'} aria-label={(x.has_login ? 'Reset password of ' : 'Invite ') + x.email}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M8.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19 8v6M22 11h-6" /></svg></button>}
                        {x.email !== me.email && <button type="button" className="us-ico us-del" onClick={() => remove(x)} title="Remove" aria-label={'Remove ' + x.email}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" /></svg></button>}
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
