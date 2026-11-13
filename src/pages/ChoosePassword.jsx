import { useState } from 'react';
import { supabase } from '../lib/supabase.js';
import Logo from '../components/Logo.jsx';

/* the first sign-in with a temporary password: they choose their own before anything else (13 Nov 2026) */
export default function ChoosePassword({ onDone }) {
  const [a, setA] = useState(''); const [b, setB] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async (e) => {
    e.preventDefault();
    if (a.length < 8) { setErr('At least 8 characters.'); return; }
    if (a !== b) { setErr('The two passwords are not the same.'); return; }
    setBusy(true); const { error } = await supabase.auth.updateUser({ password: a, data: { must_change_password: false } }); setBusy(false);
    if (error) setErr(error.message); else onDone();
  };
  return (
    <div className="centre">
      <form className="note cp" onSubmit={go}>
        <Logo />
        <h2>Choose your password</h2>
        <p className="muted">You signed in with a temporary password. Choose your own to continue.</p>
        <label>New password<input type="password" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} autoFocus /></label>
        <label>Again<input type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} /></label>
        {err && <p className="msg bad">{err}</p>}
        <button type="submit" className="btn btn-red btn-big" disabled={busy}>{busy ? 'Saving…' : 'Save and continue'}</button>
      </form>
    </div>
  );
}
