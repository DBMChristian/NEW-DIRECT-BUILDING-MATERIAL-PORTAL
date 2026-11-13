// staff-admin (13 Nov 2026): logins for the people on Admin > Users, which only the service role can make.
//   POST { action: "create_login", email, password, name }  a login with this temporary password (they choose their own
//                                                            the first time they sign in)
//   POST { action: "set_password", email, password }        a new temporary password (Reset password)
//   POST { action: "delete_login", email }                  removes the login (Remove person)
// Only an admin on the staff list, and only for someone on the staff list. Deploy:
//   npx supabase functions deploy staff-admin --project-ref qnfuifckyfhiuvqyvkvf
import { createClient } from "jsr:@supabase/supabase-js@2";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const env = (k: string) => (Deno.env.get(k) ?? "").trim();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const { data: u } = await admin.auth.getUser(token);
    const me = String(u?.user?.email || "").toLowerCase();
    const { data: st } = await admin.from("staff").select("role, active").eq("email", me).maybeSingle();
    if (!st || !st.active || st.role !== "admin") return json({ error: "Only an admin can do that" }, 403);
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || "").trim().toLowerCase(), password = String(body?.password || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Not an email" }, 400);
    if (body?.action !== "delete_login" && password.length < 8) return json({ error: "The password needs at least 8 characters" }, 400);
    const { data: person } = await admin.from("staff").select("email, name").eq("email", email).maybeSingle();
    if (!person && body?.action !== "delete_login") return json({ error: email + " is not on the staff list" }, 404);
    if (email === me) return json({ error: "You cannot do that to yourself" }, 400);
    /* the login, found by email (the list is small) */
    let found: any = null;
    for (let page = 1; page <= 20 && !found; page++) {
      const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      found = (data?.users || []).find((x: any) => String(x.email || "").toLowerCase() === email) || null;
      if (!data?.users?.length || data.users.length < 200) break;
    }
    const meta = { name: person?.name || "", must_change_password: true };
    if (body?.action === "create_login") {
      if (found) { const r = await admin.auth.admin.updateUserById(found.id, { password, user_metadata: { ...found.user_metadata, ...meta } }); if (r.error) throw r.error; return json({ ok: true, existed: true }); }
      const r = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: meta });
      if (r.error) throw r.error;
      return json({ ok: true });
    }
    if (body?.action === "set_password") {
      if (!found) return json({ error: email + " has no login yet: use Give them a portal login" }, 404);
      const r = await admin.auth.admin.updateUserById(found.id, { password, user_metadata: { ...found.user_metadata, ...meta } });
      if (r.error) throw r.error;
      return json({ ok: true });
    }
    if (body?.action === "delete_login") {   /* Remove: the person's login goes too, so it cannot sign in again */
      if (found) { const r = await admin.auth.admin.deleteUser(found.id); if (r.error) throw r.error; }
      return json({ ok: true, had_login: !!found });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
