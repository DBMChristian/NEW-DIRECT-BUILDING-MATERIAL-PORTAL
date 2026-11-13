// pods.ts (30 Oct 2026): Direct's waffle pods to DBM's OrderPods (Supabase rfgrdkaadtcgewfpctoc, table "Wafflepods"),
// one row per drop-ship purchase order, exactly as OrderPods' own order form saves one (Orderpods repo,
// src/pages/WafflePodsOrderForm.jsx submitOrder, main = staging there) and as the Styrofoam team keys in Direct's orders
// today (WP1002533 = Direct's PO-1004, WP1002707):
//  * Company "Direct Building Material Pty Ltd", ACC, Customer PO# = Direct's PO number, Ship Via "Wafflepods",
//    status "Open", booking SMS and email "Yes", payment link "Yes", Xero: "Upload to MYOB" Y and "Do you want to Upload
//    this to MYOB?" Y (DBM invoices Direct), PO0 = Styrofoam Industries Pty Ltd with "PO0 Upload to MYOB" Y, PO1-PO9 off;
//  * lines in slots 1-26 and 28: code, the catalog description, qty, Direct's price (its Customer Price row, else the
//    "Standard Price" row; resolvePrice), the Styrofoam cost from the Sydney/NSW or Canberra/ACT column, PO group 0;
//  * WPDEL in slot 27 on a delivery: a suburb on "Delivery Prices Per Suburb" wins, else Sydney = the price list
//    (Direct $200), Canberra $650 (computeWpdelEffectivePrice); its cost = its price;
//  * on Scrap Pick-up: WPENVIRO $90 in slot 29 (cost $90) and WPSB free in slot 30, 1 bag up to 79 pods, then one more
//    every 40 (calculateScrapBagQty), cost blank;
//  * totals as OrderPods' trigger wp_order_defaults works them out (line round(price x qty, 2), GST and total).
// Outside Sydney and Canberra OrderPods charges by driving time (a maps lookup): not sent from here, for now.
// The Order ID (WP...) comes from OrderPods' own trigger. Its insert triggers: Styrofoam's feed only notes orders placed
// by a signed-in person (not this one), DBM's Accounts app is pinged (harmless). A test is a Quote for ZZ TEST DELETE ME 1
// with every message, payment link and Xero flag off.
import { splitSite, phone11, splitContact } from "./rules.ts";
import { pushDelivery } from "./delivery-edit.ts";
import { pushItemsSlots } from "./items-edit.ts";

export const POD = {
  company: "Direct Building Material Pty Ltd", standard: "Standard Price", supplier: "Styrofoam Industries Pty Ltd",
  email: "accounts@directbuildingmaterial.com.au", testCompany: "ZZ TEST DELETE ME 1", warehouse: { street: "16 Cassola Place", suburb: "Penrith" },
};
/* "Customer PO#" has a # in it, which a web address reads as the start of a bookmark: in a filter it is quoted, as
   PostgREST expects names with symbols ("Wafflepods.Customer PO does not exist" otherwise). In the saved row it is a JSON key. */
const PO_COL = '"Customer PO#"';
export const isWaffle = (category: unknown) => /\bwaffle\b/i.test(String(category ?? ""));
const AUTO: Record<string, { slot: number; desc: string }> = {
  WPDEL: { slot: 27, desc: "Waffle Pod Truck & Trailer Del" }, WPENVIRO: { slot: 29, desc: "Environmental Levy" }, WPSB: { slot: 30, desc: "Waffle Pod Scrap Bag" },
};
export const LINE_SLOTS = [...Array.from({ length: 26 }, (_, i) => i + 1), 28];   // the slots a person may type into
export const SCRAP_SOURCE = new Set(["EPS-C", "EPS- Circular", "WPSP175", "WPSP300", "WP300", "WPSP100", "WP375", "WPSP150", "WP225", "WP150"]);
export const ENVIRO_PRICE = 90;
export const CANBERRA_FREIGHT = 650;
/* calculateScrapBagQty: 1-79 = 1 · 80-119 = 2 · 120-159 = 3 … */
export const scrapBags = (pods: number) => (!pods || pods <= 0) ? 0 : pods <= 79 ? 1 : Math.floor((pods - 80) / 40) + 2;
const clean = (v: unknown) => String(v ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const suburbKey = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ").toLowerCase();
/* "$9.50", "9.5", "1,300.00" -> a number; blank -> null */
export const money = (v: unknown): number | null => { const s = String(v ?? "").replace(/[^0-9.-]/g, ""); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
/* Direct's zone -> OrderPods' Location (Sydney, Canberra; the others need driving time) */
export const podLocation = (zone: unknown): string | null => /\bsydney\b/i.test(String(zone ?? "")) ? "Sydney" : /^\s*canberra\b/i.test(String(zone ?? "")) ? "Canberra"
  : /^\s*act\b/i.test(String(zone ?? "")) ? "ACT" : /^\s*nsw\b/i.test(String(zone ?? "")) ? "NSW" : null;   /* NSW / ACT (Long Distance), 11 Nov 2026 */
/* OrderPods' long-distance freight (computeWpdelEffectivePrice): one-way hours rounded (.00-.24 down, .25-.44 to .5, up), x 2 + 0.5, x $100 */
export const roundHrs = (h: number) => { const w = Math.floor(h), d = Number((h - w).toFixed(2)); return d <= 0.24 ? w : d <= 0.44 ? w + 0.5 : w + 1; };
export const longFreight = (hrs: unknown): number | null => { const h = Number(String(hrs ?? "").replace(/[^0-9.]/g, "")); return h > 0 ? Number(((roundHrs(h) * 2 + 0.5) * 100).toFixed(2)) : null; };
/* Direct's slot as OrderPods' booking time (its options are stored in quotes: "AM", "PM", "ANYTIME", "07:00" …) */
export function podTime(slot: unknown): { time: string; note: string } {
  const s = clean(slot), l = s.toLowerCase();
  if (l === "am") return { time: '"AM"', note: "" };
  if (l === "pm") return { time: '"PM"', note: "" };
  if (!l || l === "any time" || l === "anytime") return { time: '"ANYTIME"', note: "" };
  if (/first drop/.test(l)) return { time: '"AM"', note: "First drop" };
  if (/last drop/.test(l)) return { time: '"PM"', note: "Last drop" };
  if (/\d\s*-\s*\d|\d\s*am/.test(l)) return { time: '"AM"', note: "Time window: " + s };
  if (/pm/.test(l)) return { time: '"PM"', note: "Time window: " + s };
  return { time: '"ANYTIME"', note: "Time window: " + s };
}

export type PodSource = {
  order_id: number; po_no: string; quote_no: string; customer: string; contact?: string | null; contact_name?: string | null;
  ds_route: string; site?: string | null; site_contact?: string | null; site_notes?: string | null; want_date?: string | null; slot?: string | null;
  col: string; stream: string; supplier_ref?: string | null; job?: Record<string, unknown> | null;
  lines: { item_id: number | null; name: string; qty: number; code?: string | null; category?: string | null }[];
};
export type PodChoice = { lines?: { item_id: number; qty: number }[]; deliveries?: number; contact_name?: string; contact_phone?: string; notes?: string };
export type PodCatalogue = {
  prices: Map<string, number>;                          // "company|code" -> the current Customer Price row (Direct, Standard Price)
  costs: Map<string, { syd: number | null; cbr: number | null }>;   // code -> the Styrofoam cost row
  descriptions: Map<string, string>;                    // code -> the Products description
  suburbs: Map<string, number>;                         // suburbKey -> Delivery Prices Per Suburb, Ex GST
};
/* resolvePrice: Direct's own row, else the Standard Price row */
export const podPrice = (cat: PodCatalogue, code: string): number | null => cat.prices.get(POD.company + "|" + code) ?? cat.prices.get(POD.standard + "|" + code) ?? null;

export function buildPods(src: PodSource, choice: PodChoice, cat: PodCatalogue, who: string, now: Date) {
  const problems: string[] = [], warnings: string[] = [], skipped: { name: string; why: string }[] = [];
  if (src.stream !== "dropship") problems.push("Only a drop-ship purchase order is sent to OrderPods.");
  if (src.col === "Cancelled") problems.push("This purchase order is cancelled.");
  else if (src.col !== "To order") problems.push("This purchase order is already " + src.col + ".");
  if (clean(src.supplier_ref)) problems.push("This purchase order was already sent: " + clean(src.supplier_ref) + ".");
  const route = src.ds_route === "direct" ? "site" : src.ds_route === "penrith" ? "warehouse" : "";
  if (!route) problems.push("This purchase order has no route (to the site or to the warehouse).");
  const job = (src.job && typeof src.job === "object" ? src.job : {}) as Record<string, unknown>;
  const yes = (v: unknown) => /^y(es)?$/i.test(clean(v));

  // the zone: Direct's waffle pod Location; the warehouse is in Sydney
  const location = route === "warehouse" ? "Sydney" : podLocation(job.location);
  if (route === "site" && !clean(job.location)) problems.push("This order has no waffle pod Location (delivery zone).");
  else if (route === "site" && !location) problems.push("OrderPods does not know the location " + clean(job.location) + ".");
  else if ((location === "NSW" || location === "ACT") && longFreight(job.distance_hrs) === null) problems.push("Long distance (" + location + "): the order has no driving time.");
  const costCol = location === "Canberra" || location === "ACT" ? "cbr" : "syd";
  const scrap = route === "site" && yes(job.scrap_pickup);

  // the lines: waffle pods only, the ticked ones at their quantities
  const chosen = choice.lines ? new Map(choice.lines.map((c) => [Number(c.item_id), Number(c.qty)])) : null;
  if (chosen) for (const [id, q] of chosen) if (!(q > 0) || q > 100000 || !Number.isFinite(q)) problems.push("A quantity must be more than 0 (product " + id + ").");
  const lines: { slot: number; code: string; description: string; qty: number; price: number; cost: number | null; auto?: boolean }[] = [];
  const free = [...LINE_SLOTS];
  for (const l of src.lines || []) {
    const name = clean(l.name) || "a line";
    if (!isWaffle(l.category)) { skipped.push({ name, why: "Not waffle pods: order it the usual way." }); continue; }
    if (l.item_id == null) { skipped.push({ name, why: "Not linked to a product." }); continue; }
    if (chosen && !chosen.has(Number(l.item_id))) { skipped.push({ name, why: "Not ticked." }); continue; }
    const qty = chosen ? chosen.get(Number(l.item_id))! : Number(l.qty);
    const code = clean(l.code);
    if (!code) { problems.push(name + " has no Item code: add it in Product Management."); continue; }
    if (AUTO[code] && code !== "WPSB") { problems.push(name + " (" + code + ") is added by OrderPods itself: untick it."); continue; }
    // Direct's own scrap bag line (added when Scrap pick-up is Yes, Direct's charge to its customer): OrderPods adds the
    // free bags itself in slot 30, as on WP1002533, so this one is not sent (it would be a second, charged WPSB)
    if (code === "WPSB" && scrap) { skipped.push({ name, why: "OrderPods adds the free scrap bags itself (scrap pick-up)." }); continue; }
    const description = cat.descriptions.get(code);
    if (description === undefined) { problems.push(name + ": OrderPods has no product " + code + "."); continue; }
    const price = podPrice(cat, code);
    if (price === null) problems.push(name + " (" + code + ") has no price for Direct in OrderPods.");
    if (!Number.isInteger(qty)) problems.push(name + ": waffle pods go in whole numbers (" + qty + ").");
    const slot = free.shift();
    if (slot === undefined) { problems.push("At most " + LINE_SLOTS.length + " lines fit on one OrderPods order."); break; }
    const c = cat.costs.get(code);
    lines.push({ slot, code, description, qty, price: price ?? 0, cost: c ? c[costCol] : null });
  }
  if (!lines.length) problems.push("Nothing on this purchase order can be sent to OrderPods.");

  // where: the site (or Direct's warehouse), the contact who meets the truck, the date
  const where = route === "warehouse" ? POD.warehouse : splitSite(src.site);
  if (route === "site" && (!where.street || !where.suburb)) problems.push("The site address needs a street and a suburb.");
  const sc = splitContact(job.site_contact ?? src.site_contact);
  const contactName = clean(choice.contact_name) || (route === "site" ? sc.name || clean(src.contact_name) : "");
  const contactPhone = phone11(choice.contact_phone || (route === "site" ? sc.phone || src.contact : ""));
  if (!contactName) problems.push("Enter the contact name for the delivery.");
  if (!contactPhone) problems.push("Enter the contact's phone: an Australian number, e.g. 0412 345 678.");
  const confirmed = clean(job.delivery_confirmed).toLowerCase() !== "no";
  const date = confirmed && src.want_date ? String(src.want_date).slice(0, 10) : "";
  if (date && date < now.toISOString().slice(0, 10)) problems.push("The delivery date (" + date + ") has passed: change it on the order first.");
  const t = podTime(job.delivery_requested_slot ?? src.slot);

  // the three OrderPods adds itself
  const deliveries = Math.trunc(Number(choice.deliveries ?? 1));
  if (!(deliveries >= 1) || deliveries > 10) problems.push("Deliveries must be 1 to 10.");
  const suburbPrice = cat.suburbs.get(suburbKey(where.suburb));
  const freight = suburbPrice !== undefined ? suburbPrice : location === "Canberra" ? CANBERRA_FREIGHT : location === "Sydney" ? podPrice(cat, "WPDEL") : location === "NSW" || location === "ACT" ? longFreight(job.distance_hrs) : null;
  if (freight === null && location) problems.push("OrderPods has no delivery price (WPDEL) for Direct.");
  if (deliveries >= 1) lines.push({ slot: AUTO.WPDEL.slot, code: "WPDEL", description: AUTO.WPDEL.desc, qty: deliveries, price: freight ?? 0, cost: freight ?? null, auto: true });
  if (scrap) {
    lines.push({ slot: AUTO.WPENVIRO.slot, code: "WPENVIRO", description: AUTO.WPENVIRO.desc, qty: 1, price: ENVIRO_PRICE, cost: ENVIRO_PRICE, auto: true });
    const pods = lines.filter((x) => !x.auto && SCRAP_SOURCE.has(x.code)).reduce((a, x) => a + x.qty, 0), bags = scrapBags(pods);
    if (bags) lines.push({ slot: AUTO.WPSB.slot, code: "WPSB", description: AUTO.WPSB.desc, qty: bags, price: 0, cost: null, auto: true });
  }
  lines.sort((a, b) => a.slot - b.slot);

  // the money, as wp_order_defaults works it out
  const sub = r2(lines.reduce((a, x) => a + r2(x.price * x.qty), 0)), gst = r2(sub * 0.1), total = r2(sub * 1.1);
  const notes = [clean(choice.notes), clean(job.reference) && "Direct's reference: " + clean(job.reference), clean(src.site_notes) && "Site notes: " + clean(src.site_notes),
    t.note, "Sent from the Direct portal by " + who + " · " + src.po_no + " · " + src.quote_no].filter(Boolean).join("\n");
  const sydney = new Date(now.toLocaleString("en-US", { timeZone: "Australia/Sydney" })), p2 = (n: number) => String(n).padStart(2, "0");
  const row: Record<string, unknown> = {
    "Company Name": POD.company, "Purchasing Company": "", "Gate Code": clean(job.gate_code) || "N/A", "Trailer Access": yes(job.trailer_access) ? "Yes" : "No",
    "Location": location, "COD or ACC": "ACC", "Order or Quote": "Order", "Customer PO#": src.po_no, "Delivery or Pick-up": "Delivery",
    "Scrap Pick-up": scrap ? "Yes" : "No", "Contact Name": contactName, "Contact Phone": contactPhone, "Site Address": where.street, "Suburb": where.suburb,
    "Customer Email Address": POD.email, "Booking Date": date || null, "Booking Time": date ? t.time : "", "Customer Notes": notes,
    "Distance KM": "", "Distance in Hrs": clean(job.distance_hrs), "Special Instructions to Driver": clean(choice.notes),
    "Get SMS Booking Confirmation": "Yes", "Get Email Booking Confirmation": "Yes", "Submitted by": who,
    "Date Submitted": `${sydney.getFullYear()}-${p2(sydney.getMonth() + 1)}-${p2(sydney.getDate())} ${p2(sydney.getHours())}:${p2(sydney.getMinutes())}:${p2(sydney.getSeconds())}`,
    "Ship Via": "Wafflepods", "Salesperson": contactName, "Generate Payment Link": "Yes", "Upload to MYOB": "Y", "Do you want to Upload this to MYOB?": "Y",
    "Order Status": "Open",
  };
  for (let g = 0; g < 10; g++) {
    row[`PO${g} Supplier`] = g === 0 ? POD.supplier : ""; row[`PO${g} Delivery Date`] = g === 0 ? date || null : null;
    row[`PO${g} Upload to MYOB`] = g === 0 ? "Y" : "N"; row[`PO${g} Remove from MYOB`] = g === 0 ? "N" : "Y";
  }
  for (const x of lines) {
    row[`${x.slot}. Item Code`] = x.code; row[`${x.slot}. Item Description`] = x.description; row[`${x.slot}. Qty`] = String(x.qty);
    row[`${x.slot}. Qty Display`] = String(x.qty); row[`${x.slot}. PO Group`] = "0"; row[`${x.slot}. Price`] = String(x.price);
    row[`${x.slot}. Cost Price`] = x.cost === null ? "" : String(x.cost);
  }
  return { problems: [...new Set(problems)], warnings, skipped, route, location, lines, subtotal: sub, gst, total, scrap, row };
}

/* A test: a Quote for ZZ TEST DELETE ME 1, every message, payment link and Xero flag off, and no scrap pick-up (no reminder). */
export const podTestPo = (po: string) => "TEST-" + po;
export function asPodTest(row: Record<string, unknown>, po: string) {
  const t: Record<string, unknown> = { ...row, "Company Name": POD.company, "Customer PO#": podTestPo(po), "Order or Quote": "Quote", "Order Status": "Quote",
    "Get SMS Booking Confirmation": "No", "Get Email Booking Confirmation": "No", "Generate Payment Link": "No", "Upload to MYOB": "N",
    "Do you want to Upload this to MYOB?": "No", "Customer Email Address": "", "Scrap Pick-up": "No",
    "Customer Notes": "TEST ONLY: delete me. Nothing is to be made or delivered.\n" + String(row["Customer Notes"] ?? "") };
  for (let g = 0; g < 10; g++) { t[`PO${g} Upload to MYOB`] = "N"; t[`PO${g} Remove from MYOB`] = g === 0 ? "N" : "Y"; }
  return t;
}

/* The OrderPods catalogue for these codes: Customer Price rows in force today (effective_from dd/mm/yyyy, the latest that
   has started and not ended), the Styrofoam cost row, the Products description, the suburb list. */
const dmy = (v: unknown): string | null => { const m = String(v ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null; };
export function podCatalogue(rows: { prices: any[]; costs: any[]; products: any[]; suburbs: any[] }, today: string): PodCatalogue {
  const prices = new Map<string, number>(), when = new Map<string, string>();
  for (const r of rows.prices || []) {
    const from = dmy(r.effective_from) ?? "0000-00-00", to = dmy(r.effective_to);
    if (from > today || (to && to < today)) continue;
    const k = clean(r["Company Name"]) + "|" + clean(r["Item Number"]), n = money(r["Custom Price"]);
    if (n === null) continue;
    if (!when.has(k) || from >= when.get(k)!) { prices.set(k, n); when.set(k, from); }
  }
  const costs = new Map<string, { syd: number | null; cbr: number | null }>();
  for (const r of rows.costs || []) if (clean(r["Supplier Name"]) === POD.supplier && !costs.has(clean(r["Item Number"])))
    costs.set(clean(r["Item Number"]), { syd: money(r["Sydney/NSW Cost Price"]), cbr: money(r["Canberra/ACT Cost Price"]) });
  const descriptions = new Map<string, string>();
  for (const r of rows.products || []) if (clean(r.Code) && !descriptions.has(clean(r.Code))) descriptions.set(clean(r.Code), clean(r.Description));
  const suburbs = new Map<string, number>();
  for (const r of rows.suburbs || []) { const name = suburbKey(r.Destination), n = money(r["Ex GST"]); if (name && name !== "destination" && n !== null) suburbs.set(name, n); }
  return { prices, costs, descriptions, suburbs };
}

/* The server's part for a waffle pod purchase order: preview, send_test, send (called by handler.ts). */
export async function podsAction(x: {
  action: string; mode: string; admin: boolean; email: string; source: PodSource; choice: PodChoice; direct: any; pods: any; now: Date;
  json: (b: unknown, s?: number) => Response; hide: (m: unknown) => string;
}) {
  const { action, admin, email, source, choice, direct, pods, now, json, hide } = x;
  const codes = [...new Set((source.lines || []).filter((l) => isWaffle(l.category)).map((l) => clean(l.code)).filter(Boolean)), "WPDEL", "WPENVIRO", "WPSB"];
  const [pr, co, pd, sb, dup] = await Promise.all([
    pods.from("Customer Price").select('"Company Name", "Item Number", "Custom Price", effective_from, effective_to').in("Company Name", [POD.company, POD.standard]).in("Item Number", codes),
    pods.from("Cost Price").select('"Supplier Name", "Item Number", "Sydney/NSW Cost Price", "Canberra/ACT Cost Price"').eq("Supplier Name", POD.supplier).in("Item Number", codes),
    pods.from("Products").select('"Code", "Description"').in("Code", codes),
    pods.from("Delivery Prices Per Suburb").select('"Destination", "Ex GST"'),
    pods.from("Wafflepods").select('"Order ID"').eq("Company Name", POD.company).eq(PO_COL, source.po_no).limit(1),
  ]);
  for (const r of [pr, co, pd, sb, dup]) if (r.error) throw new Error("OrderPods: " + r.error.message);
  const cat = podCatalogue({ prices: pr.data, costs: co.data, products: pd.data, suburbs: sb.data }, now.toISOString().slice(0, 10));
  const built = buildPods(source, choice, cat, email, now);
  if (action === "update_items") return await pushItemsSlots({ portal: "OrderPods", db: pods, table: "Wafflepods", row: built.row, source, direct, email, json, hide });
  if (action === "update_delivery") return await pushDelivery({ portal: "OrderPods", db: pods, table: "Wafflepods", idCol: "Order ID", companyCol: "Company Name", source, direct, email, json, hide,
    fields: Object.fromEntries(["Booking Date", "Booking Time", "Site Address", "Suburb", "Contact Name", "Contact Phone", "Customer Notes", "Gate Code", "Trailer Access",
      /* the questions too (Edit order, 11 Nov 2026) */ "Location", "Scrap Pick-up", "Distance in Hrs", "Special Instructions to Driver"].filter((k) => k in built.row).map((k) => [k, built.row[k]])) });
  const already = (dup.data || [])[0]?.["Order ID"];
  if (already) built.problems.push("OrderPods already has " + source.po_no + " as " + already + ".");
  const preview = {
    mode: x.mode, kind: "dropship", destination: "OrderPods", material: "wafflepods", material_label: "Waffle Pods", supplier_label: "Styrofoam",
    freight_price: built.lines.find((l) => l.code === "WPDEL")?.price ?? null, po_no: source.po_no, route: built.route, want_date: built.row["Booking Date"],
    customer: source.customer, quote_no: source.quote_no, deliver_to: [built.row["Site Address"], built.row["Suburb"]].filter(Boolean).join(", "),
    booking: (built.row["Booking Date"] || "date not confirmed yet") + " " + String(built.row["Booking Time"] || "").replace(/"/g, ""),
    contact_name: built.row["Contact Name"], contact_phone: built.row["Contact Phone"], notes: built.row["Customer Notes"], warnings: built.warnings,
    pods: { location: built.location, scrap: built.scrap ? "Yes" : "No", gate: built.row["Gate Code"], trailer: built.row["Trailer Access"] },
    lines: built.lines.map((l) => ({ code: l.code, description: l.description, qty: l.qty, price: l.price, line_total: r2(l.price * l.qty) })),
    totals: { products: r2(built.lines.filter((l) => !l.auto).reduce((a, l) => a + r2(l.price * l.qty), 0)), impact: 0,
      freight_deliveries: built.lines.find((l) => l.code === "WPDEL")?.qty ?? 0, subtotal: built.subtotal, gst: built.gst, total: built.total },
    problems: built.problems, skipped: built.skipped,
    items: (source.lines || []).filter((l) => isWaffle(l.category) && l.item_id != null).map((l) => {
      const c = choice.lines ? choice.lines.find((y) => Number(y.item_id) === Number(l.item_id)) : null;
      return { item_id: Number(l.item_id), name: l.name, code: clean(l.code) || null, ordered: Number(l.qty), qty: c ? Number(c.qty) : Number(l.qty),
        ticked: choice.lines ? !!c : true, sent: built.lines.some((b) => !b.auto && b.code === clean(l.code)), why: built.skipped.find((k) => k.name === clean(l.name))?.why || null };
    }),
  };
  if (action === "preview") return json({ preview: true, ...preview, can_test: admin === true, note: "Nothing was sent." });
  if (built.problems.length) return json({ error: "This purchase order cannot be sent yet.", ...preview }, 422);

  if (action === "send_test") {
    const recent = await pods.from("Wafflepods").select('"Order ID"').eq(PO_COL, podTestPo(source.po_no)).limit(1);
    if ((recent.data || [])[0]) return json({ error: "A test of " + source.po_no + " is already in OrderPods as " + recent.data[0]["Order ID"] + ". Delete it there first." }, 409);
    const o = await pods.from("Wafflepods").insert(asPodTest(built.row, source.po_no)).select('"Order ID"').single();
    if (o.error || !o.data) return json({ error: "The test was not sent to OrderPods: " + hide(o.error?.message || "no row came back") + ". Nothing was added." }, 502);
    await direct.from("audit_log").insert({ who: email, action: "orderpods_test_send", detail: source.po_no + " sent to OrderPods as a TEST quote " + o.data["Order ID"] + " (" + preview.totals.total + " incl GST)" });
    return json({ sent: true, test: true, destination: "OrderPods", kind: "dropship", order_id: o.data["Order ID"], po_no: source.po_no, totals: preview.totals });
  }

  // send: claimed once on Direct's side, then the one row; the WP number goes on Direct's PO
  const { data: claim, error: claimErr } = await direct.rpc("ordersteel_send_claim", { p_order_id: source.order_id, p_by: email, p_request: { choice, destination: "OrderPods" } });
  if (claimErr) throw new Error("Direct: " + claimErr.message);
  if (claim?.error) return json({ error: claim.error }, 409);
  const o = await pods.from("Wafflepods").insert(built.row).select('"Order ID"').single();
  if (o.error || !o.data) {
    const msg = hide(o.error?.message || "no row came back");
    await direct.rpc("ordersteel_send_finish", { p_claim_id: claim.claim_id, p_ok: false, p_ordersteel_id: null, p_error: msg, p_result: {} });
    return json({ error: "Not sent to OrderPods: " + msg + ". Nothing was added; try again." }, 502);
  }
  const fin = await direct.rpc("ordersteel_send_finish", { p_claim_id: claim.claim_id, p_ok: true, p_ordersteel_id: o.data["Order ID"], p_error: null, p_result: { ...preview.totals, lines: (preview.lines || []).map((l: any) => ({ code: l.code, description: l.description, qty: l.qty, price: l.price, line_total: l.line_total })) } });   /* the lines sent: Direct's Xero PO copies them (20261101100000) */
  return json({ sent: true, destination: "OrderPods", kind: "dropship", order_id: o.data["Order ID"], po_no: source.po_no, totals: preview.totals, lines: preview.lines, recorded_on_po: fin.data?.supplier_ref_set === true });
}
