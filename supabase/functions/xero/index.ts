// xero (13 Nov 2026): the new portal's link to Xero.
//   GET  /xero/callback?code&state     Xero sends the browser back here after "Connect Xero"; no login header (checked by
//                                      the one-time state instead), then back to the portal.
//   POST { action: "status" }          connected or not, to which organisation, the last sync
//   POST { action: "connect", return_to }   the Xero sign-in address to open
//   POST { action: "sync_contacts" }   pulls every Xero contact into customers (Direct's terms, price list, notes stay)
//   POST { action: "sync_all" }        both (the every-30-minutes job)
//   POST { action: "sync_items" }      pulls every Xero item into products (codes, names, descriptions, Xero's prices);
//                                      Direct's own columns (category, unit, price lists) are never changed by it.
// Only admins (staff.role = admin) can connect or sync; anyone signed in on the staff list can read the status.
// Every 30 minutes the database's own job (pg_cron) runs sync_items with its key (app_secrets.xero_cron_key).
// Deploy: npx supabase functions deploy xero --project-ref qnfuifckyfhiuvqyvkvf --no-verify-jwt
// Secrets: XERO_CLIENT_ID, XERO_CLIENT_SECRET, XERO_REDIRECT_URI (= https://<project>.supabase.co/functions/v1/xero/callback)
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const env = (k: string) => (Deno.env.get(k) ?? "").trim();
/* contacts: Admin > Customers; invoices (read): each customer's balances (13 Nov 2026). Xero apps made since March 2026
   use the narrower "accounting.invoices.read"; XERO_SCOPES (a secret) overrides the list if Xero asks for another. */
const SCOPES = env("XERO_SCOPES") || "openid profile email offline_access accounting.settings.read accounting.contacts.read accounting.invoices.read";
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
      let t;
      try { t = await tokenCall({ grant_type: "authorization_code", code, redirect_uri: env("XERO_REDIRECT_URI") }); }
      catch (e) { return back(false, e instanceof Error ? e.message : String(e)); }
      const cr = await fetch("https://api.xero.com/connections", { headers: { Authorization: "Bearer " + t.access_token, "Content-Type": "application/json" } });
      const conns = await cr.json().catch(() => []);
      /* Xero lists every organisation ever connected to this app (13 Nov 2026: DBM's was connected by mistake): the portal
         always uses Direct Building Material's when it is among them, never another */
      let ev = "";
      try { ev = JSON.parse(atob(t.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).authentication_event_id || ""; } catch { /* none */ }
      const orgs = (Array.isArray(conns) ? conns : []).filter((c: any) => c.tenantType === "ORGANISATION");
      /* Direct's own organisation wins whenever it is connected; else the one chosen in this sign-in, if only one was */
      const chosen = orgs.filter((c: any) => ev && c.authEventId === ev);
      const org = orgs.find((c: any) => /^direct building material/i.test(String(c.tenantName || ""))) || (chosen.length === 1 ? chosen[0] : orgs.length === 1 ? orgs[0] : null);
      if (!org) return back(false, "Choose Direct Building Material in Xero (connected now: " + orgs.map((c: any) => c.tenantName).join(", ") + ").");
      await priv().from("xero_link").upsert({ id: 1, tenant_id: org.tenantId, tenant_name: org.tenantName, access_token: t.access_token, refresh_token: t.refresh_token,
        expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(), connected_by: st.by_email, connected_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      return back(true, "Connected to " + org.tenantName);
    }
    if (req.method !== "POST") return json({ error: "POST only" }, 405);
    /* the database's own job (pg_cron, every 30 minutes) calls with its key from app_secrets: it syncs as "auto" */
    let who = null as null | { email: string; role: string };
    const cronKey = req.headers.get("x-cron-key");
    if (cronKey) {
      const { data: k } = await admin().from("app_secrets").select("value").eq("name", "xero_cron_key").maybeSingle();
      if (!k?.value || k.value !== cronKey) return json({ error: "Wrong key" }, 401);
      who = { email: "auto (every 30 minutes)", role: "admin" };
    } else who = await caller(req);
    if (!who) return json({ error: "Sign in first" }, 401);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    if (action === "status") {
      const { data: l } = await priv().from("xero_link").select("tenant_name, connected_by, connected_at, refresh_token, default_terms_day, default_terms_type").eq("id", 1).maybeSingle();
      const kind = body?.kind === "contacts" ? "contacts" : "items";
      const { data: last } = await admin().from("xero_sync_runs").select("*").eq("kind", kind).order("id", { ascending: false }).limit(1).maybeSingle();
      return json({ connected: !!l?.refresh_token, tenant: l?.tenant_name || null, default_terms: l?.default_terms_type ? { day: l.default_terms_day, type: l.default_terms_type } : null, connected_by: l?.connected_by || null, connected_at: l?.connected_at || null, last_sync: last || null, setup: !!(env("XERO_CLIENT_ID") && env("XERO_CLIENT_SECRET") && env("XERO_REDIRECT_URI")) });
    }
    /* + New customer in New Order (13 Nov 2026): the contact is made in Xero straight away (name, email, phone), and the
       portal's customer is that contact (linked by its Xero id), so a sync never brings it back as a second customer.
       A contact of the same name already in Xero is used, not doubled. Office and admin. */
    if (action === "create_contact") {
      if (who.role !== "admin" && who.role !== "office") return json({ error: "Only the office can add customers" }, 403);
      const name = String(body?.name || "").trim().slice(0, 255), email = String(body?.email || "").trim().toLowerCase().slice(0, 255), phone = String(body?.phone || "").trim().slice(0, 50);
      if (name.length < 2) return json({ error: "Enter the company or name" }, 400);
      try {
        const l = await access();
        const h = { Authorization: "Bearer " + l.access_token, "xero-tenant-id": l.tenant_id, Accept: "application/json", "Content-Type": "application/json" };
        /* the same name already in Xero: use it */
        const f = await fetch("https://api.xero.com/api.xro/2.0/Contacts?where=" + encodeURIComponent('Name=="' + name.replace(/"/g, '') + '"'), { headers: h });
        const fj = await f.json().catch(() => ({}));
        let c = (fj?.Contacts || [])[0], existed = !!c;
        if (!c) {
          const mob = /^(\+?61|0)?4/.test(phone.replace(/[^0-9+]/g, ""));
          const doc: Record<string, unknown> = { Name: name, ...(email ? { EmailAddress: email } : {}), IsCustomer: true,
            ...(phone ? { Phones: [{ PhoneType: mob ? "MOBILE" : "DEFAULT", PhoneNumber: phone }] } : {}) };
          const r = await fetch("https://api.xero.com/api.xro/2.0/Contacts", { method: "PUT", headers: h, body: JSON.stringify({ Contacts: [doc] }) });
          const j = await r.json().catch(() => ({}));
          const ve = ((j?.Elements || [])[0]?.ValidationErrors || []).map((v: any) => v.Message).join("; ");
          if (!r.ok || ve) throw new Error("Xero: " + (ve || j?.Detail || j?.Message || j?.Title || r.status));
          c = (j?.Contacts || [])[0];
        }
        if (!c?.ContactID) throw new Error("Xero gave no contact back");
        const row = { xero_contact_id: c.ContactID, name: c.Name || name, email: (c.EmailAddress || email || "").toLowerCase(), is_customer: true, in_xero: true, xero_status: c.ContactStatus || "ACTIVE", synced_at: new Date().toISOString(),
          ...(phone ? (/^(\+?61|0)?4/.test(phone.replace(/[^0-9+]/g, "")) ? { mobile: phone } : { phone }) : {}) };
        const { data: have } = await admin().from("customers").select("id").eq("xero_contact_id", c.ContactID).maybeSingle();
        const saved = have ? await admin().from("customers").update(row).eq("id", have.id).select("*").single()
          : await admin().from("customers").insert({ ...row, terms: "cod", price_list: "builder" }).select("*").single();
        if (saved.error) throw new Error(saved.error.message);
        return json({ ok: true, existed, customer: saved.data });
      } catch (e) { return json({ error: e instanceof Error ? e.message : String(e) }, 502); }
    }
    /* Sync (Xero) on New Order: the office may pull the customers too */
    if (action === "sync_contacts" && who.role === "office") { const r = await syncContacts(); return json(r, (r as any).error ? 502 : 200); }
    if (who.role !== "admin") return json({ error: "Only an admin can do that" }, 403);

    if (action === "connect") {
      /* only these people connect or reconnect Xero (XERO_OWNERS, a secret, comma separated; default Christian) */
      const owners = (env("XERO_OWNERS") || "christian@discountbuildingmaterial.com.au").toLowerCase().split(/[,;\s]+/).filter(Boolean);
      if (!owners.includes(who!.email)) return json({ error: "Only " + owners.join(", ") + " can connect Xero." }, 403);
      if (!env("XERO_CLIENT_ID") || !env("XERO_REDIRECT_URI")) return json({ error: "The Xero app is not set up yet (XERO_CLIENT_ID, XERO_CLIENT_SECRET, XERO_REDIRECT_URI)." }, 409);
      const returnTo = /^https?:\/\//.test(String(body?.return_to || "")) ? String(body.return_to) : "";
      if (!returnTo) return json({ error: "Send return_to" }, 400);
      const state = crypto.randomUUID();
      await priv().from("xero_oauth_state").insert({ state, by_email: who.email, return_to: returnTo });
      const u = new URL("https://login.xero.com/identity/connect/authorize");
      u.search = new URLSearchParams({ response_type: "code", client_id: env("XERO_CLIENT_ID"), redirect_uri: env("XERO_REDIRECT_URI"), scope: SCOPES, state }).toString();
      return json({ url: u.toString() });
    }

    const syncItems = async () => {
      const run = await admin().from("xero_sync_runs").insert({ kind: "items", by_email: who!.email }).select("id").single();
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
        /* all at once, in blocks of 500 (one at a time took minutes): by code, Xero's columns only, so Direct's own
           (category, unit, price lists) stay as they are */
        for (const row of rows) { const old = byId.get(String(row.xero_item_id)) || byCode.get(row.code.toLowerCase()); if (old) { seen.add(old.id); updated++; } else added++; }
        /* a code changed in Xero: the product keeps its own row (and Direct's prices), under the new code */
        for (const row of rows) { const old = byId.get(String(row.xero_item_id)); if (old && String(old.code) !== row.code) { const c = await admin().from("products").update({ code: row.code }).eq("id", old.id); if (c.error) throw new Error(row.code + ": " + c.error.message); } }
        for (let i = 0; i < rows.length; i += 500) {
          const u = await admin().from("products").upsert(rows.slice(i, i + 500), { onConflict: "code" });
          if (u.error) throw new Error("Saving the products: " + u.error.message);
        }
        const gone = (have || []).filter((p: any) => p.xero_item_id && !seen.has(p.id) && !rows.some((x) => x.xero_item_id === p.xero_item_id)).map((p: any) => p.id);
        if (gone.length) await admin().from("products").update({ in_xero: false, updated_at: now }).in("id", gone);
        await admin().from("xero_sync_runs").update({ finished_at: new Date().toISOString(), ok: true, added, updated, gone: gone.length }).eq("id", runId);
        return { ok: true, items: rows.length, added, updated, gone: gone.length };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await admin().from("xero_sync_runs").update({ finished_at: new Date().toISOString(), ok: false, error: msg.slice(0, 500) }).eq("id", runId);
        return { error: msg };
      }
        };
    /* Xero contacts into customers: the Xero columns only (Direct's terms, price list and notes stay), in blocks of 500 */
    const syncContacts = async () => {
      const run = await admin().from("xero_sync_runs").insert({ kind: "contacts", by_email: who!.email }).select("id").single();
      const runId = run.data?.id;
      try {
        const l = await access();
        const all: any[] = [];
        for (let page = 1; page <= 50; page++) {
          const r = await fetch("https://api.xero.com/api.xro/2.0/Contacts?includeArchived=true&pageSize=1000&page=" + page, { headers: { Authorization: "Bearer " + l.access_token, "xero-tenant-id": l.tenant_id, Accept: "application/json" } });
          const j = await r.json().catch(() => ({}));
          if (r.status === 401 || r.status === 403) throw new Error("Xero did not allow reading contacts: press Reconnect on this page once (customers need one more permission).");
          if (!r.ok) throw new Error("Xero contacts: " + (j?.Detail || j?.Message || j?.Title || r.status));
          const got: any[] = Array.isArray(j?.Contacts) ? j.Contacts : [];
          all.push(...got);
          if (got.length < 1000) break;
        }
        try {
          const or = await fetch("https://api.xero.com/api.xro/2.0/Organisation", { headers: { Authorization: "Bearer " + l.access_token, "xero-tenant-id": l.tenant_id, Accept: "application/json" } });
          const oj = await or.json().catch(() => ({})), st = oj?.Organisations?.[0]?.PaymentTerms?.Sales;
          await priv().from("xero_link").update({ default_terms_day: st?.Day ?? null, default_terms_type: String(st?.Type || "") }).eq("id", 1);
        } catch { /* the contacts still sync */ }
        const phone = (c: any, t: string) => { const p = (c.Phones || []).find((x: any) => x.PhoneType === t); return p ? [p.PhoneCountryCode, p.PhoneAreaCode, p.PhoneNumber].filter(Boolean).join(" ").trim() : ""; };
        const addr = (c: any) => (c.Addresses || []).find((x: any) => x.AddressType === "STREET" && (x.AddressLine1 || x.City)) || (c.Addresses || []).find((x: any) => x.AddressLine1 || x.City) || {};
        const now = new Date().toISOString();
        const rows = all.filter((c) => c.ContactID).map((c) => { const a = addr(c); return {
          xero_contact_id: c.ContactID, name: String(c.Name || "").trim(), first_name: String(c.FirstName || ""), last_name: String(c.LastName || ""),
          email: String(c.EmailAddress || "").trim().toLowerCase(), phone: phone(c, "DEFAULT"), mobile: phone(c, "MOBILE"),
          street: [a.AddressLine1, a.AddressLine2].filter(Boolean).join(", "), suburb: String(a.City || ""), state: String(a.Region || ""), postcode: String(a.PostalCode || ""),
          account_number: String(c.AccountNumber || ""), abn: String(c.TaxNumber || ""), is_customer: c.IsCustomer === true, is_supplier: c.IsSupplier === true,
          xero_status: String(c.ContactStatus || "ACTIVE"), in_xero: true, synced_at: now, updated_at: now,
          /* the contact's own sales terms in Xero (none: Xero's default for the organisation) */
          xero_terms_day: c.PaymentTerms?.Sales?.Day ?? null, xero_terms_type: String(c.PaymentTerms?.Sales?.Type || "") }; });
        const { data: have } = await admin().from("customers").select("id, xero_contact_id");
        const known = new Set((have || []).map((x: any) => String(x.xero_contact_id)));
        const added = rows.filter((r) => !known.has(String(r.xero_contact_id))).length, updated = rows.length - added;
        for (let i = 0; i < rows.length; i += 500) {
          const u = await admin().from("customers").upsert(rows.slice(i, i + 500), { onConflict: "xero_contact_id" });
          if (u.error) throw new Error("Saving the customers: " + u.error.message);
        }
        const ids = new Set(rows.map((r) => String(r.xero_contact_id)));
        const gone = (have || []).filter((x: any) => x.xero_contact_id && !ids.has(String(x.xero_contact_id))).map((x: any) => x.id);
        if (gone.length) await admin().from("customers").update({ in_xero: false, updated_at: now }).in("id", gone);
        /* each customer's balances from their sales invoices (Xero's figures); a missing permission does not stop the sync */
        let balances = "";
        try {
          const per = new Map<string, { appr: number; due: number; over: number; inv: number }>();
          const open: any[] = [];   /* each unpaid invoice, for Home > COD balance */
          const day = (v: unknown) => { const m = /\/Date\((\d+)/.exec(String(v || "")); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : (/^\d{4}-\d{2}-\d{2}/.test(String(v || "")) ? String(v).slice(0, 10) : null); };
          const today = new Date().toISOString().slice(0, 10);
          for (let page = 1; page <= 100; page++) {
            const r = await fetch("https://api.xero.com/api.xro/2.0/Invoices?summaryOnly=true&pageSize=1000&page=" + page + "&Statuses=SUBMITTED,AUTHORISED,PAID&where=" + encodeURIComponent('Type=="ACCREC"'),
              { headers: { Authorization: "Bearer " + l.access_token, "xero-tenant-id": l.tenant_id, Accept: "application/json" } });
            const j = await r.json().catch(() => ({}));
            if (r.status === 401 || r.status === 403) throw new Error("Xero did not allow reading invoices: press Reconnect once (balances need one more permission).");
            if (!r.ok) throw new Error("Xero invoices: " + (j?.Detail || j?.Message || j?.Title || r.status));
            const got: any[] = Array.isArray(j?.Invoices) ? j.Invoices : [];
            for (const iv of got) {
              const id = String(iv?.Contact?.ContactID || ""); if (!id) continue;
              const b = per.get(id) || { appr: 0, due: 0, over: 0, inv: 0 }, total = Number(iv.Total) || 0, due = Number(iv.AmountDue) || 0;
              if (iv.Status === "SUBMITTED") b.appr += total;
              if (iv.Status === "AUTHORISED") { b.due += due; const dd = String(iv.DueDateString || iv.DueDate || "").slice(0, 10); if (dd && /^\d{4}-/.test(dd) && dd < today) b.over += due; }
              if (iv.Status === "AUTHORISED" || iv.Status === "PAID") b.inv += total;
              if ((iv.Status === "AUTHORISED" || iv.Status === "SUBMITTED") && (iv.Status === "SUBMITTED" ? total : due) > 0)
                open.push({ xero_invoice_id: iv.InvoiceID, number: String(iv.InvoiceNumber || ""), reference: String(iv.Reference || ""), xero_contact_id: id, customer_name: String(iv.Contact?.Name || ""),
                  status: iv.Status, invoice_date: day(iv.DateString || iv.Date), due_date: day(iv.DueDateString || iv.DueDate), total, amount_due: iv.Status === "SUBMITTED" ? total : due, synced_at: new Date().toISOString() });
              per.set(id, b);
            }
            if (got.length < 1000) break;
          }
          const r2 = (n: number) => Math.round(n * 100) / 100, at = new Date().toISOString();
          const { data: cs } = await admin().from("customers").select("id, xero_contact_id, xero_awaiting_approval, xero_awaiting_payment, xero_overdue, xero_invoiced");
          for (const c of cs || []) {
            const b = per.get(String(c.xero_contact_id)) || { appr: 0, due: 0, over: 0, inv: 0 };
            const v = { xero_awaiting_approval: r2(b.appr), xero_awaiting_payment: r2(b.due), xero_overdue: r2(b.over), xero_invoiced: r2(b.inv) };
            if (Number(c.xero_awaiting_approval) !== v.xero_awaiting_approval || Number(c.xero_awaiting_payment) !== v.xero_awaiting_payment || Number(c.xero_overdue) !== v.xero_overdue || Number(c.xero_invoiced) !== v.xero_invoiced)
              await admin().from("customers").update({ ...v, xero_balances_at: at }).eq("id", c.id);
          }
          await admin().from("customers").update({ xero_balances_at: at }).is("xero_balances_at", null);
          for (let i = 0; i < open.length; i += 500) { const u = await admin().from("xero_invoices").upsert(open.slice(i, i + 500), { onConflict: "xero_invoice_id" }); if (u.error) throw new Error("Saving the invoices: " + u.error.message); }
          const keep = open.map((x) => x.xero_invoice_id);
          const del = keep.length ? await admin().from("xero_invoices").delete().not("xero_invoice_id", "in", "(" + keep.join(",") + ")") : await admin().from("xero_invoices").delete().not("xero_invoice_id", "is", null);
          if (del.error) throw new Error("Tidying the invoices: " + del.error.message);
        } catch (e) { balances = e instanceof Error ? e.message : String(e); }
        await admin().from("xero_sync_runs").update({ finished_at: new Date().toISOString(), ok: true, added, updated, gone: gone.length, error: balances ? balances.slice(0, 500) : null }).eq("id", runId);
        return { ok: true, contacts: rows.length, added, updated, gone: gone.length, balances_error: balances || null };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await admin().from("xero_sync_runs").update({ finished_at: new Date().toISOString(), ok: false, error: msg.slice(0, 500) }).eq("id", runId);
        return { error: msg };
      }
    };
    /* one upload from the queue, now: a sales order is a Xero invoice, a purchase order a Xero purchase order; creating
       sends the document, updating sends it again with its Xero id, deleting deletes a draft (or voids an approved one) */
    if (action === "send_queue") {
      const id = Number(body?.id); if (!Number.isSafeInteger(id) || id <= 0) return json({ error: "Send id" }, 400);
      const { data: q } = await admin().from("xero_queue").select("*").eq("id", id).maybeSingle();
      if (!q) return json({ error: "Not in the queue" }, 404);
      if (q.status === "done") return json({ ok: true, already: true });
      const claim = await admin().from("xero_queue").update({ status: "sending", attempts: (q.attempts || 0) + 1 }).eq("id", id).neq("status", "sending").select("id");
      if (!claim.data?.length) return json({ error: "Already being sent" }, 409);
      try {
        const l = await access();
        const isSO = q.kind === "SO", path = isSO ? "Invoices" : "PurchaseOrders", idKey = isSO ? "InvoiceID" : "PurchaseOrderID";
        const doc = { ...(q.payload || {}) } as Record<string, unknown>;
        if (q.action !== "create") { if (!q.xero_id) throw new Error("No Xero id to " + q.action + ": it was never created in Xero."); doc[idKey] = q.xero_id; }
        if (q.action === "delete") {
          /* a draft or awaiting approval is deleted; an approved invoice can only be voided (purchase orders: deleted) */
          const cur = await fetch("https://api.xero.com/api.xro/2.0/" + path + "/" + q.xero_id, { headers: { Authorization: "Bearer " + l.access_token, "xero-tenant-id": l.tenant_id, Accept: "application/json" } });
          const cj = await cur.json().catch(() => ({})), st = String((cj?.[path] || [])[0]?.Status || "");
          for (const k of Object.keys(doc)) if (k !== idKey) delete doc[k];
          doc.Status = isSO && st === "AUTHORISED" ? "VOIDED" : "DELETED";
        }
        const r = await fetch("https://api.xero.com/api.xro/2.0/" + path, { method: q.action === "create" ? "PUT" : "POST",
          headers: { Authorization: "Bearer " + l.access_token, "xero-tenant-id": l.tenant_id, Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ [path]: [doc] }) });
        const j = await r.json().catch(() => ({}));
        const el = (j?.Elements || [])[0], ve = (el?.ValidationErrors || []).map((v: any) => v.Message).join("; ");
        if (!r.ok || ve) throw new Error("Xero: " + (ve || j?.Detail || j?.Message || j?.Title || r.status));
        const xid = (j?.[path] || [])[0]?.[idKey] || q.xero_id;
        await admin().from("xero_queue").update({ status: "done", xero_id: xid, last_error: null, sent_at: new Date().toISOString(), sent_by: who!.email }).eq("id", id);
        return json({ ok: true, xero_id: xid });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await admin().from("xero_queue").update({ status: "failed", last_error: msg.slice(0, 1000) }).eq("id", id);
        return json({ error: msg }, 502);
      }
    }
    if (action === "sync_items") { const r = await syncItems(); return json(r, (r as any).error ? 502 : 200); }
    if (action === "sync_contacts") { const r = await syncContacts(); return json(r, (r as any).error ? 502 : 200); }
    if (action === "sync_all") { const a = await syncItems(), b = await syncContacts(); return json({ items: a, contacts: b }, (a as any).error || (b as any).error ? 502 : 200); }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
