import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../auth/AuthProvider.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Icon from '../components/Icon.jsx';

/* Admin > Users: everyone who may sign in (the staff table), their role, and access on or off. Adding someone gives them
   access; "Email a sign-in link" sends them a link that also makes their login the first time. */
const ROLES = [['admin', 'Admin'], ['office', 'Office'], ['warehouse', 'Warehouse'], ['driver', 'Driver']];

export default function AdminUsers() {
  const { staff: me } = useAuth();
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState({ email: '', name: '', role: 'office' });
  const [msg, setMsg] = useState(null);
  const load = () => supabase.from('staff').select('*').order('active', { ascending: false }).order('name').then(({ data, error }) => { if (error) setMsg({ bad: true, text: error.message }); setRows(data || []); });
  useEffect(() => { load(); }, []);
  const say = (bad, text) => setMsg({ bad, text });

  const add = async (e) => {
    e.preventDefault();
    const email = form.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return say(true, 'Enter a valid email.');
    const { error } = await supabase.from('staff').insert({ email, name: form.name.trim(), role: form.role });
    if (error) return say(true, /duplicate/i.test(error.message) ? email + ' is already on the list.' : error.message);
    setForm({ email: '', name: '', role: 'office' }); say(false, email + ' added. Use "Email a sign-in link" to invite them.'); load();
  };
  const save = async (email, patch) => {
    const { error } = await supabase.from('staff').update({ ...patch, updated_at: new Date().toISOString() }).eq('email', email);
    if (error) say(true, error.message); else load();
  };
  const invite = async (email) => {
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: window.location.origin } });
    say(!!error, error ? error.message : 'Sign-in link emailed to ' + email + '.');
  };

  return (
    <>
      <PageHeader title="USERS" sub="Who can sign in to the portal, and what each of them sees." back={<Link to="/admin" className="page-back"><Icon name="back" size={14} /> Admin</Link>} />
      <div className="ad">
        <section className="ad-sec">
          <div className="ad-left"><h2>Add someone</h2><p>They can sign in once they are here. Send them a sign-in link, or set a password for them in Supabase.</p></div>
          <form className="ad-card ad-form" onSubmit={add}>
            <label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@directbuildingmaterial.com.au" required /></label>
            <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="First name and initial" /></label>
            <label>Role<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <button type="submit" className="btn btn-red">Add</button>
          </form>
        </section>
        {msg && <p className={msg.bad ? 'msg bad ad-msg' : 'msg ad-msg'} role="status">{msg.text}</p>}
        <section className="ad-sec">
          <div className="ad-left"><h2>Everyone</h2><p>Change a role or switch someone's access off. Switching off keeps them on the list, so it can be switched back on.</p></div>
          <div className="ad-card">
            {rows === null ? <div className="ad-row ad-off">Loading…</div> : rows.map((r) => (
              <div key={r.email} className={'ad-row ad-user' + (r.active ? '' : ' ad-inactive')}>
                <span className="ad-ic"><Icon name="users" size={18} /></span>
                <span className="ad-tx"><b>{r.name || r.email}</b><small>{r.email}</small></span>
                <select aria-label={'Role of ' + r.email} value={r.role} disabled={r.email === me.email} onChange={(e) => save(r.email, { role: e.target.value })}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                <button type="button" className="btn" disabled={r.email === me.email} onClick={() => save(r.email, { active: !r.active })}>{r.active ? 'Switch off' : 'Switch on'}</button>
                <button type="button" className="btn" disabled={!r.active} onClick={() => invite(r.email)}>Email a sign-in link</button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
