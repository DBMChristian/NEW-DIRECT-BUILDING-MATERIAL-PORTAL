import { useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { emailReady, sendLoginEmail, tempPassword } from '../lib/emailjs.js';
import Icon from './Icon.jsx';
import { PAGES, defaultPages, sameSet } from '../lib/pages.js';

/* "Add a person", as OrderConcrete's (13 Nov 2026): their details, a role (Direct's four), and a portal login now with a
   temporary password, emailed to them by EmailJS. They choose their own password the first time they sign in. */
export const ROLE_CARDS = [
  ['office', 'Office', 'Orders, quotes, customers and payments; no Admin pages', 'list'],
  ['warehouse', 'Warehouse', 'Stock, picking, receiving and the day\'s loads', 'warehouse'],
  ['driver', 'Driver', 'Their deliveries and installs, proof of delivery', 'truck'],
  ['admin', 'Admin', 'Everything, including Admin', 'admin'],
];

async function fn(action, body) {
  const { data, error } = await supabase.functions.invoke('staff-admin', { body: { action, ...body } });
  if (error) { let m = error.message; try { const b = await error.context.json(); m = b.error || m; } catch { /* as it is */ } throw new Error(m); }
  if (data?.error) throw new Error(data.error);
  return data;
}
export async function resetPassword(person) {
  const password = tempPassword();
  await fn('set_password', { email: person.email, password });
  let emailed = false; if (emailReady) { await sendLoginEmail({ email: person.email, name: person.name, password, reset: true }); emailed = true; }
  return { password, emailed };
}

export async function removeLogin(email) { return fn('delete_login', { email }); }
export async function createLogin(person, password) { await fn('create_login', { email: person.email, password }); }

/* person given: Edit (their details, role and login); none: Add a person */
export default function AddPerson({ person, myEmail, onClose, onDone }) {
  const editing = !!person, parts = String(person?.name || '').trim().split(/\s+/);
  const [f, setF] = useState(editing ? { email: person.email, first: parts[0] || '', last: parts.slice(1).join(' '), mobile: person.mobile || '', role: person.role || 'office' } : { email: '', first: '', last: '', mobile: '', role: 'office' });
  const [login, setLogin] = useState(!editing);
  const [pages, setPages] = useState(editing && Array.isArray(person.pages) ? person.pages : defaultPages(editing ? person.role || 'office' : 'office'));
  const [own, setOwn] = useState(editing && Array.isArray(person.pages));   /* ticked by hand: a role change leaves them */
  const pickRole = (r) => { setF((x) => ({ ...x, role: r })); if (!own) setPages(defaultPages(r)); };
  const tick = (k) => { setOwn(true); setPages((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k])); };
  const [active, setActive] = useState(editing ? person.active !== false : true);
  const [pw, setPw] = useState(tempPassword());
  const [mail, setMail] = useState(emailReady);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    const email = f.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErr('Enter a valid email.'); return; }
    if (!f.first.trim()) { setErr('Enter their first name.'); return; }
    setBusy(true); setErr('');
    const name = [f.first.trim(), f.last.trim()].filter(Boolean).join(' ');
    const ordered = PAGES.map((p) => p[0]).filter((k) => pages.includes(k));
    const row = { name, role: f.role, mobile: f.mobile.trim(), pages: sameSet(ordered, defaultPages(f.role)) ? null : ordered, ...(editing && person.email !== myEmail ? { active } : {}) };
    const r = editing ? await supabase.from('staff').update({ ...row, updated_at: new Date().toISOString() }).eq('email', email) : await supabase.from('staff').insert({ email, ...row });
    if (r.error) { setBusy(false); setErr(/duplicate/i.test(r.error.message) ? email + ' is already on the list.' : r.error.message); return; }
    let note = editing ? name + ' saved.' : name + ' added as ' + ROLE_CARDS.find((x) => x[0] === f.role)[1] + '.';
    if (login) {
      try { await fn(editing && person.has_login ? 'set_password' : 'create_login', { email, password: pw }); note += (editing && person.has_login ? ' New temporary password ' : ' Login made, temporary password ') + pw + '.'; }
      catch (e) { setBusy(false); onDone({ bad: true, text: note + ' But the login was not changed: ' + e.message }); return; }
      if (mail) { try { await sendLoginEmail({ email, name, password: pw, reset: editing && person.has_login }); note += ' Emailed to them.'; } catch (e) { note += ' The email was not sent (' + e.message + '): give them the password yourself.'; } }
    }
    setBusy(false); onDone({ text: note });
  };
  return (
    <div className="ap-wrap" role="dialog" aria-modal="true" aria-labelledby="ap-t">
      <div className="ap">
        <header className="ap-h"><div><h3 id="ap-t">{editing ? 'Edit ' + (person.name || person.email) : 'Add a person'}</h3><p>{editing ? 'Their details, role and login.' : 'Adds them to the users list, and gives them a login if you want.'}</p></div><button type="button" className="ap-x" onClick={onClose} aria-label="Close">×</button></header>
        <section className="ap-s">
          <h4><span>1</span>Their details</h4>
          <label className="ap-f">EMAIL<input type="email" autoFocus={!editing} disabled={editing} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="name@directbuildingmaterial.com.au" /></label>
          <div className="ap-two">
            <label className="ap-f">FIRST NAME<input value={f.first} onChange={(e) => setF({ ...f, first: e.target.value })} /></label>
            <label className="ap-f">LAST NAME<input value={f.last} onChange={(e) => setF({ ...f, last: e.target.value })} /></label>
          </div>
          <label className="ap-f">MOBILE <i>OPTIONAL</i><input inputMode="tel" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} placeholder="04xx xxx xxx" /></label>
        </section>
        <section className="ap-s">
          <h4><span>2</span>Role</h4><p className="ap-sub">Pick one. It decides what they see.</p>
          <div className="ap-roles" role="radiogroup" aria-label="Role">
            {ROLE_CARDS.map(([k, l, d, ic]) => (
              <label key={k} className={'ap-role' + (f.role === k ? ' on' : '')}>
                <input type="radio" name="ap-role" checked={f.role === k} onChange={() => pickRole(k)} />
                <span className="ap-ri"><Icon name={ic} size={16} /></span><span className="ap-rt"><b>{l}</b><small>{d}</small></span><span className="ap-rc" aria-hidden="true">{f.role === k ? '✓' : ''}</span>
              </label>
            ))}
          </div>
        </section>
        <section className="ap-s">
          <h4><span>3</span>Pages</h4><p className="ap-sub">What they can open. Ticked by the role; change any of them for this person.</p>
          <div className="ap-pages">{PAGES.map(([k, l, d]) => (
            <label key={k} className={'ap-pg' + (pages.includes(k) ? ' on' : '')}><input type="checkbox" checked={pages.includes(k)} onChange={() => tick(k)} /><span><b>{l}</b><small>{d}</small></span></label>))}</div>
          {own && !sameSet(pages, defaultPages(f.role)) && <button type="button" className="link ap-reset" onClick={() => { setOwn(false); setPages(defaultPages(f.role)); }}>Back to the {ROLE_CARDS.find((r) => r[0] === f.role)[1]} pages</button>}
          {f.role !== 'admin' && pages.includes('admin') && <p className="ap-warn">They can open Admin, but only an Admin can change things there.</p>}
        </section>
        <section className="ap-s">
          <label className="ap-check"><input type="checkbox" checked={login} onChange={(e) => setLogin(e.target.checked)} /> {editing && person.has_login ? 'GIVE THEM A NEW TEMPORARY PASSWORD' : 'GIVE THEM A PORTAL LOGIN NOW'}</label>
          {editing && <p className="ap-sub">{person.has_login ? 'They have a login' + (person.last_sign_in ? ', last signed in ' + new Date(person.last_sign_in).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ', never signed in yet') + '.' : 'No login yet.'}</p>}
          {login && <>
            <label className="ap-f">TEMPORARY PASSWORD<span className="ap-pw"><input value={pw} onChange={(e) => setPw(e.target.value)} /><button type="button" className="btn" onClick={() => setPw(tempPassword())}>New</button></span></label>
            <p className="ap-sub">They'll be asked to choose their own the first time they sign in.</p>
            <label className="ap-check ap-mail"><input type="checkbox" checked={mail} disabled={!emailReady} onChange={(e) => setMail(e.target.checked)} /><span><b>✉ EMAIL THEM THEIR LOGIN DETAILS</b><small>{emailReady ? 'Their email address, this password and a link to the portal.' : 'EmailJS is not set up yet: give them the password yourself.'}</small></span></label>
          </>}
        </section>
        {editing && person.email !== myEmail && <section className="ap-s"><label className="ap-check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> CAN USE THE PORTAL</label><p className="ap-sub">Untick to switch them off for now: they stay on the list and can be switched back on.</p></section>}
        {err && <p className="msg bad ap-err">{err}</p>}
        <footer className="ap-foot"><button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn btn-red" onClick={go} disabled={busy}>{busy ? 'Saving…' : editing ? (login ? 'Save and set password' : 'Save') : login ? 'Add and create login' : 'Add'}</button></footer>
      </div>
    </div>
  );
}
