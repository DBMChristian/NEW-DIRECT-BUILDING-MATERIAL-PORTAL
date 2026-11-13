import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';

/* who is signed in, and their staff record (name, role). A login with no active staff record cannot use the portal. */
const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [staff, setStaff] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((e, s) => { if (e === 'TOKEN_REFRESHED' || e === 'SIGNED_IN') setSession((old) => (old && s && old.user?.id === s.user?.id ? { ...old, ...s } : s)); else setSession(s); });
    return () => sub.subscription.unsubscribe();
  }, []);

  /* the staff record follows the signed-in EMAIL, not every new session object: coming back to the tab refreshes the
     login token (a new session), which must not reload the portal or reset a form being filled in (13 Nov 2026).
     The spinner shows only for the first load or a different person signing in; later checks are silent. */
  const email = session?.user?.email ? session.user.email.toLowerCase() : '';
  const shown = useRef('');
  useEffect(() => {
    if (!supabase) return;
    if (!email) { setStaff(null); setLoading(false); shown.current = ''; return; }
    const first = shown.current !== email;
    if (first) setLoading(true);
    supabase.from('staff').select('email, name, role, active, pages').eq('email', email).maybeSingle()
      .then(({ data, error }) => { if (!error || first) setStaff(data && data.active ? data : null); shown.current = email; setLoading(false); });
  }, [email]);

  const value = {
    session, staff, loading,
    signIn: (email, password) => supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password }),
    sendLink: (email) => supabase.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: false, emailRedirectTo: window.location.origin } }),
    sendReset: (email) => supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: window.location.origin }),
    signOut: () => supabase.auth.signOut(),
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
