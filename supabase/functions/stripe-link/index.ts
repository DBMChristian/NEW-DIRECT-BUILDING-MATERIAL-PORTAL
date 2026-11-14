// stripe-link (13 Nov 2026): a Stripe card payment link for what an order still owes, as the previous portal's.
// The amount is the order's total less the payments taken, plus the card surcharge while it applies (settings
// card_surcharge_pct, until surcharge_until). One live link per order: a changed amount closes the old link first.
// The link takes one payment; stripe-webhook records it on the order when the customer pays.
// Secrets: STRIPE_SECRET_KEY. Deploy: npx supabase functions deploy stripe-link --project-ref qnfuifckyfhiuvqyvkvf
import { createClient } from "jsr:@supabase/supabase-js@2";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const env = (k: string) => (Deno.env.get(k) ?? "").trim();
const cents = (n: number) => Math.round(n * 100);

function form(o: Record<string, unknown>, pre = ""): string[] {
  return Object.entries(o).flatMap(([k, v]) => { const key = pre ? pre + "[" + k + "]" : k;
    if (v == null) return []; if (Array.isArray(v)) return v.flatMap((x, i) => (typeof x === "object" ? form(x as Record<string, unknown>, key + "[" + i + "]") : [encodeURIComponent(key + "[" + i + "]") + "=" + encodeURIComponent(String(x))]));
    if (typeof v === "object") return form(v as Record<string, unknown>, key); return [encodeURIComponent(key) + "=" + encodeURIComponent(String(v))]; });
}
async function stripe(method: string, path: string, params: Record<string, unknown> = {}, idem?: string) {
  const body = form(params).join("&");
  const r = await fetch("https://api.stripe.com/v1" + path + (method === "GET" && body ? "?" + body : ""), { method,
    headers: { Authorization: "Basic " + btoa(env("STRIPE_SECRET_KEY") + ":"), "Content-Type": "application/x-www-form-urlencoded", ...(idem ? { "Idempotency-Key": idem } : {}) }, body: method === "POST" ? body : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Stripe: " + (j?.error?.message || r.status));
  return j;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await db.auth.getUser(token); const email = String(u?.user?.email || "").toLowerCase();
    const { data: st } = await db.from("staff").select("role, active, name").eq("email", email).maybeSingle();
    if (!st || !st.active || !["admin", "office"].includes(st.role)) return json({ error: "Only the office makes payment links" }, 403);
    if (!env("STRIPE_SECRET_KEY")) return json({ error: "Card payments are not switched on yet: the Stripe key is not set (STRIPE_SECRET_KEY)." });
    const body = await req.json().catch(() => ({}));
    const id = Number(body?.order_id); if (!Number.isSafeInteger(id) || id <= 0) return json({ error: "Send order_id" }, 400);
    const { data: o } = await db.from("orders").select("id, number, status, kind, customer_name, contact_name, contact_phone, email, total, paid").eq("id", id).maybeSingle();
    if (!o || o.status !== "placed" || o.kind !== "order") return json({ error: "Only a placed order is paid by card" }, 409);
    const owing = Math.round((Number(o.total) - Number(o.paid || 0)) * 100) / 100;
    if (!(owing > 0)) return json({ error: o.number + " is paid in full" }, 409);
    /* the card surcharge, while it applies */
    const { data: sets } = await db.from("settings").select("key, value").in("key", ["card_surcharge_pct", "surcharge_until", "portal_url"]);
    const S = Object.fromEntries((sets || []).map((x: any) => [x.key, x.value]));
    const pct = Number(S.card_surcharge_pct || 0), until = String(S.surcharge_until || ""), today = new Date().toISOString().slice(0, 10);
    const surcharge = pct > 0 && (!until || today <= until) ? Math.round(owing * pct) / 100 : 0;
    const amount = Math.round((owing + surcharge) * 100) / 100;
    /* the order's live link: kept when it is for the same amount, else closed */
    const { data: live } = await db.from("order_card_links").select("*").eq("order_id", id).eq("active", true).order("id", { ascending: false });
    for (const L of live || []) {
      if (cents(Number(L.amount)) === cents(amount)) {
        const link = await stripe("GET", "/payment_links/" + L.link_id);
        if (link.active) return json({ ok: true, url: L.url, amount, owing, surcharge, existing: true });
      }
      try { await stripe("POST", "/payment_links/" + L.link_id, { active: false }); } catch { /* already closed */ }
      await db.from("order_card_links").update({ active: false }).eq("id", L.id);
    }
    const meta = { order_id: String(id), order_no: o.number, owing: owing.toFixed(2), surcharge: surcharge.toFixed(2), portal_project: new URL(env("SUPABASE_URL")).hostname.split(".")[0] };
    const price = await stripe("POST", "/prices", { currency: "aud", unit_amount: cents(amount), product_data: { name: "Order " + o.number + " · Direct Building Material", metadata: meta } }, "dbm-price-" + id + "-" + cents(amount) + "-" + (live || []).length);
    const link = await stripe("POST", "/payment_links", { line_items: [{ price: price.id, quantity: 1 }], metadata: meta, payment_intent_data: { metadata: meta, description: "Order " + o.number + " · " + o.customer_name },
      payment_method_types: ["card"], restrictions: { completed_sessions: { limit: 1 } },
      after_completion: { type: "hosted_confirmation", hosted_confirmation: { custom_message: "Thank you: your payment for " + o.number + " is received. Direct Building Material." } } }, "dbm-link-" + price.id);
    await db.from("order_card_links").insert({ order_id: id, link_id: link.id, url: link.url, amount, surcharge, active: true, by_email: email, by_name: st.name || email.split("@")[0] });
    await db.from("order_events").insert({ order_id: id, part: "so", ref: o.number, text: "Card payment link made: $" + amount.toFixed(2) + (surcharge ? " (incl. $" + surcharge.toFixed(2) + " card surcharge)" : ""), by_email: email, by_name: st.name || email.split("@")[0] });
    return json({ ok: true, url: link.url, amount, owing, surcharge });
  } catch (e) { return json({ error: e instanceof Error ? e.message : String(e) }, 502); }
});
