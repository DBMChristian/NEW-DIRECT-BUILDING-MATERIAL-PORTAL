// concrete.ts (31 Oct 2026): Direct's concrete to DBM's OrderConcrete (Supabase gvvgkfjpjqydqpvjiwvp, table "Concrete"),
// one row per drop-ship purchase order, as OrderConcrete's own order form saves one (dbm-order-concrete,
// src/pages/OrderWizard.jsx placeOrder: the field map, the slots, the automatic charges) and with Direct's own account
// settings, taken from the order Direct placed itself (CON1003815, 13 Aug 2026, orders@directbuildingmaterial.com.au):
//  * Company "Direct Building Material Pty Ltd", COD, Customer PO# = Direct's PO number, Ship Via "Concrete", Plant
//    "Metro", status "Open" and no plant email: DBM's concrete team chooses or confirms the plant, emails it and books it;
//  * the supplier Direct chose, or blank when DBM chooses (charges and costs then priced as the form does: Boral);
//  * mixes in slots 1, 10 and 11 with the slump per mix; the charges OrderConcrete adds itself in the other slots:
//    CRTRANS and CRPROD for the mix total (CRPROD only for Boral, Concrite, Holcim, Hy-Tec, Heidelberg, at the plant's
//    cost), CRSUR for the shortfall under 4 m³, CRTEST3C x 3 for a tester, CR/COLOUR and CR/Washout (total / 6, up)
//    for coloured concrete. Direct's own line for one of those codes is not sent (it would be a second one);
//  * price: Direct's CustomerPrice row when above $0, else the "Standard Price" row (decided 31 Oct 2026: Direct pays
//    the standard price; its rows there are $0 placeholders). Cost: the plant's row on "Cost Price";
//  * booking time in quotes, as OrderConcrete stores it ("AM", "PM", "ANYTIME", "07:00").
// The Order ID (CON…) comes from OrderConcrete's own trigger. A test is a Quote for ZZ TEST DELETE ME 1 with no SMS,
// no payment link and nothing to Xero (a Quote skips the new-order alert too).
import { splitSite, phone11, splitContact } from "./rules.ts";
import { pushDelivery } from "./delivery-edit.ts";
import { pushItemsSlots } from "./items-edit.ts";

/* Direct's account in OrderConcrete (from CON1003815). COD: confirm with DBM (a staff-typed order, CON1003893, said ACC). */
export const CON = {
  company: "Direct Building Material Pty Ltd", standard: "Standard Price", codOrAcc: "COD", messageOrNeat: "NEAT", sms: "Yes",
  siteContactBoralEmail: "61422983326", email: "orders@directbuildingmaterial.com.au", testCompany: "ZZ TEST DELETE ME 1", plant: "Metro",
  autoSupplier: "Boral",   /* who the form prices a "DBM chooses" order with (AUTO_SUPPLIER_ALIAS) */
};
/* the plants: OrderConcrete stores the full supplier name; its Cost Price rows use the short name */
export const SUPPLIERS: Record<string, string> = {
  "Boral Construction Materials Group Limited": "Boral", "LINEKING PTY LTD": "Lineking", "HY-TEC INDUSTRIES PTY LTD": "Hy-Tec",
  "Concrite Pty Ltd": "Concrite", "Heidelberg Materials Australia Pty Ltd": "Heidelberg", "Hanson Construction Materials Pty Ltd": "Hanson", "Holcim": "Holcim",
};
export const CRPROD_SUPPLIERS = ["Boral", "Concrite", "Holcim", "Hy-Tec", "Heidelberg"];
export const MIX_SLOTS = [1, 10, 11];
export const OTHER_SLOTS = Array.from({ length: 13 }, (_, i) => i + 1).filter((n) => !MIX_SLOTS.includes(n));
export const AUTO_CODES = ["CRTRANS", "CRPROD", "CRSUR", "CRTEST3C", "CR/COLOUR", "CR/Washout"];
export const FULL_LOAD = 4, WASHOUT_LOAD = 6;
export const isConcrete = (category: unknown) => String(category ?? "").trim().toLowerCase() === "concrete";
const clean = (v: unknown) => String(v ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const money = (v: unknown): number | null => { const s = String(v ?? "").replace(/[^0-9.-]/g, ""); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
const yn = (v: unknown) => /^y(es)?$/i.test(clean(v)) ? "Yes" : "No";
/* Direct's time window as OrderConcrete's booking time (stored in quotes) */
export function conTime(slot: unknown): { time: string; note: string } {
  const s = clean(slot), l = s.toLowerCase();
  if (l === "am") return { time: '"AM"', note: "" };
  if (l === "pm") return { time: '"PM"', note: "" };
  if (!l || l === "any time" || l === "anytime") return { time: '"ANYTIME"', note: "" };
  if (/first drop/.test(l)) return { time: '"AM"', note: "First drop" };
  if (/last drop/.test(l)) return { time: '"PM"', note: "Last drop" };
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/.exec(l);
  if (m) { let h = +m[1]; if (m[3] === "pm" && h < 12) h += 12; if (h >= 6 && h <= 16) return { time: `"${String(h).padStart(2, "0")}:${m[2] || "00"}"`, note: "Time window: " + s }; }
  return { time: '"ANYTIME"', note: "Time window: " + s };
}

export type ConSource = {
  order_id: number; po_no: string; quote_no: string; customer: string; contact?: string | null; contact_name?: string | null;
  ds_route: string; site?: string | null; site_contact?: string | null; site_notes?: string | null; want_date?: string | null; slot?: string | null;
  col: string; stream: string; supplier_ref?: string | null; job?: Record<string, unknown> | null;
  lines: { item_id: number | null; name: string; qty: number; code?: string | null; category?: string | null }[];
};
export type ConChoice = { lines?: { item_id: number; qty: number }[]; contact_name?: string; contact_phone?: string; notes?: string };
export type ConCatalogue = {
  prices: Map<string, number>;                     // "company|code" -> CustomerPrice (Direct, Standard Price)
  costs: Map<string, number>;                      // "plant|code" -> Cost Price
  products: Map<string, { description: string; mix: boolean }>;   // code -> Products
};
/* Direct's own price when it is above $0, else the standard price */
export const conPrice = (cat: ConCatalogue, code: string): number | null => {
  const own = cat.prices.get(CON.company + "|" + code);
  if (own !== undefined && own > 0) return own;
  return cat.prices.get(CON.standard + "|" + code) ?? null;
};

export function buildConcrete(src: ConSource, choice: ConChoice, cat: ConCatalogue, who: string, now: Date) {
  const problems: string[] = [], warnings: string[] = [], skipped: { name: string; why: string }[] = [];
  if (src.stream !== "dropship") problems.push("Only a drop-ship purchase order is sent to OrderConcrete.");
  if (src.col === "Cancelled") problems.push("This purchase order is cancelled.");
  else if (src.col !== "To order") problems.push("This purchase order is already " + src.col + ".");
  if (clean(src.supplier_ref)) problems.push("This purchase order was already sent: " + clean(src.supplier_ref) + ".");
  if (src.ds_route !== "direct") problems.push("Concrete is delivered to the customer's site: this purchase order has no site route.");
  const job = (src.job && typeof src.job === "object" ? src.job : {}) as Record<string, unknown>;
  for (const [k, t] of [["concrete_pour", "the pour method"], ["concrete_truck", "the truck size"], ["concrete_spacing", "the spacing between trucks"]]   /* no slump: Direct's form does not ask it (13 Nov 2026) */)
    if (!clean(job[k])) problems.push("The order has no " + t + " (Concrete details on the order).");

  // the plant: the one Direct chose, else DBM chooses (priced with Boral, as the form does)
  const chosen = clean(job.concrete_supplier), supplier = chosen && SUPPLIERS[chosen] !== undefined ? chosen : "";
  if (chosen && !supplier) problems.push("OrderConcrete does not know the supplier " + chosen + ".");
  const plant = supplier ? SUPPLIERS[supplier] : CON.autoSupplier;
  const costOf = (code: string) => cat.costs.get(plant + "|" + code) ?? null;

  // the mixes (slots 1, 10, 11) and Direct's other concrete lines
  const chosenLines = choice.lines ? new Map(choice.lines.map((c) => [Number(c.item_id), Number(c.qty)])) : null;
  const mixes: { code: string; description: string; qty: number }[] = [], extras: { code: string; description: string; qty: number }[] = [];
  for (const l of src.lines || []) {
    const name = clean(l.name) || "a line";
    if (!isConcrete(l.category)) { skipped.push({ name, why: "Not concrete: order it the usual way." }); continue; }
    if (l.item_id == null) { skipped.push({ name, why: "Not linked to a product." }); continue; }
    if (chosenLines && !chosenLines.has(Number(l.item_id))) { skipped.push({ name, why: "Not ticked." }); continue; }
    const qty = chosenLines ? chosenLines.get(Number(l.item_id))! : Number(l.qty);
    if (!(qty > 0) || qty > 10000) { problems.push(name + ": the quantity must be more than 0."); continue; }
    const code = clean(l.code);
    if (!code) { problems.push(name + " has no Item code: add it in Product Management."); continue; }
    if (AUTO_CODES.includes(code)) { skipped.push({ name, why: "OrderConcrete adds " + code + " itself." }); continue; }
    const p = cat.products.get(code);
    if (!p) { problems.push(name + ": OrderConcrete has no product " + code + "."); continue; }
    (p.mix ? mixes : extras).push({ code, description: p.description, qty });
  }
  if (!mixes.length) problems.push("There is no concrete mix on this purchase order.");
  if (mixes.length > MIX_SLOTS.length) problems.push("At most " + MIX_SLOTS.length + " mixes fit on one OrderConcrete order.");
  const total = r2(mixes.reduce((a, m) => a + m.qty, 0));

  // the charges OrderConcrete adds itself (deriveAutoCharges)
  const autos: { code: string; qty: number }[] = [];
  if (total > 0) {
    autos.push({ code: "CRTRANS", qty: total });
    if (CRPROD_SUPPLIERS.includes(plant)) autos.push({ code: "CRPROD", qty: total });
    if (FULL_LOAD - total > 0) autos.push({ code: "CRSUR", qty: r2(FULL_LOAD - total) });
  }
  if (yn(job.concrete_tester) === "Yes") autos.push({ code: "CRTEST3C", qty: 3 });
  const coloured = yn(job.concrete_coloured) === "Yes";
  if (coloured) { autos.push({ code: "CR/COLOUR", qty: 1 }); const loads = Math.ceil(total / WASHOUT_LOAD); if (loads > 0) autos.push({ code: "CR/Washout", qty: loads }); }

  // slots, prices and costs (CRPROD at the plant's cost, in every price column)
  const lines: { slot: number; code: string; description: string; qty: number; price: number; cost: number | null; auto?: boolean }[] = [];
  const priced = (code: string) => {
    if (code === "CRPROD") { const c = costOf(code); if (c === null) problems.push("OrderConcrete has no " + plant + " cost for CRPROD."); return { price: c ?? 0, cost: c }; }
    const p = conPrice(cat, code);   /* no price is not a stop: OrderConcrete prices it on arrival (13 Nov 2026) */
    return { price: p ?? 0, cost: costOf(code) };
  };
  mixes.slice(0, MIX_SLOTS.length).forEach((m, i) => lines.push({ slot: MIX_SLOTS[i], code: m.code, description: m.description, qty: m.qty, ...priced(m.code) }));
  let next = 0;
  for (const x of [...autos.map((a) => ({ ...a, auto: true, description: cat.products.get(a.code)?.description || a.code })), ...extras]) {
    if (next >= OTHER_SLOTS.length) { problems.push("At most 13 lines fit on one OrderConcrete order."); break; }
    lines.push({ slot: OTHER_SLOTS[next++], code: x.code, description: x.description, qty: x.qty, ...priced(x.code), auto: (x as any).auto === true });
  }
  lines.sort((a, b) => a.slot - b.slot);

  // the site, the contact who meets the truck, the date and time
  const where = splitSite(src.site);
  if (!where.street || !where.suburb) problems.push("The site address needs a street and a suburb.");
  const sc = splitContact(job.site_contact ?? src.site_contact);
  const contactName = clean(choice.contact_name) || sc.name || clean(src.contact_name);
  const contactPhone = phone11(choice.contact_phone || sc.phone || src.contact || "");
  if (!contactName) problems.push("Enter the contact name for the pour.");
  if (!contactPhone) problems.push("Enter the contact's phone: an Australian number, e.g. 0412 345 678.");
  const date = src.want_date ? String(src.want_date).slice(0, 10) : "";
  if (!date) problems.push("The order has no pour date.");
  else if (date < now.toISOString().slice(0, 10)) problems.push("The pour date (" + date + ") has passed: change it on the order first.");
  const t = conTime(clean(job.concrete_option1) || (job.delivery_requested_slot ?? src.slot));   /* new New Order: option 1 is the booking time (11 Nov 2026) */
  const opt = (v: unknown) => clean(v) ? conTime(v).time : "";

  const sub = r2(lines.reduce((a, x) => a + r2(x.price * x.qty), 0)), gst = r2(sub * 0.1), totalIncl = r2(sub + gst);
  const notes = [clean(choice.notes), clean(job.reference) && "Direct's reference: " + clean(job.reference), clean(src.site_notes) && "Site notes: " + clean(src.site_notes),
    t.note, !supplier && "Supplier: DBM chooses.", "Sent from the Direct portal by " + who + " · " + src.po_no + " · " + src.quote_no].filter(Boolean).join("\n");
  const sydney = new Date(now.toLocaleString("en-US", { timeZone: "Australia/Sydney" })), p2 = (n: number) => String(n).padStart(2, "0");
  const row: Record<string, unknown> = {
    "Company Name": CON.company, "Purchasing Company": "", "COD or ACC": CON.codOrAcc, "Order or Quote": "Order", "Supplier": supplier, "Plant": CON.plant,
    "Which Plant": "", "Message or Neat": ["Message", "Neat", "Neat Plus"].includes(clean(job.concrete_message)) ? clean(job.concrete_message) : CON.messageOrNeat, "Spacing": clean(job.concrete_spacing), "Do you require coloured concrete?": coloured ? "Yes" : "No",
    "Concrete colour": coloured ? clean(job.concrete_colour) : "", "Max quantity in colour": coloured ? clean(job.concrete_colour_max) : "",
    "Boral Option 1": clean(job.concrete_option1) ? opt(job.concrete_option1) : t.time, "Boral Option 2": opt(job.concrete_option2), "Boral Option 3": opt(job.concrete_option3),
    "Supplier Status": ["Release Order", "Call to Release"].includes(clean(job.concrete_release)) ? clean(job.concrete_release) : "", "Special Instructions to Boral": clean(choice.notes), "Do you require tester?": yn(job.concrete_tester),
    "Truck Sizes": clean(job.concrete_truck), "Pour Method": clean(job.concrete_pour), "Site restriction?": yn(job.concrete_restriction),
    "Details - site restriction": yn(job.concrete_restriction) === "Yes" ? clean(job.concrete_restriction_note) : "",
    "Customer PO#": src.po_no, "Contact Name": contactName, "Contact Phone": contactPhone, "Site Address": where.street, "Suburb": where.suburb,
    "Booking Date": date || null, "Booking Time": t.time, "Customer Notes": notes, "Get SMS Booking Confirmation": CON.sms, "Submitted by": who,
    "Customer Email Address": CON.email,
    "Date Submitted": `${sydney.getFullYear()}-${p2(sydney.getMonth() + 1)}-${p2(sydney.getDate())} ${p2(sydney.getHours())}:${p2(sydney.getMinutes())}:${p2(sydney.getSeconds())}`,
    "Ship Via": "Concrete", "Salesperson": who, "Generate Payment Link": "Yes", "Do you want to Upload this to MYOB?": "Y",
    "Site Contact (Boral Email)": CON.siteContactBoralEmail, "Upload to MYOB": "Y", "Remove from MYOB": "N", "PO Upload to MYOB": "Y", "PO Remove from MYOB": "N",
    "Order Status": "Open",
  };
  for (let n = 1; n <= 13; n++) { row[`${n}. Item`] = ""; row[`${n}. Product Description`] = ""; row[`${n}. Qty`] = ""; row[`${n}. Price`] = ""; row[`${n}. Cost Price`] = ""; }
  for (const x of lines) {
    row[`${x.slot}. Item`] = x.code; row[`${x.slot}. Product Description`] = x.description; row[`${x.slot}. Qty`] = String(x.qty);
    row[`${x.slot}. Price`] = String(x.price); row[`${x.slot}. Cost Price`] = x.cost === null ? "" : String(x.cost);
  }
  ["1st", "2nd", "3rd"].forEach((n, i) => { const has = !!mixes[i]; row[`${n} Slump`] = has ? clean(job.concrete_slump) : ""; row[`${n} Max Qty`] = has ? String(mixes[i].qty) : ""; });
  /* Max Qty = the mix's quantity (30 Oct 2026): what DBM's own form holds on most orders (CON1004368, 1004275...); DBM lowers it
     on the line for a big pour with a cap (CON1004330: 46 m³, max 10). Left empty, OrderConcrete flags "Max qty missing". */
  return { problems: [...new Set(problems)], warnings, skipped, supplier, plant, total, lines, subtotal: sub, gst, totalIncl, row };
}

/* A test: a Quote for ZZ TEST DELETE ME 1, no SMS, no payment link, nothing to Xero. */
export const conTestPo = (po: string) => "TEST-" + po;
export function asConTest(row: Record<string, unknown>, po: string) {
  return { ...row, "Company Name": CON.company, "Customer PO#": conTestPo(po), "Order or Quote": "Quote", "Order Status": "Quote",
    "Get SMS Booking Confirmation": "No", "Generate Payment Link": "No", "Upload to MYOB": "N", "PO Upload to MYOB": "N", "Do you want to Upload this to MYOB?": "N",
    "Customer Email Address": "", "Site Contact (Boral Email)": "",
    "Customer Notes": "TEST ONLY: delete me. Nothing is to be poured.\n" + String(row["Customer Notes"] ?? "") };
}

const dmy = (v: unknown): string | null => { const m = String(v ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (!m) return null; const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; };
export function conCatalogue(rows: { prices: any[]; costs: any[]; products: any[] }, today: string): ConCatalogue {
  const inForce = (r: any) => { const f = dmy(r.effective_from) ?? "0000-00-00", t = dmy(r.effective_to); return f <= today && (!t || t >= today); };
  const prices = new Map<string, number>();
  for (const r of rows.prices || []) { if (!inForce(r)) continue; const n = money(r["Custom Price"]); if (n !== null) prices.set(clean(r["Company Name"]) + "|" + clean(r["Item Number"]), n); }
  const costs = new Map<string, number>();
  for (const r of rows.costs || []) { if (!inForce(r)) continue; const n = money(r["Cost Price"]); if (n !== null) costs.set(clean(r["Supplier Name"]) + "|" + clean(r.Code), n); }
  const products = new Map<string, { description: string; mix: boolean }>();
  for (const r of rows.products || []) if (clean(r.Code)) products.set(clean(r.Code), { description: clean(r.Description), mix: clean(r.TYPE).toLowerCase() === "mix" });
  return { prices, costs, products };
}

/* The server's part for a concrete purchase order: preview, send_test, send (called by handler.ts). */
const PO_COL = '"Customer PO#"';
export async function concreteAction(x: {
  action: string; mode: string; admin: boolean; email: string; source: ConSource; choice: ConChoice; direct: any; oc: any; now: Date;
  json: (b: unknown, s?: number) => Response; hide: (m: unknown) => string;
}) {
  const { action, admin, email, source, choice, direct, oc, now, json, hide } = x;
  const codes = [...new Set([...(source.lines || []).filter((l) => isConcrete(l.category)).map((l) => clean(l.code)).filter(Boolean), ...AUTO_CODES])];
  const [pr, co, pd, dup] = await Promise.all([
    oc.from("CustomerPrice").select('"Company Name", "Item Number", "Custom Price", effective_from, effective_to').in("Company Name", [CON.company, CON.standard]).in("Item Number", codes),
    oc.from("Cost Price").select('"Supplier Name", "Code", "Cost Price", effective_from, effective_to').in("Code", codes),
    oc.from("Products").select('"Code", "Description", "TYPE"').in("Code", codes),
    oc.from("Concrete").select('"Order ID"').eq("Company Name", CON.company).eq(PO_COL, source.po_no).limit(1),
  ]);
  for (const r of [pr, co, pd, dup]) if (r.error) throw new Error("OrderConcrete: " + r.error.message);
  const cat = conCatalogue({ prices: pr.data, costs: co.data, products: pd.data }, now.toISOString().slice(0, 10));
  const built = buildConcrete(source, choice, cat, email, now);
  if (action === "update_items") return await pushItemsSlots({ portal: "OrderConcrete", db: oc, table: "Concrete", row: built.row, source, direct, email, json, hide });
  if (action === "update_delivery") return await pushDelivery({ portal: "OrderConcrete", db: oc, table: "Concrete", idCol: "Order ID", companyCol: "Company Name", source, direct, email, json, hide,
    fields: Object.fromEntries(["Booking Date", "Booking Time", "Site Address", "Suburb", "Contact Name", "Contact Phone", "Customer Notes",
      /* the questions too (Edit order, 11 Nov 2026) */ "Message or Neat", "Spacing", "Do you require coloured concrete?", "Concrete colour", "Max quantity in colour", "Do you require tester?",
      "Truck Sizes", "Pour Method", "Site restriction?", "Details - site restriction", "Boral Option 1", "Boral Option 2", "Boral Option 3", "Supplier Status", "Special Instructions to Boral",
      "1st Slump", "2nd Slump", "3rd Slump"].filter((k) => k in built.row).map((k) => [k, built.row[k]])) });
  const already = (dup.data || [])[0]?.["Order ID"];
  if (already) built.problems.push("OrderConcrete already has " + source.po_no + " as " + already + ".");
  const job = (source.job || {}) as Record<string, unknown>;
  const preview = {
    mode: x.mode, kind: "dropship", destination: "OrderConcrete", material: "concrete", material_label: "Concrete",
    supplier_label: built.supplier ? (SUPPLIERS[built.supplier] || built.supplier) : "DBM chooses", freight_price: null, po_no: source.po_no, route: "site",
    want_date: built.row["Booking Date"], customer: source.customer, quote_no: source.quote_no,
    deliver_to: [built.row["Site Address"], built.row["Suburb"]].filter(Boolean).join(", "),
    booking: (built.row["Booking Date"] || "no date") + " " + String(built.row["Booking Time"] || "").replace(/"/g, ""),
    contact_name: built.row["Contact Name"], contact_phone: built.row["Contact Phone"], notes: built.row["Customer Notes"], warnings: built.warnings,
    concrete: { pour: clean(job.concrete_pour), slump: clean(job.concrete_slump), truck: clean(job.concrete_truck), spacing: clean(job.concrete_spacing), m3: built.total },
    lines: built.lines.map((l) => ({ code: l.code, description: l.description, qty: l.qty, price: l.price, line_total: r2(l.price * l.qty) })),
    totals: { products: built.subtotal, impact: 0, freight_deliveries: 0, subtotal: built.subtotal, gst: built.gst, total: built.totalIncl },
    problems: built.problems, skipped: built.skipped,
    items: (source.lines || []).filter((l) => isConcrete(l.category) && l.item_id != null).map((l) => {
      const c = choice.lines ? choice.lines.find((y) => Number(y.item_id) === Number(l.item_id)) : null;
      return { item_id: Number(l.item_id), name: l.name, code: clean(l.code) || null, ordered: Number(l.qty), qty: c ? Number(c.qty) : Number(l.qty),
        ticked: choice.lines ? !!c : true, sent: built.lines.some((b) => !b.auto && b.code === clean(l.code)), why: built.skipped.find((k) => k.name === clean(l.name))?.why || null };
    }),
  };
  if (action === "preview") return json({ preview: true, ...preview, can_test: admin === true, note: "Nothing was sent." });
  if (built.problems.length) return json({ error: "This purchase order cannot be sent yet.", ...preview }, 422);

  if (action === "send_test") {
    const recent = await oc.from("Concrete").select('"Order ID"').eq(PO_COL, conTestPo(source.po_no)).limit(1);
    if ((recent.data || [])[0]) return json({ error: "A test of " + source.po_no + " is already in OrderConcrete as " + recent.data[0]["Order ID"] + ". Delete it there first." }, 409);
    const o = await oc.from("Concrete").insert(asConTest(built.row, source.po_no)).select('"Order ID"').single();
    if (o.error || !o.data) return json({ error: "The test was not sent to OrderConcrete: " + hide(o.error?.message || "no row came back") + ". Nothing was added." }, 502);
    await direct.from("audit_log").insert({ who: email, action: "orderconcrete_test_send", detail: source.po_no + " sent to OrderConcrete as a TEST quote " + o.data["Order ID"] + " (" + preview.totals.total + " incl GST)" });
    return json({ sent: true, test: true, destination: "OrderConcrete", kind: "dropship", order_id: o.data["Order ID"], po_no: source.po_no, totals: preview.totals });
  }

  const { data: claim, error: claimErr } = await direct.rpc("ordersteel_send_claim", { p_order_id: source.order_id, p_by: email, p_request: { choice, destination: "OrderConcrete" } });
  if (claimErr) throw new Error("Direct: " + claimErr.message);
  if (claim?.error) return json({ error: claim.error }, 409);
  const o = await oc.from("Concrete").insert(built.row).select('"Order ID"').single();
  if (o.error || !o.data) {
    const msg = hide(o.error?.message || "no row came back");
    await direct.rpc("ordersteel_send_finish", { p_claim_id: claim.claim_id, p_ok: false, p_ordersteel_id: null, p_error: msg, p_result: {} });
    return json({ error: "Not sent to OrderConcrete: " + msg + ". Nothing was added; try again." }, 502);
  }
  const fin = await direct.rpc("ordersteel_send_finish", { p_claim_id: claim.claim_id, p_ok: true, p_ordersteel_id: o.data["Order ID"], p_error: null, p_result: { ...preview.totals, lines: (preview.lines || []).map((l: any) => ({ code: l.code, description: l.description, qty: l.qty, price: l.price, line_total: l.line_total })) } });   /* the lines sent: Direct's Xero PO copies them (20261101100000) */
  return json({ sent: true, destination: "OrderConcrete", kind: "dropship", order_id: o.data["Order ID"], po_no: source.po_no, totals: preview.totals, lines: preview.lines, recorded_on_po: fin.data?.supplier_ref_set === true });
}
