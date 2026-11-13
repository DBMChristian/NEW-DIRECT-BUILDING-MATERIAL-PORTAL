// items-edit.ts (6 Nov 2026, Rosario): a sent PO's items changed in Direct (Edit items) are changed on DBM's order too,
// while that order is still Open in its portal. The rows come from the same builders that send the PO (handler.ts,
// pods.ts, concrete.ts), from Direct's load as it now stands, so codes, units and DBM's prices are DBM's own.
// Only on an order whose company is Direct Building Material Pty Ltd. OrderSteel: the order's item rows are replaced and
// its totals updated; OrderPods / OrderConcrete: the order's item slots are rewritten (slots no longer used emptied).
// DBM's Customer chat (OrderSteel) is told; every change is in Direct's audit_log.
import { DIRECT_CO } from "./delivery-edit.ts";
const s = (v: unknown) => String(v ?? "").trim();
const TOTALS = /^(sub_?total|gst|total|SUBTOTAL|GST|TOTAL|OC SUBTOTAL|OC GST|OC TOTAL)$/i;
type Out = { json: (b: unknown, st?: number) => Response; hide: (m: unknown) => string };
async function guard(o: { portal: string; db: any; table: string; idCol: string; companyCol: string; source: any; direct: any } & Out) {
  const ref = s(o.source?.supplier_ref);
  if (!ref) return { err: o.json({ error: "Not sent to " + o.portal + " yet: Direct's change is all there is." }, 409) };
  const { data: st } = await o.direct.from("dbm_order_status").select("status").eq("order_id", o.source.order_id).maybeSingle();
  if (!st) return { err: o.json({ error: o.portal + "'s status for " + ref + " is not known yet: try again in a minute." }, 409) };
  if (!/^open$/i.test(s(st.status))) return { err: o.json({ error: "Booked by DBM (" + o.portal + ": " + st.status + "): ask DBM to change it on " + ref + "." }, 409) };
  const sel = await o.db.from(o.table).select("*").eq(o.idCol, ref).maybeSingle();
  if (sel.error) return { err: o.json({ error: o.portal + ": " + o.hide(sel.error.message) }, 502) };
  if (!sel.data) return { err: o.json({ error: o.portal + " has no order " + ref + "." }, 404) };
  if (s(sel.data[o.companyCol]) !== DIRECT_CO) return { err: o.json({ error: ref + " is not an order of " + DIRECT_CO + ": nothing was changed." }, 403) };
  return { ref, before: sel.data };
}
const lineText = (rows: any[], code: string, qty: string) => rows.map((r) => s(r[qty]) + " × " + s(r[code])).filter((t) => !/^ ×|× $/.test(t)).join(", ");

/* OrderSteel: orders + order_items */
export async function pushItemsOS(o: { db: any; items: any[]; order: Record<string, unknown>; source: any; direct: any; email: string } & Out): Promise<Response> {
  const g = await guard({ ...o, portal: "OrderSteel", table: "orders", idCol: "order_id", companyCol: "company_name" });
  if ("err" in g) return g.err as Response;
  const { ref, before } = g as any;
  const old = await o.db.from("order_items").select("*").eq("order_id", before.id);
  if (old.error) return o.json({ error: "OrderSteel: " + o.hide(old.error.message) }, 502);
  const codeK = ["item_code", "code", "product_code"].find((k) => (o.items[0] || {})[k] !== undefined) || "code", qtyK = ["qty", "quantity"].find((k) => (o.items[0] || {})[k] !== undefined) || "qty";
  const was = lineText(old.data || [], codeK, qtyK), now = lineText(o.items, codeK, qtyK);
  /* the new rows in first; only then the old ones out (by their own ids), so a failure never leaves the order empty */
  /* line numbers are unique per order: the new rows go in at line + 1000, the old ones out, then the new ones renumbered */
  const want = o.items.map((l, i) => Number((l as any).line_no) || i + 1);
  const ins = await o.db.from("order_items").insert(o.items.map((l, i) => ({ ...l, order_id: before.id, line_no: want[i] + 1000 }))).select("id, line_no");
  if (ins.error) return o.json({ error: "Not changed in OrderSteel: " + o.hide(ins.error.message) }, 502);
  const oldIds = (old.data || []).map((r: any) => r.id).filter((x: unknown) => x != null);
  if (oldIds.length) { const del = await o.db.from("order_items").delete().in("id", oldIds).eq("order_id", before.id);
    if (del.error) { await o.db.from("order_items").delete().in("id", (ins.data || []).map((r: any) => r.id)); return o.json({ error: "Not changed in OrderSteel: " + o.hide(del.error.message) }, 502); } }
  for (const r of ins.data || []) { const u = await o.db.from("order_items").update({ line_no: Number(r.line_no) - 1000 }).eq("id", r.id);
    if (u.error) return o.json({ error: "Items changed in OrderSteel, but their line numbers not: " + o.hide(u.error.message) }, 502); }
  const tot = Object.fromEntries(Object.entries(o.order).filter(([k, v]) => TOTALS.test(k) && k in before && v !== undefined));
  if (Object.keys(tot).length) { const u = await o.db.from("orders").update(tot).eq("id", before.id); if (u.error) return o.json({ error: "Items changed in OrderSteel, totals not: " + o.hide(u.error.message) }, 502); }
  await o.direct.from("audit_log").insert({ who: o.email, action: "dbm_items_update", detail: o.source.po_no + " → OrderSteel " + ref + ": " + was + " → " + now });
  try { await o.db.from("order_chat_messages").insert({ order_id: before.id, chan: "customer", sender_email: o.email, sender_role: "customer", body: "Direct changed the items on " + ref + ": " + (was || "—") + " → " + (now || "—") }); } catch { /* the change stands */ }
  return o.json({ updated: true, portal: "OrderSteel", ref, was, now });
}

/* OrderPods / OrderConcrete: one row with numbered item slots ("1. Item", "1. Qty", …) */
export async function pushItemsSlots(o: { portal: "OrderPods" | "OrderConcrete"; db: any; table: string; row: Record<string, unknown>; source: any; direct: any; email: string } & Out): Promise<Response> {
  const g = await guard({ ...o, idCol: "Order ID", companyCol: "Company Name" });
  if ("err" in g) return g.err as Response;
  const { ref, before } = g as any;
  const slot = /^(\d+)\. /;
  const used = new Set(Object.keys(o.row).filter((k) => slot.test(k) && s(o.row[k]) !== "").map((k) => (k.match(slot) as RegExpMatchArray)[1]));
  const changes: Record<string, unknown> = {};
  for (const k of Object.keys(before)) {
    if (!slot.test(k) || /Retail|Cost Price|Return Qty/i.test(k)) continue;   // DBM's own columns (cost, retail, returns) stay as they are
    const n = (k.match(slot) as RegExpMatchArray)[1], v = k in o.row ? o.row[k] : (used.has(n) ? before[k] : null);
    if (s(v) !== s(before[k])) changes[k] = v === "" ? null : v;
  }
  for (const [k, v] of Object.entries(o.row)) if (TOTALS.test(k) && k in before && s(v) !== s(before[k])) changes[k] = v;
  if (!Object.keys(changes).length) return o.json({ updated: true, unchanged: true, portal: o.portal, ref });
  const items = (r: any) => Array.from({ length: 30 }, (_, i) => i + 1).map((n) => [s(r[n + ". Qty"]), s(r[n + ". Item Code"] ?? r[n + ". Item"])]).filter(([q, c]) => q && c).map(([q, c]) => q + " × " + c).join(", ");
  const was = items(before), now = items({ ...before, ...changes });
  const upd = await o.db.from(o.table).update(changes).eq("Order ID", ref);
  if (upd.error) return o.json({ error: "Not changed in " + o.portal + ": " + o.hide(upd.error.message) }, 502);
  await o.direct.from("audit_log").insert({ who: o.email, action: "dbm_items_update", detail: o.source.po_no + " → " + o.portal + " " + ref + ": " + was + " → " + now });
  return o.json({ updated: true, portal: o.portal, ref, was, now });
}
