// delivery-edit.ts (6 Nov 2026, Rosario): a sent PO's delivery changed in Direct is changed on DBM's order too, while that
// order is still Open in its portal. Only the delivery fields (date, time, site, suburb, contact, notes), only those that
// changed, only on an order whose company is Direct Building Material Pty Ltd; DBM's Customer chat (OrderSteel) is told.
// The fields come from the same builders that send the PO (rules.ts, pods.ts, concrete.ts), so they are DBM's own format.
export const DIRECT_CO = "Direct Building Material Pty Ltd";
const LABEL: Record<string, string> = { booking_date: "date", booking_time: "time", site_address: "address", suburb: "suburb", contact_name: "contact", contact_phone: "phone",
  dbm_special_instructions: "notes", "Booking Date": "date", "Booking Time": "time", "Site Address": "address", "Suburb": "suburb", "Contact Name": "contact",
  "Contact Phone": "phone", "Customer Notes": "notes", "Gate Code": "gate code", "Trailer Access": "trailer access" };
/* notes compared without the "Sent from the Direct portal by …" line (who saved it last is not a change of delivery) */
const cmp = (k: string, v: unknown) => { let s = String(v ?? "").replace(/"/g, "").trim(); if (/notes|instructions/i.test(k)) s = s.split("\n").filter((l) => !/^Sent from the Direct portal/i.test(l.trim())).join("\n").trim(); return s; };
export async function pushDelivery(o: {
  portal: "OrderSteel" | "OrderPods" | "OrderConcrete"; db: any; table: string; idCol: string; companyCol: string; fields: Record<string, unknown>;
  source: any; direct: any; email: string; json: (b: unknown, s?: number) => Response; hide: (m: unknown) => string;
}): Promise<Response> {
  const ref = String(o.source?.supplier_ref || "").trim();
  if (!ref) return o.json({ error: "Not sent to " + o.portal + " yet: there is nothing to change there." }, 409);
  const { data: st } = await o.direct.from("dbm_order_status").select("status").eq("order_id", o.source.order_id).maybeSingle();
  if (!st) return o.json({ error: o.portal + "'s status for " + ref + " is not known yet: try again in a minute." }, 409);
  if (!/^open$/i.test(String(st.status || "").trim())) return o.json({ error: "Booked by DBM (" + o.portal + ": " + st.status + "): ask DBM to change it on " + ref + "." }, 409);
  const sel = await o.db.from(o.table).select("*").eq(o.idCol, ref).maybeSingle();
  if (sel.error) return o.json({ error: o.portal + ": " + o.hide(sel.error.message) }, 502);
  if (!sel.data) return o.json({ error: o.portal + " has no order " + ref + "." }, 404);
  if (String(sel.data[o.companyCol] || "").trim() !== DIRECT_CO) return o.json({ error: ref + " is not an order of " + DIRECT_CO + ": nothing was changed." }, 403);
  const before = sel.data, changes = Object.entries(o.fields).filter(([k, v]) => k in before && cmp(k, before[k]) !== cmp(k, v));
  if (!changes.length) return o.json({ updated: true, unchanged: true, portal: o.portal, ref });
  const upd = await o.db.from(o.table).update(Object.fromEntries(changes)).eq(o.idCol, ref);
  if (upd.error) return o.json({ error: "Not changed in " + o.portal + ": " + o.hide(upd.error.message) }, 502);
  const what = changes.map(([k, v]) => (LABEL[k] || k) + ": " + (cmp(k, before[k]) || "—") + " → " + (cmp(k, v) || "—")).join("; ");
  await o.direct.from("audit_log").insert({ who: o.email, action: "dbm_delivery_update", detail: o.source.po_no + " → " + o.portal + " " + ref + ": " + what.slice(0, 900) });
  if (o.portal === "OrderSteel" && before.id) {   /* DBM's team is told, in that order's Customer chat */
    try { await o.db.from("order_chat_messages").insert({ order_id: before.id, chan: "customer", sender_email: o.email, sender_role: "customer", body: "Direct changed the delivery on " + ref + ": " + what.slice(0, 1500) }); } catch { /* the change itself is done */ }
  }
  return o.json({ updated: true, portal: o.portal, ref, changed: changes.map((c) => LABEL[c[0]] || c[0]) });
}
