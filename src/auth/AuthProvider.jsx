import { createContext, useContext, useEffect, useState } from 'react';
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
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase) return;
    if (!session) { setStaff(null); setLoading(false); return; }
    setLoading(true);
    supabase.from('staff').select('email, name, role, active, pages').eq('email', session.user.email.toLowerCase()).maybeSingle()
      .then(({ data }) => { setStaff(data && data.active ? data : null); setLoading(false); });
  }, [session]);

  const value = {
    session, staff, loading,
    signIn: (email, password) => supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password }),
    sendLink: (email) => supabase.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: false, emailRedirectTo: window.location.origin } }),
    sendReset: (email) => supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: window.location.origin }),
    signOut: () => supabase.auth.signOut(),
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
