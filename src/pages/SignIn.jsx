import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider.jsx';
import Logo from '../components/Logo.jsx';

/* Sign in: email and password; or a sign-in link by email; or a password reset (as approved, 13 Nov 2026) */
export default function SignIn() {
  const { signIn, sendLink, sendReset } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const run = async (fn, ok) => {
    if (!email.trim()) { setMsg({ bad: true, text: 'Enter your email first.' }); return; }
    setBusy(true); setMsg(null);
    const { error } = await fn();
    setBusy(false);
    setMsg(error ? { bad: true, text: error.message === 'Invalid login credentials' ? 'That email and password do not match.' : error.message } : ok ? { text: ok } : null);
  };

  return (
    <div className="signin">
      <section className="signin-brand">
        <Logo />
        <div>
          <h1>Orders, deliveries and payments in one place.</h1>
          <p>The Direct Building Material portal for the office, the warehouse and the drivers.</p>
        </div>
        <small>16 Cassola Place, Penrith NSW 2750 · (02) 8074 8437</small>
      </section>
      <section className="signin-form">
        <form onSubmit={(e) => { e.preventDefault(); run(() => signIn(email, password)); }}>
          <h2>Sign in</h2>
          <p className="muted">Use your Direct email.</p>
          <label>Email<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@directbuildingmaterial.com.au" required /></label>
          <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" required /></label>
          <button type="submit" className="btn btn-red btn-big" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          {msg && <p className={msg.bad ? 'msg bad' : 'msg'} role="status">{msg.text}</p>}
          <div className="links">
            <button type="button" className="link" onClick={() => run(() => sendReset(email), 'Check your email for a link to set a new password.')}>Forgot your password?</button>
            <button type="button" className="link" onClick={() => run(() => sendLink(email), 'Check your email for a sign-in link.')}>Email me a sign-in link</button>
          </div>
        </form>
      </section>
    </div>
  );
}
