// xero (13 Nov 2026): the new portal's link to Xero.
//   GET  /xero/callback?code&state     Xero sends the browser back here after "Connect Xero"; no login header (checked by
//                                      the one-time state instead), then back to the portal.
//   POST { action: "status" }          connected or not, to which organisation, the last sync
//   POST { action: "connect", return_to }   the Xero sign-in address to open
//   POST { action: "sync_items" }      pulls every Xero item into products (codes, names, descriptions, Xero's prices);
//                                      Direct's own columns (category, unit, price lists) are never changed by it.
// Only admins (staff.role = admin) can connect or sync; anyone signed in on the staff list can read the status.
// Deploy: npx supabase functions deploy xero --project-ref qnfuifckyfhiuvqyvkvf --no-verify-jwt
// Secrets: XERO_CLIENT_ID, XERO_CLIENT_SECRET, XERO_REDIRECT_URI (= https://<project>.supabase.co/functions/v1/xero/callback)
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const env = (k: string) => (Deno.env.get(k) ?? "").trim();
const SCOPES = "openid profile email offline_access accounting.settings.read";
const admin = () => createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false }, db: { schema: "public" } });
const priv = admin;   /* the Xero tables are in public, readable only with the service role (RLS, no policies) */

async function caller(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: "Bearer " + token } }, auth: { persistSession: false } });
  const { data } = await sb.auth.getUser(token);
  const email = String(data?.user?.email || "").toLowerCase();
  if (!email) return null;
  const { data: st } = await admin().from("staff").select("role, active").eq("email", email).maybeSingle();
  return st && st.active ? { email, role: String(st.role) } : null;
}
async function tokenCall(body: Record<string, string>) {
  const r = await fetch("https://identity.xero.com/connect/token", { method: "POST",
    headers: { Authorization: "Basic " + btoa(env("XERO_CLIENT_ID") + ":" + env("XERO_CLIENT_SECRET")), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Xero sign-in: " + (j.error_description || j.error || r.status));
  return j as { access_token: string; refresh_token: string; expires_in: number };
}
/* a working access token: refreshed when it is about to run out (Xero's last 30 minutes, refresh tokens 60 days) */
async function access() {
  const { data: l } = await priv().from("xero_link").select("*").eq("id", 1).maybeSingle();
  if (!l?.refresh_token || !l?.tenant_id) throw new Error("Xero is not connected: press Connect Xero first.");
  if (l.access_token && l.expires_at && new Date(l.expires_at).getTime() - Date.now() > 120000) return l;
  const t = await tokenCall({ grant_type: "refresh_token", refresh_token: l.refresh_token });
  const upd = { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(), updated_at: new Date().toISOString() };
  await priv().from("xero_link").update(upd).eq("id", 1);
  return { ...l, ...upd };
}
const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  try {
    /* Xero sends the browser back here */
    if (req.method === "GET" && (url.pathname.endsWith("/callback") || url.searchParams.get("action") === "callback")) {
      const code = url.searchParams.get("code") || "", state = url.searchParams.get("state") || "";
      const { data: st } = await priv().from("xero_oauth_state").select("*").eq("state", state).maybeSingle();
      if (!st || Date.now() - new Date(st.created_at).getTime() > 15 * 60000) return new Response("This Xero link has expired. Go back to the portal and press Connect Xero again.", { status: 400 });
      await priv().from("xero_oauth_state").delete().eq("state", state);
      const back = (ok: boolean, msg: string) => Response.redirect(st.return_to + (st.return_to.includes("?") ? "&" : "?") + "xero=" + (ok ? "connected" : "failed") + "&msg=" + encodeURIComponent(msg), 302);
      if (!code) return back(false, url.searchParams.get("error_description") || url.searchParams.get("error") || "Xero did not connect");
      const t = await tokenCall({ grant_type: "authorization_code", code, redirect_uri: env("XERO_REDIRECT_URI") });
      const cr = await fetch("https://api.xero.com/connections", { headers: { Authorization: "Bearer " + t.access_token, "Content-Type": "application/json" } });
      const conns = await cr.json().catch(() => []);
      const org = (Array.isArray(conns) ? conns : []).find((c: any) => c.tenantType === "ORGANISATION");
      if (!org) return back(false, "No Xero organisation was chosen");
      await priv().from("xero_link").upsert({ id: 1, tenant_id: org.tenantId, tenant_name: org.tenantName, access_token: t.access_token, refresh_token: t.refresh_token,
        expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(), connected_by: st.by_email, connected_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      return back(true, "Connected to " + org.tenantName);
    }
    if (req.method !== "POST") return json({ error: "POST only" }, 405);
    const who = await caller(req);
    if (!who) return json({ error: "Sign in first" }, 401);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    if (action === "status") {
      const { data: l } = await priv().from("xero_link").select("tenant_name, connected_by, connected_at, refresh_token").eq("id", 1).maybeSingle();
      const { data: last } = await admin().from("xero_sync_runs").select("*").eq("kind", "items").order("id", { ascending: false }).limit(1).maybeSingle();
      return json({ connected: !!l?.refresh_token, tenant: l?.tenant_name || null, connected_by: l?.connected_by || null, connected_at: l?.connected_at || null, last_sync: last || null, setup: !!(env("XERO_CLIENT_ID") && env("XERO_CLIENT_SECRET") && env("XERO_REDIRECT_URI")) });
    }
    if (who.role !== "admin") return json({ error: "Only an admin can do that" }, 403);

    if (action === "connect") {
      if (!env("XERO_CLIENT_ID") || !env("XERO_REDIRECT_URI")) return json({ error: "The Xero app is not set up yet (XERO_CLIENT_ID, XERO_CLIENT_SECRET, XERO_REDIRECT_URI)." }, 409);
      const returnTo = /^https?:\/\//.test(String(body?.return_to || "")) ? String(body.return_to) : "";
      if (!returnTo) return json({ error: "Send return_to" }, 400);
      const state = crypto.randomUUID();
      await priv().from("xero_oauth_state").insert({ state, by_email: who.email, return_to: returnTo });
      const u = new URL("https://login.xero.com/identity/connect/authorize");
      u.search = new URLSearchParams({ response_type: "code", client_id: env("XERO_CLIENT_ID"), redirect_uri: env("XERO_REDIRECT_URI"), scope: SCOPES, state }).toString();
      return json({ url: u.toString() });
    }

    if (action === "sync_items") {
      const run = await admin().from("xero_sync_runs").insert({ kind: "items", by_email: who.email }).select("id").single();
      const runId = run.data?.id;
      try {
        const l = await access();
        const r = await fetch("https://api.xero.com/api.xro/2.0/Items", { headers: { Authorization: "Bearer " + l.access_token, "xero-tenant-id": l.tenant_id, Accept: "application/json" } });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error("Xero items: " + (j?.Detail || j?.Message || j?.Title || r.status));
        const items: any[] = Array.isArray(j?.Items) ? j.Items : [];
        const { data: have } = await admin().from("products").select("id, code, xero_item_id");
        const byId = new Map((have || []).filter((p: any) => p.xero_item_id).map((p: any) => [String(p.xero_item_id), p]));
        const byCode = new Map((have || []).map((p: any) => [String(p.code).toLowerCase(), p]));
        const now = new Date().toISOString();
        let added = 0, updated = 0;
        const seen = new Set<number>();
        const rows = items.filter((it) => String(it.Code || "").trim()).map((it) => ({
          code: String(it.Code).trim(), name: String(it.Name || it.Code || "").trim(), description: String(it.Description || "").trim(),
          xero_item_id: it.ItemID, xero_sales_price: num(it.SalesDetails?.UnitPrice), xero_cost_price: num(it.PurchaseDetails?.UnitPrice),
          xero_sales_account: it.SalesDetails?.AccountCode || null, xero_tax_type: it.SalesDetails?.TaxType || null,
          is_sold: it.IsSold !== false, is_purchased: it.IsPurchased === true, in_xero: true, synced_at: now, updated_at: now }));
        for (const row of rows) {
          const old = byId.get(String(row.xero_item_id)) || byCode.get(row.code.toLowerCase());
          if (old) { seen.add(old.id); const u = await admin().from("products").update(row).eq("id", old.id); if (u.error) throw new Error(row.code + ": " + u.error.message); updated++; }
          else { const i = await admin().from("products").insert(row); if (i.error) throw new Error(row.code + ": " + i.error.message); added++; }
        }
        const gone = (have || []).filter((p: any) => p.xero_item_id && !seen.has(p.id) && !rows.some((x) => x.xero_item_id === p.xero_item_id)).map((p: any) => p.id);
        if (gone.length) await admin().from("products").update({ in_xero: false, updated_at: now }).in("id", gone);
        await admin().from("xero_sync_runs").update({ finished_at: new Date().toISOString(), ok: true, added, updated, gone: gone.length }).eq("id", runId);
        return json({ ok: true, items: rows.length, added, updated, gone: gone.length });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await admin().from("xero_sync_runs").update({ finished_at: new Date().toISOString(), ok: false, error: msg.slice(0, 500) }).eq("id", runId);
        return json({ error: msg }, 502);
      }
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
