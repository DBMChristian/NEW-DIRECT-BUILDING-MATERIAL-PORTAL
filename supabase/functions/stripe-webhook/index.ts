// stripe-webhook (13 Nov 2026): Stripe tells the portal a card payment link was paid; the payment is recorded on its
// order (the amount owed, the card surcharge noted), the link is closed, and the history says so. The request is checked
// against Stripe's signature (STRIPE_WEBHOOK_SECRET) before anything is written; a repeat of the same payment is ignored.
// In Stripe: Developers > Webhooks > Add endpoint: https://qnfuifckyfhiuvqyvkvf.supabase.co/functions/v1/stripe-webhook,
// event checkout.session.completed. Deploy: npx supabase functions deploy stripe-webhook --project-ref qnfuifckyfhiuvqyvkvf --no-verify-jwt
import { createClient } from "jsr:@supabase/supabase-js@2";
const env = (k: string) => (Deno.env.get(k) ?? "").trim();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

async function verified(payload: string, header: string): Promise<boolean> {
  const secret = env("STRIPE_WEBHOOK_SECRET"); if (!secret) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")).filter((p) => p.length === 2)) as Record<string, string>;
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  const t = Number(parts.t); if (!t || Math.abs(Date.now() / 1000 - t) > 600) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(t + "." + payload)));
  return sigs.some((s) => s.length === mac.length && s === mac);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const payload = await req.text();
  if (!(await verified(payload, req.headers.get("stripe-signature") || ""))) return new Response("Bad signature", { status: 400 });
  const ev = JSON.parse(payload);
  if (ev.type !== "checkout.session.completed") return new Response("ignored", { status: 200 });
  const s = ev.data?.object || {}, md = s.metadata || {};
  const id = Number(md.order_id);
  if (!id || s.payment_status !== "paid" || s.currency !== "aud") return new Response("not ours", { status: 200 });
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const ref = "Stripe " + (s.payment_intent || s.id);
  const { data: seen } = await db.from("order_payments").select("id").eq("order_id", id).eq("ref", ref).maybeSingle();
  if (seen) return new Response("already recorded", { status: 200 });
  const total = Number(s.amount_total || 0) / 100, surcharge = Number(md.surcharge || 0), amount = Math.round((total - surcharge) * 100) / 100;
  await db.from("order_payments").insert({ order_id: id, amount, method: "Card", ref: ref + (surcharge ? " · surcharge $" + surcharge.toFixed(2) : ""), paid_on: new Date().toISOString().slice(0, 10), by_email: "stripe", by_name: "Stripe (card link)" });
  if (s.payment_link) await db.from("order_card_links").update({ active: false, paid_at: new Date().toISOString() }).eq("link_id", s.payment_link);
  return new Response("recorded", { status: 200 });
});
