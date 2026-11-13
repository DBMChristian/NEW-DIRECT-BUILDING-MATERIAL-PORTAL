// website-lead (13 Nov 2026): an enquiry from Direct's website arrives here and goes on Home > Website enquiries.
// Sent by the previous portal as each one is saved (its website_leads table), or by the website itself later.
//   POST { name, phone, email, site_address, product, description, attachment_url, temp, status, seller, created_at, ref }
//   header x-lead-key: the shared key (WEBSITE_LEAD_KEY). A second delivery of the same ref is ignored.
// Deploy: npx supabase functions deploy website-lead --project-ref qnfuifckyfhiuvqyvkvf --no-verify-jwt
import { createClient } from "jsr:@supabase/supabase-js@2";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-lead-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const env = (k: string) => (Deno.env.get(k) ?? "").trim();
const s = (v: unknown, n = 2000) => String(v ?? "").trim().slice(0, n);
const STATUS: Record<string, string> = { new: "new", "working on it": "working", working: "working", quoted: "quoted", won: "quoted", lost: "closed", closed: "closed" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const key = env("WEBSITE_LEAD_KEY");
  if (!key || req.headers.get("x-lead-key") !== key) return json({ error: "Wrong key" }, 401);
  const b = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!b || !s(b.name) && !s(b.phone) && !s(b.email)) return json({ error: "Send at least a name, phone or email" }, 400);
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const row = { name: s(b.name, 200), phone: s(b.phone, 50), email: s(b.email, 200).toLowerCase(), site_address: s(b.site_address, 300), product: s(b.product, 100),
    message: s(b.description ?? b.message), attachment_url: /^https:\/\//.test(s(b.attachment_url)) ? s(b.attachment_url, 500) : "", temp: s(b.temp, 30),
    status: STATUS[s(b.status).toLowerCase()] || "new", source_ref: s(b.ref, 100) || null,
    ...(b.created_at ? { created_at: s(b.created_at, 40) } : {}) };
  const r = await db.from("enquiries").upsert(row, { onConflict: "source_ref", ignoreDuplicates: true }).select("id");
  if (r.error) return json({ error: r.error.message }, 500);
  return json({ ok: true, id: r.data?.[0]?.id ?? null });
});
