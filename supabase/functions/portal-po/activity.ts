// activity.ts (11 Nov 2026): what DBM's portal shows for a PO Direct sent there, read live and read-only: the order's
// status exactly as the portal has it, its booking, and its activity (OrderSteel: the order's activity log and its
// customer chat; OrderPods / OrderConcrete: the order's activity column). Nothing is written anywhere.
type Ev = { at: string; action: string; details: string; user: string };
const s = (v: unknown) => String(v ?? "").trim();
/* OrderPods / OrderConcrete: their order chat, found from the portal's own API description (the table whose name has
   "chat" and that has an order column and a message column), so nothing is guessed against the wrong table */
type ChatMap = { table: string; order: string; orderIsUuid: boolean; body: string; at: string; email?: string; name?: string; role?: string; file?: string; reply?: string; id?: string; cols: string[] };
const chatMaps: Record<string, ChatMap | null> = {};
async function findChat(cfg?: { url?: string; key?: string }): Promise<ChatMap | null> {
  if (!cfg?.url || !cfg?.key) return null;
  if (cfg.url in chatMaps) return chatMaps[cfg.url];
  let m: ChatMap | null = null;
  try {
    const r = await fetch(cfg.url.replace(/\/$/, "") + "/rest/v1/", { headers: { apikey: cfg.key, Authorization: "Bearer " + cfg.key, Accept: "application/openapi+json" } });
    const spec = await r.json(), defs = spec?.definitions || {};
    const pick = (cols: Record<string, any>, re: RegExp) => Object.keys(cols).find((k) => re.test(k));
    for (const [t, d] of Object.entries<any>(defs)) {
      if (!/chat/i.test(t) || /read|reaction|mention|emailed|seen|typing/i.test(t)) continue;
      const cols = d?.properties || {}, order = pick(cols, /^(order_id|order_uuid|order_ref|order id|order)$/i), body = pick(cols, /^(body|message|text|comment|content)$/i);
      if (!order || !body) continue;
      m = { table: t, order, orderIsUuid: /uuid/i.test(String(cols[order]?.format || "")), body, at: pick(cols, /^(created_at|sent_at|timestamp|created)$/i) || "created_at",
        email: pick(cols, /^(sender_email|user_email|email|from_email)$/i) || pick(cols, /^(sender|user|author|created_by|from|by|sent_by|posted_by)$/i), name: pick(cols, /^(sender_name|user_name|author_name|display_name|name|full_name)$/i), role: pick(cols, /^(sender_role|role|sender_type|side|from_side)$/i), cols: Object.keys(cols), file: pick(cols, /^(file_url|file|attachment|attachment_url)$/i),
        reply: pick(cols, /^(reply_to|reply_to_id|parent_id)$/i), id: pick(cols, /^id$/i) };
      if (/order_chat_messages/i.test(t)) break;
    }
  } catch { m = null; }
  chatMaps[cfg.url] = m; return m;
}
async function slotChat(db: any, map: ChatMap | null, orderKey: string) {
  if (!map) return { chat_ok: false, chat: [] as any[] };
  let q = db.from(map.table).select("*").eq(map.order, orderKey);
  if (map.table === "order_chat_messages") q = q.eq("chan", "customer");
  const r = await q.order(map.at, { ascending: true }).limit(300);
  if (r.error) return { chat_ok: false, chat: [] as any[], chat_error: r.error.message };
  return { chat_ok: true, chat_cols: map.cols, chat_who: !!(map.email || map.name), chat: (r.data || []).map((x: any) => ({ id: map.id ? Number(x[map.id]) : null, at: s(x[map.at]) || s(map.cols.map((k) => /^(created_at|sent_at|timestamp|created|sent|time)$/i.test(k) ? x[k] : "").find(Boolean)), body: s(x[map.body]), user: s(map.email ? x[map.email] : ""),
    mine: /direct|customer/i.test(s(map.role ? x[map.role] : "")) || /directbuildingmaterial|^direct\b/i.test(s(map.email ? x[map.email] : "") + " " + s(map.name ? x[map.name] : "")) || /^direct\b/i.test(s(map.name ? x[map.name] : "")), name: s(map.name ? x[map.name] : ""), file_url: s(map.file ? x[map.file] : ""), reply_to: map.reply && x[map.reply] != null ? Number(x[map.reply]) : null, reactions: {} })) };
}
export const portalOfRef = (ref: string) => /^WP/i.test(ref) ? "OrderPods" : /^CON/i.test(ref) ? "OrderConcrete" : "OrderSteel";
const parseLog = (raw: unknown): Ev[] => {
  let a: any[] = []; try { a = Array.isArray(raw) ? raw : JSON.parse(s(raw) || "[]"); } catch { a = []; }
  return (Array.isArray(a) ? a : []).map((x: any) => ({ at: s(x.timestamp ?? x.at ?? x.date ?? x.created_at), action: s(x.action ?? x.type ?? x.event), details: s(x.details ?? x.detail ?? x.note ?? x.message), user: s(x.user ?? x.by ?? x.email) }))
    .filter((e) => e.action || e.details);
};
export async function portalActivity(ref: string, c: { os?: any; pods?: any; oc?: any; podsCfg?: { url?: string; key?: string }; ocCfg?: { url?: string; key?: string } }) {
  const portal = portalOfRef(ref);
  if (portal === "OrderSteel") {
    if (!c.os) return { portal, ref, error: "The link to OrderSteel is not set up." };
    const o = await c.os.from("orders").select("*").eq("order_id", ref).maybeSingle();
    if (o.error || !o.data) return { portal, ref, error: o.error ? "OrderSteel: " + o.error.message : "OrderSteel has no order " + ref };
    const r = o.data, events = parseLog(r.orders_activity);
    const chat: { id: number; at: string; body: string; user: string; mine: boolean; file_url: string; reply_to: number | null; reactions: Record<string, string[]> }[] = [];
    try { const ch = await c.os.from("order_chat_messages").select("id, created_at, body, file_url, reply_to, sender_email, sender_role, chan").eq("order_id", r.id).eq("chan", "customer").order("created_at", { ascending: true }).limit(300);
      const ids = (ch.data || []).map((m: any) => m.id), rx: Record<string, Record<string, string[]>> = {};
      if (ids.length) { const rr = await c.os.from("order_chat_reactions").select("message_id, emoji, email").in("message_id", ids);
        for (const x of rr.data || []) { const k = String(x.message_id); (rx[k] = rx[k] || {}); (rx[k][x.emoji] = rx[k][x.emoji] || []).push(s(x.email)); } }
      for (const m of ch.data || []) chat.push({ id: Number(m.id), at: s(m.created_at), body: s(m.body), user: s(m.sender_email), mine: s(m.sender_role) === "customer" || s(m.sender_role) === "direct", file_url: s(m.file_url), reply_to: m.reply_to == null ? null : Number(m.reply_to), reactions: rx[String(m.id)] || {} }); } catch { /* the activity log alone */ }
    return { portal, ref, status: s(r.order_status), booking_date: s(r.booking_date), booking_time: s(r.booking_time).replace(/"/g, ""), events, chat, chat_ok: true };
  }
  const db = portal === "OrderPods" ? c.pods : c.oc, table = portal === "OrderPods" ? "Wafflepods" : "Concrete";
  if (!db) return { portal, ref, error: "The link to " + portal + " is not set up." };
  const o = await db.from(table).select("*").eq("Order ID", ref).maybeSingle();
  if (o.error || !o.data) return { portal, ref, error: o.error ? portal + ": " + o.error.message : portal + " has no order " + ref };
  const r = o.data, events: Ev[] = [];
  for (const k of Object.keys(r)) if (/activity|history/i.test(k)) events.push(...parseLog(r[k]));
  const map = await findChat(portal === "OrderPods" ? c.podsCfg : c.ocCfg);
  const chat = map ? await slotChat(db, map, map.orderIsUuid ? s(r.id) : ref) : { chat_ok: false, chat: [] };
  return { portal, ref, status: s(r["Order Status"]), booking_date: s(r["Booking Date"]), booking_time: s(r["Booking Time"]).replace(/"/g, ""), events, ...chat, chat_table: map?.table || null };
}

/* a message from Direct into the order's customer chat in DBM's portal (OrderSteel), as Direct's own messages go there:
   text, an attachment (a link Direct uploaded, as OrderSteel's own chat uploads), a reply to one of the order's messages */
/* Direct writes in DBM's chats as the customer it is: from Direct's own address (so the portal shows it as Direct
   Building Material, the customer, not as one of DBM's staff), with the person's name at the start of the message */
const DIRECT_EMAIL = "orders@directbuildingmaterial.com.au";
const personOf = (email: string) => String(email || "").split("@")[0].split(/[._-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
export async function portalChatSend(ref: string, body0: string, staffEmail: string, c: { os?: any; pods?: any; oc?: any; podsCfg?: { url?: string; key?: string }; ocCfg?: { url?: string; key?: string } }, extra: { file_url?: string; reply_to?: number | null } = {}) {
  /* the person, at Direct: their name before the @ at Direct's own address (rosario.t@directbuildingmaterial.com.au), so
     DBM's chat shows "Rosario T" on the customer's side, never one of DBM's own staff; the message as typed */
  const local = String(staffEmail || "").split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g, ""), portal = portalOfRef(ref), file = s(extra.file_url), who = personOf(staffEmail);
  const email = local ? local + "@directbuildingmaterial.com.au" : DIRECT_EMAIL, text = s(body0).slice(0, 2000);
  if (!text && !file) return { error: "Type a message" };
  if (file && !/^https:\/\/res\.cloudinary\.com\//.test(file)) return { error: "That attachment is not one Direct uploaded." };
  if (portal !== "OrderSteel") {
    const db = portal === "OrderPods" ? c.pods : c.oc, table = portal === "OrderPods" ? "Wafflepods" : "Concrete", map = await findChat(portal === "OrderPods" ? c.podsCfg : c.ocCfg);
    if (!db || !map) return { error: portal + "'s order chat was not found: phone or email DBM." };
    const o = await db.from(table).select("*").eq("Order ID", ref).maybeSingle();
    if (o.error || !o.data) return { error: o.error ? portal + ": " + o.error.message : portal + " has no order " + ref };
    if (s(o.data["Company Name"]) && s(o.data["Company Name"]) !== "Direct Building Material Pty Ltd") return { error: ref + " is not an order of Direct Building Material: nothing was sent." };
    const row: Record<string, unknown> = { [map.order]: map.orderIsUuid ? o.data.id : ref, [map.body]: text || (file ? "attachment" : "") };
    if (map.table === "order_chat_messages") row.chan = "customer";
    /* the time, in every time column the chat keeps (its own list orders by one of them): a message from Direct takes its
       place at the bottom, after what is already there, as in OrderSteel's chat */
    const now = new Date().toISOString();
    for (const k of map.cols) if (/^(created_at|sent_at|timestamp|created|sent|date_sent|message_time|time)$/i.test(k)) row[k] = now;
    if (map.email) row[map.email] = email; if (map.name) row[map.name] = "Direct Building Material" + (who ? " (" + who + ")" : ""); if (map.role) row[map.role] = "customer"; if (map.file && file) row[map.file] = file; if (map.reply && extra.reply_to != null) row[map.reply] = Number(extra.reply_to);
    const ins = await db.from(map.table).insert(row).select("*").single();
    if (ins.error) return { error: "Not sent: " + ins.error.message };
    return { ok: true };
  }
  if (!c.os) return { error: "The link to OrderSteel is not set up." };
  const o = await c.os.from("orders").select("id, company_name").eq("order_id", ref).maybeSingle();
  if (o.error || !o.data) return { error: o.error ? "OrderSteel: " + o.error.message : "OrderSteel has no order " + ref };
  if (s(o.data.company_name) !== "Direct Building Material Pty Ltd") return { error: ref + " is not an order of Direct Building Material: nothing was sent." };
  let reply: number | null = null;
  if (extra.reply_to != null && Number.isSafeInteger(Number(extra.reply_to))) {
    const pm = await c.os.from("order_chat_messages").select("id").eq("id", Number(extra.reply_to)).eq("order_id", o.data.id).eq("chan", "customer").maybeSingle();
    if (pm.data) reply = Number(pm.data.id);
  }
  const ins = await c.os.from("order_chat_messages").insert({ order_id: o.data.id, chan: "customer", sender_email: email, sender_role: "customer", body: text || (file ? "attachment" : ""), file_url: file || null, reply_to: reply }).select("id, created_at").single();
  if (ins.error) return { error: "Not sent: " + ins.error.message };
  return { ok: true, id: ins.data?.id, at: s(ins.data?.created_at) };
}
