// ordersteel-po rules (29 Oct 2026): a Direct drop-ship purchase order (orders.stream = 'dropship') as the Rediwall order
// ordersteel needs. Pure: no network, no Deno, so the page's tests and the server read the same rules.
//
// Confirmed with Siraj (DBM, 29 Oct 2026) and checked against Direct's own ordersteel orders (RED1000195 to RED1000217):
//  * company "Direct Building Material Pty Ltd", on account (ACC); the order is Open; Xero: want = Y, PO = Y;
//  * purchasing company = Direct's customer; retail customer PO = Direct's PO number (the link back);
//  * prices: ordersteel's own rule (Order-Steel src/lib/pricing.js): Direct's price, else the Standard Price row, else the
//    product's own standard price, where a price that is blank or $0 counts as not set (68 of Direct's 521 prices are $0,
//    every Floor Track among them); cost: the AFS Systems row;
//  * AFS supply chain impact charge (AFS/SCIC): 7.5% of the products, on every order (freight left out), worked out with
//    ordersteel's own formula (OrderWizard scicOn: Math.round(base * 0.075 * 100) / 100), so it matches DBM to the cent;
//  * freight FR-CRANE/RW, $415 + GST a delivery, only to the customer's site (route "direct"); none to Direct's
//    warehouse (route "penrith", stock), from 29 Oct 2026; a distance delivery is left to DBM at the supplier's rate;
//  * lines as ordersteel keeps them since its order form of 22 Oct 2026 (RED1000218 to 223, PREO1000023, HEB1000016):
//    freight first, on its PO (PO group 0) at the AFS cost ($247, cost_prices), then the charge, then products.
// Rediwall and Hebel, one material per ordersteel order (MATERIALS below). Custom panels (RWCUSTOM...) are left out until their lengths are carried over.
// A stock order (stream "stock": a Rediwall pre-order Pamela or Siraj have confirmed, purchase_orders) is the same order to
// Direct's warehouse, quantities already in panels (packs x pieces), with the delivery date chosen when it is sent.

export const COMPANY = "Direct Building Material Pty Ltd";
export const STANDARD = "Standard Price";
export const SUPPLIER = "AFS Systems Pty Ltd";
export const ORDER_TYPE = "Rediwall";
export const FREIGHT_CODE = "FR-CRANE/RW";
export const IMPACT_CODE = "AFS/SCIC";
export const IMPACT_RATE = 0.075;
export const IMPACT_DESCRIPTION = "AFS SUPPLY CHAIN IMPACT CHARGE";
export const FREIGHT_DESCRIPTION = "RIGID FREIGHT - REDIWALL";
export const DIRECT_EMAIL = "orders@directbuildingmaterial.com.au";
export const WAREHOUSE = { street: "16 Cassola Place", suburb: "Penrith" };
export const MAX_DELIVERIES = 10;
export const MAX_LINES = 30;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/* The AFS charge exactly as ordersteel's order form works it out (OrderWizard.jsx scicOn): the products' price x quantity
   added up as they are, then Math.round(base * 0.075 * 100) / 100. Not "a half cent up": that matched most half-cent
   orders but not RED1000200 ($8,125.80 -> $609.43, not 609.44). This formula matches all of them (RED1000200 609.43,
   RED1000224 602.42, RED1000211 284.63, RED1000207 1102.81). */
export const scic = (base: number) => Math.round(base * IMPACT_RATE * 100) / 100;
/* Line totals in whole cents (a price may carry 4 decimals in ordersteel). Was: a half cent goes up, as DBM charges (RED1000224: 7.5% of $8,032.20 =
   602.415 -> $602.42; RED1000211, 199, 188, 187, 182 the same). Prices may carry 4 decimals in ordersteel. */
export const lineCents = (price: number, qty: number) => Math.round((Math.round(price * 10000) * qty) / 100);
export const gstCents = (subtotalCents: number) => Math.round(subtotalCents / 10);
const dollars = (c: number) => c / 100;
const clean = (v: unknown) => String(v ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const STATES = "NSW|VIC|QLD|ACT|SA|WA|TAS|NT";

export const isRediwall = (category: unknown) => /\brediwall\b/i.test(String(category ?? ""));

/* The materials sent to ordersteel, one per order (30 Oct 2026). Hebel, checked against ordersteel's own order form
   (OrderWizard: supplier freight is FR-CRANE/<type> at its price-list price, set by DBM's staff over 35 km) and its data:
   supplier CSR Hebel (HebelOrders@csr.com.au); freight FR-CRANE/HEB at the price list ($250 a truck for Direct, as on
   HEB1000011), none to Direct's warehouse (Siraj: no delivery charge for stock orders); no AFS charge; prices from the
   product's own standard price (Direct has no Hebel price rows; ordersteel's rule falls through to it). */
export type Material = { key: string; label: string; orderType: string; supplier: string; supplierLabel: string; freightCode: string; freightDescription: string; impact: boolean; match: RegExp; poType?: string; shipVia?: string | null; freightLast?: boolean };
export const MATERIALS: Record<string, Material> = {
  rediwall: { key: "rediwall", label: "Rediwall", orderType: "Rediwall", supplier: "AFS Systems Pty Ltd", supplierLabel: "AFS", freightCode: "FR-CRANE/RW", freightDescription: "RIGID FREIGHT - REDIWALL", impact: true, match: /\brediwall\b/i },
  hebel: { key: "hebel", label: "Hebel", orderType: "Hebel", supplier: "CSR Hebel", supplierLabel: "CSR Hebel", freightCode: "FR-CRANE/HEB", freightDescription: "RIGID FREIGHT - HEBEL", impact: false, match: /\bhebel\b/i },
  // BlueDeck (30 Oct 2026), from ordersteel's Blue Deck orders (BREO1000019 to 39) and its order form: FTI GROUP PTY LTD,
  // freight FR-CRANE/REO (Direct's price $250, FTI's cost $250), no AFS charge, PO types Bluedeck (+ Processing when cut).
  bluedeck: { key: "bluedeck", label: "BlueDeck", orderType: "Blue Deck", supplier: "FTI GROUP PTY LTD", supplierLabel: "FTI", freightCode: "FR-CRANE/REO", freightDescription: "RIGID FREIGHT - REINFORCEMENT", impact: false, match: /\bblue\s*deck\b/i, poType: "Bluedeck", shipVia: "BlueDeck" },
  // Reinforcement (31 Oct 2026): its order type, supplier and PO type follow the lines (reoMaterial below); these are a
  // Processing Job's. A Direct category named Reinforcement (or Reo ...) is reinforcement.
  reo: { key: "reo", label: "Reinforcement", orderType: "Processing Job", supplier: "Reozone", supplierLabel: "Reozone (DBM may change it)", freightCode: "FR-CRANE/REO", freightDescription: "RIGID FREIGHT - REINFORCEMENT", impact: false, match: /\breinforc|\breo\b/i, poType: "Processing", shipVia: null, freightLast: true },
};

/* Reinforcement (31 Oct 2026), from Direct's own ordersteel orders (PREO1000006, 13, 23; SREO1000024, 50; AREO1000001) and
   ordersteel's order_types. Direct places one order per job holding everything for it: mesh, bar, cut-and-bent steel (per
   kg), chairs, clips, tie wire, plastic, tape, and FR-CRANE/REO at Direct's price ($250). ordersteel's own "Reinforcement"
   type is switched off; the order type follows the lines (every reinforcement product in ordersteel has the one category
   "Reinforcement", so the codes decide): any cut-and-bent line (N10P, N12P..., LIGS..., N12 L bars) makes a Processing Job;
   else mesh, trench mesh or bar makes a Stock Reinforcement; else Reo Accessories. The supplier and PO type are that
   type's own (order_types: Reozone / Processing, ARC / Stock, none / Accessories); DBM changes the supplier when they book
   it, as they did on PREO1000013 (Baban Steel) and PREO1000023 (ARC). Costs are the type's supplier's (Reozone for a
   Processing Job, as PREO1000023 shows). The freight is the LAST line (PREO1000023, line 12), no ship via. */
export const REO_TYPES = { processing: "Processing Job", stock: "Stock Reinforcement", accessories: "Reo Accessories" } as const;
export const REO_TYPE_NAMES: string[] = Object.values(REO_TYPES);
const REO_DEFAULTS: Record<string, { supplier: string; poType: string }> = {
  "Processing Job": { supplier: "Reozone", poType: "Processing" },
  "Stock Reinforcement": { supplier: "ARC - Australian Reinforcing Company", poType: "Stock" },
  "Reo Accessories": { supplier: "", poType: "Accessories" },
};
export const REO_SUPPLIERS = ["Reozone", "ARC - Australian Reinforcing Company"];
export const isProcessedReo = (code: unknown) => /^(N\d{2}P|LIGS|N\d{2}LB)/i.test(clean(code));
export const isStockReo = (code: unknown) => /^(SL\d|UTE|TM\d|RL\d|N\d{3}\.\d)/i.test(clean(code));
export function reoOrderType(codes: string[]): string {
  if (codes.some(isProcessedReo)) return REO_TYPES.processing;
  if (codes.some(isStockReo)) return REO_TYPES.stock;
  return REO_TYPES.accessories;
}
/* the reinforcement material for these codes: its order type, and that type's supplier and PO type (ordersteel's own when
   it has them, else the values above) */
/* the supplier OrderSteel has costs from for the most of these codes, then the lowest total cost (4 Nov 2026) */
export function supplierFromCosts(cat: Catalogue, codes: string[]): string {
  const want = new Set(codes.map((c) => clean(c)).filter(Boolean)), by = new Map<string, { n: number; sum: number }>();
  for (const [k, v] of cat.costs) {
    const i = k.indexOf("|"); if (i < 1) continue;
    const s = k.slice(0, i), c = k.slice(i + 1); if (!want.has(c) || !Number.isFinite(Number(v))) continue;
    const e = by.get(s) || { n: 0, sum: 0 }; e.n++; e.sum += Number(v); by.set(s, e);
  }
  return [...by.entries()].sort((a, b) => b[1].n - a[1].n || a[1].sum - b[1].sum)[0]?.[0] || "";
}
export function reoMaterial(base: Material, codes: string[], cat: Catalogue): Material {
  const name = reoOrderType(codes), t = cat.orderTypes?.get(name), d = REO_DEFAULTS[name];
  /* 4 Nov 2026: a type with no supplier (Reo Accessories): the supplier OrderSteel has costs from for these codes */
  const supplier = (t && "default_supplier" in t ? clean(t.default_supplier) : d.supplier) || supplierFromCosts(cat, codes);
  return { ...base, orderType: name, supplier, supplierLabel: supplier ? supplier + " (DBM may change it)" : "a supplier DBM chooses",
    poType: clean(t?.po_type) || d.poType };
}

/* BlueDeck sheets, exactly as ordersteel's order form (OrderWizard.jsx CUSTOM_WIDTHS_M, customSqm, billedQty, describeLine):
   ordered in sheets cut to a length, billed in m2 = (length / 1000) x 1/3 x sheets rounded with toFixed(2) (15 sheets @
   4675 mm = 23.375 -> 23.37, as BREO1000039), total = price x the rounded m2, described "... N SHEETS @ L mm (X.XX SQM)".
   Direct's stock sheets carry their length in the name ("BlueDeck 1.0mm x 3.6m" -> 3600 mm); a custom size ("BlueDeck
   1.0mm custom size (per m2)", ordered in m2) is cut to the lengths entered when it is sent (choice.cuts). Direct's
   BlueDeck products have no Item code: 0.75 mm is BDCUSTOM0.75MM, the rest BDCUSTOM1MM. */
export const BD_WIDTH = 1 / 3;
export const bdSqm = (mm: number, sheets: number) => Number(((mm / 1000) * BD_WIDTH * sheets).toFixed(3));   /* 3 decimals, as OrderSteel since 2 Nov 2026 */
/* custom Rediwall panels (customLength.js): 0.25 m wide, the 256 wall 0.15 m */
export const panelWidth = (code: string) => /^RWCUSTOM256$/i.test(code) ? 0.15 : 0.25;
export const panelSqm = (code: string, mm: number, panels: number) => Number(((mm / 1000) * panelWidth(code) * panels).toFixed(3));
export const bdCode = (l: { code?: string | null; name?: string }) => /^BDCUSTOM/i.test(String(l.code ?? "").trim()) ? String(l.code).trim() : /\b0[.,]75\s*mm\b/i.test(String(l.name ?? "")) ? "BDCUSTOM0.75MM" : "BDCUSTOM1MM";
export const bdLength = (name: unknown): number | null => { const m = String(name ?? "").match(/\bx\s*(\d+(?:\.\d+)?)\s*m\b/i); return m ? Math.round(Number(m[1]) * 1000) : null; };
/* the code a line goes to ordersteel with (BlueDeck worked out from the product; the rest its Item code (wholesale)) */
export const lineCode = (l: { code?: string | null; name?: string; category?: string | null }) => materialOf(l.category)?.key === "bluedeck" ? bdCode(l) : String(l.code ?? "").trim();
export type Cut = { sheets: number; mm: number };
export const materialOf = (category: unknown): Material | null => Object.values(MATERIALS).find((m) => m.match.test(String(category ?? ""))) || null;
export const isOrdersteel = (category: unknown) => materialOf(category) !== null;
export const isCustomPanel = (code: unknown) => /^RWCUSTOM/i.test(clean(code));

/* "71 Braeside Road, Greystanes, NSW 2145" or "79 George Street, Sydney NSW 2150" -> street and suburb */
export function splitSite(site: unknown): { street: string; suburb: string } {
  let s = clean(site).replace(/[\s,]+australia$/i, "");
  s = s.replace(new RegExp("[\\s,]+(?:" + STATES + ")?\\s*\\d{4}$", "i"), "").replace(new RegExp("[\\s,]+(?:" + STATES + ")$", "i"), "");
  const parts = s.split(",").map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 2) return { street: parts.slice(0, -1).join(", "), suburb: parts[parts.length - 1] };
  return { street: parts[0] || "", suburb: "" };
}

/* An Australian number as ordersteel keeps it: 11 digits starting 61 ("0447 699 425" -> "61447699425"); "" if not one */
export function phone11(v: unknown): string {
  let d = String(v ?? "").replace(/\D/g, "");
  if (d.length === 10 && d.startsWith("0")) d = "61" + d.slice(1);
  if (d.length === 9 && /^[2-478]/.test(d)) d = "61" + d;
  return /^61\d{9}$/.test(d) ? d : "";
}
/* "ambrose 0447699425" -> name "ambrose", phone "0447699425" */
export function splitContact(v: unknown): { name: string; phone: string } {
  const s = clean(v), m = s.match(/(\+?\d[\d\s]{7,}\d)/);
  return { name: clean(m ? s.replace(m[1], "") : s), phone: m ? m[1].replace(/\s/g, "") : "" };
}
/* Direct's slot ("AM", "PM", "Any time", "6am pick up") as ordersteel's booking time */
export function bookingTime(slot: unknown): string {
  const s = clean(slot).toLowerCase();
  if (s === "am" || s === "pm") return s.toUpperCase();
  if (!s || s === "any time" || s === "anytime") return "ANYTIME";
  if (/\d\s*am\b|\bmorning\b/.test(s)) return "AM";
  if (/\d\s*pm\b|\bafternoon\b/.test(s)) return "PM";
  return "ANYTIME";
}

export type SourceLine = { item_id: number | null; name: string; qty: number; unit?: string; code?: string | null; category?: string | null };
export type Source = {
  order_id: number; kind?: string; po_no: string; quote_no: string; customer: string; contact?: string | null; contact_name?: string | null;
  ds_route: string; fulfil?: string | null; site?: string | null; site_contact?: string | null; site_notes?: string | null;
  want_date?: string | null; slot?: string | null; col: string; stream: string; supplier_ref?: string | null; lines: SourceLine[];
};
export type Choice = {
  lines?: { item_id: number; qty: number }[];   // the ticked lines and their quantities; all of them when left out
  deliveries?: number;                         // site deliveries (1 to 10)
  distance?: boolean;                          // a distance delivery: DBM adds the supplier's freight
  contact_name?: string; contact_phone?: string; notes?: string;
  booking_date?: string;                       // YYYY-MM-DD: a stock order's wanted delivery date (DBM confirms it)
  cuts?: Record<string, Cut[]>;                // BlueDeck custom size, by item_id: the sheets and their length in mm
};
export type Catalogue = {
  products: Map<string, { description: string; category: string | null; active: boolean; standard_price?: number | null }>;   // ordersteel products by code
  prices: Map<string, number>;                 // "company|code" -> price
  costs: Map<string, number>;                  // code -> the AFS Systems cost
  orderType: { name: string; id_prefix: string | null; active: boolean } | null;   // Rediwall's (kept for the Rediwall-only callers)
  orderTypes?: Map<string, { name: string; id_prefix: string | null; active: boolean; default_supplier?: string | null; po_type?: string | null }>;   // by name: Rediwall, Hebel, the reinforcement types
  // costs: by code (the AFS rows, as before) and by "supplier|code" for any supplier
};
const costOf = (cat: Catalogue, m: Material, code: string): number | undefined => cat.costs.get(m.supplier + "|" + code) ?? (m.key === "rediwall" ? cat.costs.get(code) : undefined);

/* ordersteel's priced(): blank or $0 is "no price set" */
export const priced = (v: unknown): number | null => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
/* Direct's price, else the Standard Price row, else the product's own standard price (as ordersteel's own screens) */
export const priceOf = (cat: Catalogue, code: string): number | null =>
  priced(cat.prices.get(COMPANY + "|" + code)) ?? priced(cat.prices.get(STANDARD + "|" + code)) ?? priced(cat.products.get(code)?.standard_price);

/* Everything checked, priced and laid out. problems: why it cannot be sent (the preview is still shown);
   skipped: lines of this purchase order that are not sent here (not Rediwall, a custom panel), with why. */
export function buildOrder(src: Source, choice: Choice, cat: Catalogue, who: string, now: Date) {
  const problems: string[] = [], skipped: { name: string; why: string }[] = [];
  const stock = src.stream === "stock";
  if (src.stream !== "dropship" && !stock) problems.push("Only a drop-ship purchase order or a stock order is sent to ordersteel.");
  if (src.col === "Cancelled") problems.push("This purchase order is cancelled.");
  else if (stock && src.col === "Draft") problems.push("Press Confirm and send on this pre-order first: that gives it its PO number and its Xero purchase order.");
  else if (src.col !== "To order") problems.push("This " + (stock ? "stock order" : "purchase order") + " is already " + src.col + ".");
  if (clean(src.supplier_ref)) problems.push("This purchase order was already sent: " + clean(src.supplier_ref) + ".");

  const route = src.ds_route === "direct" ? "site" : src.ds_route === "penrith" ? "warehouse" : "";
  if (!route) problems.push("This purchase order has no route (to the site or to the warehouse).");

  // the lines: Rediwall only, the chosen ones, at the chosen quantity
  const chosen = choice.lines ? new Map(choice.lines.map((l) => [Number(l.item_id), Number(l.qty)])) : null;
  if (chosen) for (const [id, q] of chosen) if (!(q > 0) || q > 100000 || !Number.isFinite(q)) problems.push("A quantity must be more than 0 (product " + id + ").");
  const products: { code: string; description: string; qty: number; price: number | null; cost: number | null; name: string; item_id: number; mm?: number; m2?: number }[] = [];
  const warnings: string[] = []; let cutToSize = false;
  // one material per ordersteel order: the material of the ticked lines (untick one material's lines to send the other)
  const going = (src.lines || []).filter((l) => isOrdersteel(l.category) && l.item_id != null && (!chosen || chosen.has(Number(l.item_id))));
  const kinds = [...new Set(going.map((l) => materialOf(l.category)!.key))];
  const M0 = MATERIALS[kinds.length === 1 ? kinds[0] : kinds.includes("rediwall") ? "rediwall" : (kinds[0] || "rediwall")];
  // reinforcement: the order type (and its supplier and PO type) follows the ticked reinforcement lines
  const M = M0.key === "reo" ? reoMaterial(M0, going.filter((l) => materialOf(l.category)?.key === "reo").map((l) => clean(l.code)), cat) : M0;
  if (kinds.length > 1) problems.push("This purchase order has " + kinds.map((k) => MATERIALS[k].label).join(" and ") + " lines: ordersteel takes one material per order. Untick one material's lines to send the other, and order those by hand.");
  const ot = cat.orderTypes?.get(M.orderType) ?? (M.key === "rediwall" ? cat.orderType : null);
  if (!ot) problems.push("ordersteel has no " + M.label + " order type.");
  else if (ot.active === false || !ot.id_prefix) problems.push("The " + M.label + " order type is switched off in ordersteel.");
  for (const l of src.lines || []) {
    const name = clean(l.name) || "a line";
    const lm = materialOf(l.category);
    // waffle pods go to OrderPods: ticked beside ordersteel lines, they would be left behind once this PO is marked sent
    if (!lm && /\bwaffle\b/i.test(String(l.category ?? "")) && l.item_id != null && (!chosen || chosen.has(Number(l.item_id)))) {
      problems.push(name + " is waffle pods: they go to OrderPods, not ordersteel. Untick the waffle pods to send the rest here, and email them to the Styrofoam team.");
      continue;
    }
    if (!lm) { skipped.push({ name, why: "Not Rediwall, Hebel, BlueDeck or Reinforcement: order it the usual way." }); continue; }
    if (l.item_id == null) { skipped.push({ name, why: "Not linked to a product." }); continue; }
    if (chosen && !chosen.has(Number(l.item_id))) { skipped.push({ name, why: "Not ticked." }); continue; }
    if (lm.key !== M.key) continue;   // a mixed purchase order: a problem above
    const code = M.key === "bluedeck" ? bdCode(l) : clean(l.code);
    if (isCustomPanel(code)) {   /* custom panels: N panels at a length (11 Nov 2026) */
      const given = (choice.cuts || {})[String(l.item_id)] || [], m = /\b(\d+)\s+PANELS\s+@\s+(\d+)\s*mm\b/i.exec(String(l.name || ""));
      const cuts: Cut[] = given.length ? given.map((c) => ({ sheets: Number(c.sheets), mm: Number(c.mm) })) : m ? [{ sheets: Number(m[1]), mm: Number(m[2]) }] : [];
      if (!cuts.length) { problems.push(name + ": enter its panels and custom length (e.g. 22 panels @ 2850 mm)."); continue; }
      const p = cat.products.get(code);
      if (!p || p.active === false) { problems.push(name + ": ordersteel has no product " + code + "."); continue; }
      const price = priceOf(cat, code);
      if (price === null) problems.push(name + " (" + code + ") has no price for Direct in ordersteel.");
      const base = String(p.description || name).replace(/\s+\d+(?:\.\d+)?\s+(?:SHEETS|PANELS)\s+@\s+\d+(?:\.\d+)?\s*mm(?:\s*\([\d.]+\s*SQM\))?\s*$/i, "").trim();
      for (const c of cuts) {
        if (!Number.isInteger(c.sheets) || c.sheets < 1 || c.sheets > 5000 || !Number.isInteger(c.mm) || c.mm < 300 || c.mm > 12000) { problems.push(name + ": panels must be whole (1 to 5000) at 300 to 12000 mm."); continue; }
        products.push({ code, description: base + " " + c.sheets + " PANELS @ " + c.mm + " mm", qty: c.sheets, price, cost: costOf(cat, M, code) ?? null, name, item_id: Number(l.item_id), mm: c.mm, m2: panelSqm(code, c.mm, c.sheets) });
      }
      continue;
    }
    const qty = chosen ? chosen.get(Number(l.item_id))! : Number(l.qty);
    if (M.key === "bluedeck") {
      const p = cat.products.get(code);
      if (!p || p.active === false) { problems.push(name + ": ordersteel has no product " + code + "."); continue; }
      const price = priceOf(cat, code);
      if (price === null) problems.push(name + " (" + code + ") has no price for Direct in ordersteel.");
      const fixed = bdLength(name), cuts: Cut[] = [];
      if (fixed) {
        if (!Number.isInteger(qty)) { problems.push(name + ": BlueDeck goes in whole sheets (" + qty + ")."); continue; }
        cuts.push({ sheets: qty, mm: fixed });
      } else {
        cutToSize = true;
        const given = (choice.cuts || {})[String(l.item_id)] || [];
        if (!given.length) { problems.push(name + ": enter its cuts (sheets @ length in mm), " + qty + " m² ordered."); continue; }
        let bad = false;
        for (const c of given) {
          const n = Number(c.sheets), mm = Number(c.mm);
          if (!Number.isInteger(n) || n < 1 || n > 5000 || !Number.isInteger(mm) || mm < 300 || mm > 12000) { bad = true; continue; }
          cuts.push({ sheets: n, mm });
        }
        if (bad) problems.push(name + ": each cut needs whole sheets (1 to 5000) and a length of 300 to 12000 mm.");
        const cutM2 = Math.round(cuts.reduce((a, c) => a + bdSqm(c.mm, c.sheets), 0) * 100) / 100;
        if (cuts.length && Math.abs(cutM2 - qty) > 0.005) warnings.push(name + ": the cuts make " + cutM2.toFixed(2) + " m², " + qty + " m² was ordered.");
      }
      for (const c of cuts) {
        const m2 = bdSqm(c.mm, c.sheets);
        products.push({ code, description: (p.description || name) + " " + c.sheets + " SHEETS @ " + c.mm + " mm (" + m2.toFixed(3) + " SQM)",
          qty: c.sheets, price, cost: costOf(cat, M, code) ?? null, name, item_id: Number(l.item_id), mm: c.mm, m2 });
      }
      continue;
    }
    if (!code) { problems.push(name + " has no Item code (wholesale): add it in Product Management."); continue; }
    const p = cat.products.get(code);
    if (!p || p.active === false) { problems.push(name + ": ordersteel has no product " + code + "."); continue; }
    const price = priceOf(cat, code);
    if (price === null) problems.push(name + " (" + code + ") has no price for Direct in ordersteel.");
    products.push({ code, description: p.description || name, qty, price, cost: costOf(cat, M, code) ?? null, name, item_id: Number(l.item_id) });
  }
  if (!products.length) problems.push("Nothing on this purchase order can be sent to ordersteel.");
  // 4 Nov 2026: never a send without a supplier (OrderSteel refuses it): said here instead
  if (M.key === "reo" && !M.supplier && products.length) problems.push("ordersteel has no supplier for " + products.map((p) => p.code).join(", ") + ": DBM adds a cost for it (Admin > Prices), then send again.");

  // freight: to the site only, one line per delivery; a distance delivery is left to DBM
  const deliveries = Math.trunc(Number(choice.deliveries ?? 1));
  if (route === "site" && !choice.distance && (!(deliveries >= 1) || deliveries > MAX_DELIVERIES)) problems.push("Deliveries must be 1 to " + MAX_DELIVERIES + ".");
  const freightPrice = priceOf(cat, M.freightCode);
  const freight = route === "site" && !choice.distance && deliveries >= 1 ? deliveries : 0;
  if (freight && freightPrice === null) problems.push("ordersteel has no freight price (" + M.freightCode + ").");

  const billed = (p: { qty: number; m2?: number }) => p.m2 ?? p.qty;   // a BlueDeck sheet line is billed on its m2
  const baseC = products.reduce((a, p) => a + lineCents(p.price ?? 0, billed(p)), 0);
  const rawBase = products.reduce((a, p) => a + (p.price ?? 0) * billed(p), 0);   // as ordersteel adds it up
  const base = dollars(baseC), impact = M.impact ? scic(rawBase) : 0;
  if (products.length + (M.impact ? 1 : 0) + (freight ? 1 : 0) > MAX_LINES) problems.push("At most " + MAX_LINES + " lines fit on one ordersteel order.");

  // the contact who meets the truck: to the site, the site contact; to the warehouse, Direct's person
  const sc = splitContact(src.site_contact);
  const contactName = clean(choice.contact_name) || (route === "site" ? sc.name || clean(src.contact_name) : "");
  const contactPhone = phone11(choice.contact_phone || (route === "site" ? sc.phone || src.contact : ""));
  if (!contactName) problems.push("Enter the contact name for the delivery.");
  if (!contactPhone) problems.push("Enter the contact's phone: an Australian number, e.g. 0412 345 678.");
  const where = route === "warehouse" ? WAREHOUSE : splitSite(src.site);
  if (route === "site" && (!where.street || !where.suburb)) problems.push("The site address needs a street and a suburb.");
  // the date: a stock order's is chosen when it is sent (or its booked day); a drop-ship one's comes with the order
  const pick = clean(choice.booking_date), date = pick || (src.want_date ? String(src.want_date).slice(0, 10) : "");
  if (pick && !/^\d{4}-\d{2}-\d{2}$/.test(pick)) problems.push("The delivery date must be a date.");
  else if (pick && pick < now.toISOString().slice(0, 10)) problems.push("The delivery date is in the past.");
  if (!date) problems.push(stock ? "Choose the delivery date wanted for this stock order (DBM confirms it)." : "The purchase order has no delivery date.");

  const notes = [clean(choice.notes), clean(src.site_notes) && "Site notes: " + clean(src.site_notes),
    clean(src.slot) && !/^(am|pm|any ?time)$/i.test(clean(src.slot)) ? "Requested time: " + clean(src.slot) : "",
    route === "site" && choice.distance ? "Distance delivery: please add the supplier's freight." : "",
    route === "warehouse" ? "Stock for Direct's warehouse: no freight (Siraj, 29 Oct 2026)." : "",
    "Sent from the Direct portal by " + who + " · " + src.po_no + " · " + src.quote_no].filter(Boolean).join("\n");

  const lines: { line_no: number; item_code: string; item_description: string; qty: number; qty_display: number; code_price: null; price: number; line_total: number; cost_price: number | null; po_group: number | null; custom_length?: number }[] = [];
  const freightLine = !freight ? null : ({ line_no: 0, item_code: M.freightCode, item_description: M.freightDescription, qty: freight, qty_display: freight, code_price: null, price: freightPrice ?? 0, line_total: dollars(lineCents(freightPrice ?? 0, freight)), cost_price: costOf(cat, M, M.freightCode) ?? (M.key === "reo" ? null : 0), po_group: 0 } as (typeof lines)[number]);
  // the freight is the first line (Rediwall, Hebel, BlueDeck, since ordersteel's form of 22 Oct), the last for reinforcement (PREO1000023)
  if (freightLine && !M.freightLast) lines.push(freightLine);
  if (M.impact) lines.push({ line_no: 0, item_code: IMPACT_CODE, item_description: IMPACT_DESCRIPTION, qty: 1, qty_display: 1, code_price: null, price: impact, line_total: impact, cost_price: null, po_group: 0 });
  for (const p of products) lines.push({ line_no: 0, item_code: p.code, item_description: p.description, qty: p.qty, qty_display: billed(p), code_price: null, price: p.price ?? 0, line_total: dollars(lineCents(p.price ?? 0, billed(p))), cost_price: p.cost, po_group: 0, ...(p.mm ? { custom_length: p.mm } : {}) });
  if (freightLine && M.freightLast) lines.push(freightLine);
  lines.forEach((l, i) => { l.line_no = i + 1; });
  const subC = lines.reduce((a, l) => a + Math.round(l.line_total * 100), 0), gstC = gstCents(subC);
  const subtotal = dollars(subC), gst = dollars(gstC), total = dollars(subC + gstC);

  const order = {
    order_id: null as string | null, order_type: null, order_type_name: M.orderType, order_or_quote: "Order", order_status: "Open",
    company_name: COMPANY, purchasing_company: clean(src.customer), cod_or_acc: "ACC",
    customer_po: src.po_no, retail_customer_po: src.po_no,
    delivery_or_pick_up: "Delivery", ship_via: M.shipVia === null ? null : (M.shipVia ?? M.orderType),
    ...(M.key === "reo" ? { supplier: M.supplier || null } : {}), site_address: where.street, suburb: where.suburb,
    contact_name: contactName, contact_phone: contactPhone, salesperson: contactName,
    customer_email_address: DIRECT_EMAIL, submitted_by: DIRECT_EMAIL, triggered_by: DIRECT_EMAIL, date_submitted: now.toISOString(),
    booking_date: date || null, booking_time: bookingTime(src.slot),
    dbm_special_instructions: notes, get_sms_booking_confirmation: "No", get_email_booking_confirmation: "Yes",
    upload_to_xero: "Y", do_you_want_to_upload_this_to_xero: "Y", po_upload_to_xero: "Y", remove_from_xero: "N",
    subtotal, gst, total, balance: total,
  };
  const groups = [{ po_group: 0, supplier: M.supplier || null, delivery_date: date || null, delivery_option: "Delivery", po_type: route === "warehouse" ? [M.poType ?? M.label, "Stock"] : cutToSize ? ["Processing", M.poType ?? M.label] : [M.poType ?? M.label], processing_type: null }];
  const pos = [{ po_no: 0, supplier: M.supplier || null, delivery_date: date || null, delivery_option: "Delivery", po_type: null, upload_to_xero: "Y", remove_from_xero: "N" }];
  return { problems: [...new Set(problems)], warnings, skipped, route, material: M, base, impact, freight, freightPrice, subtotal, gst, total, products, rows: { order, items: lines, groups, pos } };
}

/* A test send (29 Oct 2026): the same order, made safe for ordersteel. ordersteel's own rules skip a Quote for its Xero
   invoice (xero_on_order_insert), the email to DBM's desk (email_queue_new_order) and booking with the supplier
   (order_auto_book), so a test goes in as a Quote, every Xero switch off, under DBM Supplies' own test name
   ("ZZ TEST DELETE ME 1"), with the PO number as TEST-PO-... so the real purchase order can still be sent later. */
export const TEST_COMPANY = "ZZ TEST DELETE ME 1";
export const testPo = (po: string) => "TEST-" + po;
export function asTest(rows: ReturnType<typeof buildOrder>["rows"], po: string) {
  const o = rows.order;
  return {
    order: { ...o, order_or_quote: "Quote", order_status: "Quote", purchasing_company: TEST_COMPANY, customer_po: testPo(po), retail_customer_po: testPo(po),
      upload_to_xero: null, do_you_want_to_upload_this_to_xero: "N", po_upload_to_xero: null, remove_from_xero: null,
      get_sms_booking_confirmation: "No", get_email_booking_confirmation: "No",
      dbm_special_instructions: "TEST from the Direct portal: please delete. No Xero invoice, no supplier order.\n" + o.dbm_special_instructions },
    items: rows.items, groups: rows.groups,
    pos: rows.pos.map((x) => ({ ...x, upload_to_xero: null, remove_from_xero: null })),
  };
}
