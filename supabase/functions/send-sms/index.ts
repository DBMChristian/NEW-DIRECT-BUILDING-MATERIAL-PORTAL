// send-sms (13 Nov 2026): one text message to a customer's mobile through Twilio, for the booking confirmation.
// Office and admin. Secrets: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM (the sending number) or
// TWILIO_MESSAGING_SERVICE_SID. The order's history records it. Deploy: npx supabase functions deploy send-sms --project-ref qnfuifckyfhiuvqyvkvf
import { createClient } from "jsr:@supabase/supabase-js@2";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const env = (k: string) => (Deno.env.get(k) ?? "").trim();
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
    const { data: u } = await db.auth.getUser((req.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""));
    const email = String(u?.user?.email || "").toLowerCase();
    const { data: st } = await db.from("staff").select("role, active, name").eq("email", email).maybeSingle();
    if (!st || !st.active || !["admin", "office"].includes(st.role)) return json({ error: "Only the office sends texts" }, 403);
    const sid = env("TWILIO_ACCOUNT_SID"), tok = env("TWILIO_AUTH_TOKEN"), from = env("TWILIO_FROM"), svc = env("TWILIO_MESSAGING_SERVICE_SID");
    if (!sid || !tok || (!from && !svc)) return json({ error: "Texts are not switched on yet: the Twilio details are not set." });
    const b = await req.json().catch(() => ({}));
    let to = String(b?.to || "").replace(/[^0-9+]/g, ""); if (/^04\d{8}$/.test(to)) to = "+61" + to.slice(1); else if (/^614\d{8}$/.test(to)) to = "+" + to;
    if (!/^\+614\d{8}$/.test(to)) return json({ error: "Not an Australian mobile: " + b?.to }, 400);
    const text = String(b?.text || "").slice(0, 612); if (!text) return json({ error: "No text" }, 400);
    const form = new URLSearchParams({ To: to, Body: text, ...(svc ? { MessagingServiceSid: svc } : { From: from }) });
    const r = await fetch("https://api.twilio.com/2010-04-01/Accounts/" + sid + "/Messages.json", { method: "POST", headers: { Authorization: "Basic " + btoa(sid + ":" + tok), "Content-Type": "application/x-www-form-urlencoded" }, body: form });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: "Twilio: " + (j?.message || r.status) }, 502);
    if (b?.order_id) await db.from("order_events").insert({ order_id: Number(b.order_id), part: "so", ref: String(b?.ref || ""), text: (b?.label || "Text") + " sent to " + to, by_email: email, by_name: st.name || email.split("@")[0] });
    return json({ ok: true, sid: j.sid });
  } catch (e) { return json({ error: e instanceof Error ? e.message : String(e) }, 500); }
});
