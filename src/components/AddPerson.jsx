import { useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { emailReady, sendLoginEmail, tempPassword } from '../lib/emailjs.js';
import Icon from './Icon.jsx';

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

export default function AddPerson({ onClose, onDone }) {
  const [f, setF] = useState({ email: '', first: '', last: '', mobile: '', role: 'office' });
  const [login, setLogin] = useState(true);
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
    const ins = await supabase.from('staff').insert({ email, name, role: f.role, mobile: f.mobile.trim() });
    if (ins.error) { setBusy(false); setErr(/duplicate/i.test(ins.error.message) ? email + ' is already on the list.' : ins.error.message); return; }
    let note = name + ' added as ' + ROLE_CARDS.find((r) => r[0] === f.role)[1] + '.';
    if (login) {
      try { await fn('create_login', { email, password: pw }); note += ' Login made, temporary password ' + pw + '.'; }
      catch (e) { setBusy(false); onDone({ bad: true, text: note + ' But the login was not made: ' + e.message }); return; }
      if (mail) { try { await sendLoginEmail({ email, name, password: pw }); note += ' Login details emailed.'; } catch (e) { note += ' The email was not sent (' + e.message + '): give them the password yourself.'; } }
    }
    setBusy(false); onDone({ text: note });
  };
  return (
    <div className="ap-wrap" role="dialog" aria-modal="true" aria-labelledby="ap-t">
      <div className="ap">
        <header className="ap-h"><div><h3 id="ap-t">Add a person</h3><p>Adds them to the users list, and gives them a login if you want.</p></div><button type="button" className="ap-x" onClick={onClose} aria-label="Close">×</button></header>
        <section className="ap-s">
          <h4><span>1</span>Their details</h4>
          <label className="ap-f">EMAIL<input type="email" autoFocus value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="name@directbuildingmaterial.com.au" /></label>
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
                <input type="radio" name="ap-role" checked={f.role === k} onChange={() => setF({ ...f, role: k })} />
                <span className="ap-ri"><Icon name={ic} size={16} /></span><span className="ap-rt"><b>{l}</b><small>{d}</small></span><span className="ap-rc" aria-hidden="true">{f.role === k ? '✓' : ''}</span>
              </label>
            ))}
          </div>
        </section>
        <section className="ap-s">
          <label className="ap-check"><input type="checkbox" checked={login} onChange={(e) => setLogin(e.target.checked)} /> GIVE THEM A PORTAL LOGIN NOW</label>
          {login && <>
            <label className="ap-f">TEMPORARY PASSWORD<span className="ap-pw"><input value={pw} onChange={(e) => setPw(e.target.value)} /><button type="button" className="btn" onClick={() => setPw(tempPassword())}>New</button></span></label>
            <p className="ap-sub">They'll be asked to choose their own the first time they sign in.</p>
            <label className="ap-check ap-mail"><input type="checkbox" checked={mail} disabled={!emailReady} onChange={(e) => setMail(e.target.checked)} /><span><b>✉ EMAIL THEM THEIR LOGIN DETAILS</b><small>{emailReady ? 'Their email address, this password and a link to the portal.' : 'EmailJS is not set up yet: give them the password yourself.'}</small></span></label>
          </>}
        </section>
        {err && <p className="msg bad ap-err">{err}</p>}
        <footer className="ap-foot"><button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn btn-red" onClick={go} disabled={busy}>{busy ? 'Adding…' : login ? 'Add and create login' : 'Add'}</button></footer>
      </div>
    </div>
  );
}
