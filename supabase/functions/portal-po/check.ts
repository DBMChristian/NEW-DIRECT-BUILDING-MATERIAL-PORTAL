// check.ts (11 Nov 2026): can these products go to DBM? For each product the new New Order puts on a PO (or every
// product of a category, for the whole catalogue), read-only in DBM's portals: which portal and order type it goes as
// (OrderSteel RED / HEB / BREO / PREO / SREO / AREO, OrderPods WP, OrderConcrete CON), whether that portal has the
// product (by the code the sender uses), and whether it has a price for Direct. Nothing is written anywhere.
import { COMPANY, STANDARD, MATERIALS, materialOf, lineCode, priceOf, reoOrderType, type Catalogue } from "./rules.ts";
import { isWaffle, podCatalogue, podPrice, POD } from "./pods.ts";
import { isConcrete, conCatalogue, conPrice, CON, AUTO_CODES } from "./concrete.ts";

type Item = { item_id?: number | null; code?: string | null; name?: string; category?: string | null };
type Result = { item_id: number | null; name: string; code: string; portal: string; order_type: string; prefix: string; ok: boolean; why: string };
const clean = (v: unknown) => String(v ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const AUTO_POD = ["WPDEL", "WPENVIRO", "WPSB"];

export async function checkItems(items: Item[], c: { os?: any; pods?: any; oc?: any; now: Date }): Promise<Result[]> {
  const out: Result[] = [];
  const steel = items.filter((i) => materialOf(i.category)), pods = items.filter((i) => !materialOf(i.category) && isWaffle(i.category)), con = items.filter((i) => !materialOf(i.category) && !isWaffle(i.category) && isConcrete(i.category));
  const other = items.filter((i) => !steel.includes(i) && !pods.includes(i) && !con.includes(i));
  for (const i of other) out.push({ item_id: i.item_id ?? null, name: clean(i.name), code: clean(i.code), portal: "", order_type: "", prefix: "", ok: false, why: "Not a DBM portal product (Rediwall, Hebel, BlueDeck, Reinforcement, waffle pods, concrete): order it the usual way." });

  if (steel.length) {
    if (!c.os) steel.forEach((i) => out.push({ item_id: i.item_id ?? null, name: clean(i.name), code: clean(i.code), portal: "OrderSteel", order_type: "", prefix: "", ok: false, why: "The link to OrderSteel is not set up." }));
    else {
      const codes = [...new Set(steel.map((i) => lineCode({ code: i.code, name: i.name, category: i.category })).filter(Boolean))];
      const [types, prods, prices] = await Promise.all([
        c.os.from("order_types").select("name, id_prefix, active"),
        c.os.from("products").select("code, description, active, standard_price").in("code", codes),
        c.os.from("customer_prices").select("company_name, code, custom_price").in("company_name", [COMPANY, STANDARD]).in("code", codes),
      ]);
      for (const r of [types, prods, prices]) if (r.error) throw new Error("OrderSteel: " + r.error.message);
      const tmap = new Map((types.data || []).map((t: any) => [t.name, t]));
      const cat: Catalogue = { orderType: null, orderTypes: tmap as any, costs: new Map(),
        products: new Map((prods.data || []).map((p: any) => [clean(p.code), { description: clean(p.description), category: null, active: p.active !== false, standard_price: p.standard_price ?? null }])),
        prices: new Map((prices.data || []).map((p: any) => [p.company_name + "|" + clean(p.code), p.custom_price])) };
      for (const i of steel) {
        const m = materialOf(i.category)!, code = lineCode({ code: i.code, name: i.name, category: i.category });
        const typeName = m.key === "reo" ? reoOrderType([clean(i.code)]) : m.orderType, t: any = tmap.get(typeName);
        const base = { item_id: i.item_id ?? null, name: clean(i.name), code, portal: "OrderSteel", order_type: typeName, prefix: clean(t?.id_prefix) };
        if (!t || t.active === false || !t.id_prefix) { out.push({ ...base, ok: false, why: "OrderSteel's " + typeName + " order type is missing or switched off." }); continue; }
        if (!code) { out.push({ ...base, ok: false, why: "No Item code (wholesale): add it in Product Management." }); continue; }
        const p = cat.products.get(code);
        if (!p || p.active === false) { out.push({ ...base, ok: false, why: "OrderSteel has no product " + code + "." }); continue; }
        if (priceOf(cat, code) === null) { out.push({ ...base, ok: false, why: code + " has no price for Direct in OrderSteel (Direct's, the Standard Price, or the product's own)." }); continue; }
        out.push({ ...base, ok: true, why: "" });
      }
    }
  }
  if (pods.length) {
    if (!c.pods) pods.forEach((i) => out.push({ item_id: i.item_id ?? null, name: clean(i.name), code: clean(i.code), portal: "OrderPods", order_type: "Wafflepods", prefix: "WP", ok: false, why: "The link to OrderPods is not set up." }));
    else {
      const codes = [...new Set(pods.map((i) => clean(i.code)).filter(Boolean))];
      const [pr, pd] = await Promise.all([
        c.pods.from("Customer Price").select('"Company Name", "Item Number", "Custom Price", effective_from, effective_to').in("Company Name", [POD.company, POD.standard]).in("Item Number", codes),
        c.pods.from("Products").select('"Code", "Description"').in("Code", codes),
      ]);
      for (const r of [pr, pd]) if (r.error) throw new Error("OrderPods: " + r.error.message);
      const cat = podCatalogue({ prices: pr.data, costs: [], products: pd.data, suburbs: [] }, c.now.toISOString().slice(0, 10));
      for (const i of pods) {
        const code = clean(i.code), base = { item_id: i.item_id ?? null, name: clean(i.name), code, portal: "OrderPods", order_type: "Wafflepods", prefix: "WP" };
        if (!code) { out.push({ ...base, ok: false, why: "No Item code: add it in Product Management." }); continue; }
        if (AUTO_POD.includes(code)) { out.push({ ...base, ok: true, why: "OrderPods adds " + code + " itself." }); continue; }
        if (!cat.descriptions.has(code)) { out.push({ ...base, ok: false, why: "OrderPods has no product " + code + "." }); continue; }
        if (podPrice(cat, code) === null) { out.push({ ...base, ok: false, why: code + " has no price for Direct in OrderPods." }); continue; }
        out.push({ ...base, ok: true, why: "" });
      }
    }
  }
  if (con.length) {
    if (!c.oc) con.forEach((i) => out.push({ item_id: i.item_id ?? null, name: clean(i.name), code: clean(i.code), portal: "OrderConcrete", order_type: "Concrete", prefix: "CON", ok: false, why: "The link to OrderConcrete is not set up." }));
    else {
      const codes = [...new Set(con.map((i) => clean(i.code)).filter(Boolean))];
      const [pr, pd] = await Promise.all([
        c.oc.from("CustomerPrice").select('"Company Name", "Item Number", "Custom Price", effective_from, effective_to').in("Company Name", [CON.company, CON.standard]).in("Item Number", codes),
        c.oc.from("Products").select('"Code", "Description", "TYPE"').in("Code", codes),
      ]);
      for (const r of [pr, pd]) if (r.error) throw new Error("OrderConcrete: " + r.error.message);
      const cat = conCatalogue({ prices: pr.data, costs: [], products: pd.data }, c.now.toISOString().slice(0, 10));
      for (const i of con) {
        const code = clean(i.code), base = { item_id: i.item_id ?? null, name: clean(i.name), code, portal: "OrderConcrete", order_type: "Concrete", prefix: "CON" };
        if (!code) { out.push({ ...base, ok: false, why: "No Item code: add it in Product Management." }); continue; }
        if (AUTO_CODES.includes(code)) { out.push({ ...base, ok: true, why: "OrderConcrete adds " + code + " itself." }); continue; }
        if (!cat.products.has(code)) { out.push({ ...base, ok: false, why: "OrderConcrete has no product " + code + "." }); continue; }
        /* no price is not a stop: OrderConcrete prices it on arrival (13 Nov 2026) */
        out.push({ ...base, ok: true, why: "" });
      }
    }
  }
  return out;
}
