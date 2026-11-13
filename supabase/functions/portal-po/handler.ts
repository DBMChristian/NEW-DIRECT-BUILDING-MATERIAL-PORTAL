// ordersteel-po (29 Oct 2026): send a Direct drop-ship purchase order to DBM's ordersteel as a Rediwall or Hebel order
// (one material per order, rules.ts MATERIALS; 30 Oct 2026 Hebel).
//   POST { action: "list" | "preview" | "send" | "send_test", order_id, choice: { lines?, deliveries?, distance?, contact_name?, contact_phone?, notes? } }
// kind: "dropship" (orders, the default) or "stock" (a confirmed Rediwall stock pre-order, purchase_orders).
// send_test (admins, switch test or on): the same order as a test Quote (rules.ts asTest): no Xero invoice, no email to
// DBM's desk, no booking; Direct's purchase order is not touched, so the real one can still be sent.
// The switch settings.ordersteel_send decides what is allowed: off (nothing), test (admins, preview only), on (send).
// Who: the staff who place orders (admin, pamela, nehme), the same as place_order. Rules: rules.ts.
// ordersteel is only ever ADDED to: one order, its lines, its PO group and PO. Nothing in ordersteel is updated, and the
// only delete is of the rows this same send has just added, when a later step of it fails (so no half order is left).
// Direct's side (ordersteel_send_claim / _finish) records the RED number on the purchase order; its column is not changed.
import { buildOrder, asTest, testPo, COMPANY, STANDARD, MATERIALS, REO_TYPE_NAMES, REO_SUPPLIERS, isOrdersteel, materialOf, lineCode, bdLength, type Catalogue, type Choice, type Source } from "./rules.ts";
import { podsAction, isWaffle } from "./pods.ts";
import { concreteAction, isConcrete } from "./concrete.ts";
import { pushDelivery } from "./delivery-edit.ts";
import { pushItemsOS } from "./items-edit.ts";
import { checkItems } from "./check.ts";
import { portalActivity, portalChatSend } from "./activity.ts";
const ALL = Object.values(MATERIALS), FREIGHTS = [...new Set(ALL.map((m) => m.freightCode))];
// reinforcement (31 Oct 2026): its three order types and their suppliers, besides each material's own
const SUPPLIERS = [...new Set([...ALL.map((m) => m.supplier), ...REO_SUPPLIERS])], TYPES = [...new Set([...ALL.map((m) => m.orderType), ...REO_TYPE_NAMES])];

const SENDERS = ["admin", "office"];   /* Direct's new portal: its roles (13 Nov 2026) */
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const hide = (t: unknown, secrets: string[]) => { let s = String(t ?? ""); for (const x of secrets) if (x && x.length > 8) s = s.split(x).join("[hidden]"); return s.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[hidden]").replace(/sb_secret_[\w-]+/g, "[hidden]"); };

export type Deps = { env: (k: string) => string | undefined; createClient: (url: string, key: string, opts?: unknown) => any; now?: () => Date };

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const env = (k: string) => (deps.env(k) ?? "").trim(), now = deps.now ? deps.now() : new Date();
  const osUrl = env("ORDERSTEEL_URL"), osKey = env("ORDERSTEEL_SERVICE_ROLE_KEY"), secrets = [osKey, env("SUPABASE_SERVICE_ROLE_KEY")];

  // 1. who is asking, with their own login
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Sign in to send to ordersteel" }, 401);
  const caller = deps.createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: "Bearer " + token } }, auth: { persistSession: false } });
  const { data: who } = await caller.auth.getUser(token);
  const email = String(who?.user?.email || "").toLowerCase();
  if (!email) return json({ error: "Sign in to send to ordersteel" }, 401);
  const [{ data: role }, { data: admin }] = await Promise.all([caller.rpc("my_role"), caller.rpc("is_admin")]);
  if (!SENDERS.includes(String(role || ""))) return json({ error: "Only the office staff who place orders can send to ordersteel" }, 403);

  // 2. the switch
  const direct = deps.createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const { data: st } = await direct.from("settings").select("value").eq("key", "ordersteel_send").maybeSingle();
  const mode = ["off", "test", "on"].includes(String(st?.value)) ? String(st.value) : "off";
  if (mode === "off") return json({ disabled: true, mode, reason: "Sending to ordersteel is switched off." });
  if (mode === "test" && admin !== true) return json({ disabled: true, mode, reason: "Sending to ordersteel is being tested by the admins." });
  let body: any = {};
  try { body = await req.json(); } catch { /* checked below */ }
  const action = String(body?.action || ""), orderId = Number(body?.order_id), kind = body?.kind === "stock" ? "stock" : "dropship";
  if (!["list", "preview", "send", "send_test", "update_delivery", "update_items", "check", "activity", "chat_send"].includes(action)) return json({ error: 'Send action "list", "preview", "send", "send_test", "update_delivery" or "update_items"' }, 400);
  if (action === "send_test" && admin !== true) return json({ error: "Only an admin sends a test to ordersteel" }, 403);
  /* check (11 Nov 2026): read-only, which portal and order type each product goes as, and whether it is there and priced */
  if (action === "check") {
    const items = Array.isArray(body?.items) ? body.items.slice(0, 1000) : [];
    if (!items.length) return json({ error: "Send items: [{ item_id, code, name, category }]" }, 400);
    const mk = (u: string, k: string) => (env(u) && env(k) ? deps.createClient(env(u), env(k), { auth: { persistSession: false } }) : null);
    try { return json({ mode, results: await checkItems(items, { os: mk("ORDERSTEEL_URL", "ORDERSTEEL_SERVICE_ROLE_KEY"), pods: mk("ORDERPODS_URL", "ORDERPODS_SERVICE_ROLE_KEY"), oc: mk("ORDERCONCRETE_URL", "ORDERCONCRETE_SERVICE_ROLE_KEY"), now }) }); }
    catch (e) { return json({ error: hide(e instanceof Error ? e.message : e, secrets) }, 502); }
  }
  /* activity (11 Nov 2026): read-only, a sent PO's order in DBM's portal now: its status, booking and activity */
  /* chat_send (11 Nov 2026): a message from Direct into the order's customer chat in OrderSteel */
  if (action === "chat_send") {
    const id = Number(body?.order_id); if (!Number.isSafeInteger(id) || id <= 0) return json({ error: "Send order_id" }, 400);
    const sv = deps.createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: row } = await sv.from("orders").select("id, po_no, supplier_ref").eq("id", id).maybeSingle();
    const ref = String(row?.supplier_ref || "").trim(); if (!ref) return json({ error: "This PO is not in DBM's portal yet" }, 409);
    const mk = (u: string, k: string) => (env(u) && env(k) ? deps.createClient(env(u), env(k), { auth: { persistSession: false } }) : null);
    const who = String(email || "").toLowerCase();
    const r = await portalChatSend(ref, String(body?.message || ""), who, { os: mk("ORDERSTEEL_URL", "ORDERSTEEL_SERVICE_ROLE_KEY"), pods: mk("ORDERPODS_URL", "ORDERPODS_SERVICE_ROLE_KEY"), oc: mk("ORDERCONCRETE_URL", "ORDERCONCRETE_SERVICE_ROLE_KEY"), podsCfg: { url: env("ORDERPODS_URL"), key: env("ORDERPODS_SERVICE_ROLE_KEY") }, ocCfg: { url: env("ORDERCONCRETE_URL"), key: env("ORDERCONCRETE_SERVICE_ROLE_KEY") } }, { file_url: String(body?.file_url || ""), reply_to: body?.reply_to ?? null });
    if ((r as any).ok) await sv.from("audit_log").insert({ who, action: "dbm_chat_sent", detail: (row?.po_no || "") + " → " + ref + ": " + String(body?.message || "").slice(0, 300) });
    return json(r, (r as any).ok ? 200 : 409);
  }
  if (action === "activity") {
    const ids = (Array.isArray(body?.order_ids) ? body.order_ids : [body?.order_id]).map(Number).filter((n: number) => Number.isSafeInteger(n) && n > 0).slice(0, 20);
    if (!ids.length) return json({ error: "Send order_ids" }, 400);
    const sv = deps.createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: rows, error: e1 } = await sv.from("orders").select("id, po_no, supplier_ref").in("id", ids);
    if (e1) return json({ error: hide(e1.message, secrets) }, 502);
    const mk = (u: string, k: string) => (env(u) && env(k) ? deps.createClient(env(u), env(k), { auth: { persistSession: false } }) : null);
    const c = { os: mk("ORDERSTEEL_URL", "ORDERSTEEL_SERVICE_ROLE_KEY"), pods: mk("ORDERPODS_URL", "ORDERPODS_SERVICE_ROLE_KEY"), oc: mk("ORDERCONCRETE_URL", "ORDERCONCRETE_SERVICE_ROLE_KEY"), podsCfg: { url: env("ORDERPODS_URL"), key: env("ORDERPODS_SERVICE_ROLE_KEY") }, ocCfg: { url: env("ORDERCONCRETE_URL"), key: env("ORDERCONCRETE_SERVICE_ROLE_KEY") } };
    const out = [];
    for (const r of rows || []) { const ref = String(r.supplier_ref || "").trim(); if (!ref) continue;
      try { out.push({ order_id: r.id, po_no: r.po_no, ...(await portalActivity(ref, c)) }); } catch (e) { out.push({ order_id: r.id, po_no: r.po_no, ref, error: hide(e instanceof Error ? e.message : e, secrets) }); } }
    return json({ mode, results: out, at: new Date().toISOString() });
  }
  if (action === "list") {
    // the POs that can be sent: one order's (quote_no), the ones this person placed in the last minutes (recent), or all
    const quote = typeof body?.quote_no === "string" && /^[A-Z]{2,4}-\d{1,9}$/.test(body.quote_no) ? body.quote_no : null;
    const { data, error } = await direct.rpc("ordersteel_po_candidates", { p_quote_no: quote, p_by: body?.recent ? email : null, p_minutes: body?.recent ? 15 : null });
    if (error) return json({ error: "Direct: " + hide(error.message, secrets) }, 502);
    const list = (Array.isArray(data) ? data : []).map((x: any) => ({ ...x, kind: "dropship" }));
    if (quote || body?.recent) return json({ mode, list });
    // the whole list (Warehouse › Pre-orders) also has the confirmed Rediwall stock orders not sent yet
    const st = await direct.rpc("ordersteel_stock_candidates");
    if (st.error) return json({ error: "Direct: " + hide(st.error.message, secrets) }, 502);
    return json({ mode, list: [...(Array.isArray(st.data) ? st.data : []).map((x: any) => ({ ...x, kind: "stock" })), ...list] });
  }
  if (!Number.isInteger(orderId) || orderId <= 0) return json({ error: "Send order_id, the purchase order's id" }, 400);
  if (!osUrl || !osKey) return json({ disabled: true, mode, reason: "The link to ordersteel is not set up yet (ORDERSTEEL_URL, ORDERSTEEL_SERVICE_ROLE_KEY)." });
  if (action === "send" && mode !== "on") return json({ error: "Test mode: the preview shows what would be sent. Nothing is sent until the switch is on.", mode }, 409);
  if ((action === "update_delivery" || action === "update_items") && (mode !== "on" || kind !== "dropship")) return json({ error: "Changing a sent order in DBM's portals needs the send switch on (drop-ship POs only)." }, 409);
  const choice: Choice = body?.choice && typeof body.choice === "object" ? body.choice : {};
  if (choice.lines && (!Array.isArray(choice.lines) || choice.lines.length > 200)) return json({ error: "choice.lines must be a list" }, 400);

  try {
    // 3. the purchase order, as Direct holds it
    const { data: src, error: srcErr } = kind === "stock"
      ? await direct.rpc("ordersteel_stock_source", { p_po_id: orderId })
      : await direct.rpc("ordersteel_po_source", { p_order_id: orderId });
    if (srcErr) throw new Error("Direct: " + srcErr.message);
    if (!src) return json({ error: "That purchase order does not exist." }, 404);
    const source = src as Source;
    // 6 Nov 2026: to Direct's warehouse, Direct's own contact (settings warehouse_contact_name / _phone) unless one is typed
    if ((source.ds_route === "penrith" || kind === "stock") && !String(choice.contact_name || "").trim()) {
      const { data: wc } = await direct.from("settings").select("key,value").in("key", ["warehouse_contact_name", "warehouse_contact_phone"]);
      const v = new Map((wc || []).map((r: any) => [r.key, String(r.value ?? "").trim()]));
      if (v.get("warehouse_contact_name")) { choice.contact_name = v.get("warehouse_contact_name"); if (!String(choice.contact_phone || "").trim()) choice.contact_phone = v.get("warehouse_contact_phone") || ""; }
    }

    // 3b. waffle pods go to DBM's OrderPods instead (pods.ts): a drop-ship PO whose ticked lines are all waffle pods
    const ticked = choice.lines ? new Set(choice.lines.map((c) => Number(c.item_id))) : null;
    const going = (source.lines || []).filter((l) => l.item_id != null && (!ticked || ticked.has(Number(l.item_id))));
    if (kind !== "stock" && going.length && going.every((l) => isWaffle(l.category))) {
      const podUrl = env("ORDERPODS_URL"), podKey = env("ORDERPODS_SERVICE_ROLE_KEY");
      if (!podUrl || !podKey) return json({ disabled: true, mode, reason: "The link to OrderPods is not set up yet (ORDERPODS_URL, ORDERPODS_SERVICE_ROLE_KEY)." });
      const pods = deps.createClient(podUrl, podKey, { auth: { persistSession: false } });
      return await notifySent(direct, env, source, "waffle", await podsAction({ action, mode, admin: admin === true, email, source: source as any, choice, direct, pods, now,
        json, hide: (m: unknown) => hide(m instanceof Error ? m.message : m, [...secrets, podKey]) }), email);
    }
    // 3c. concrete goes to DBM's OrderConcrete (concrete.ts): a drop-ship PO whose ticked lines are all concrete
    if (kind !== "stock" && going.length && going.every((l) => isConcrete(l.category))) {
      const ocUrl = env("ORDERCONCRETE_URL"), ocKey = env("ORDERCONCRETE_SERVICE_ROLE_KEY");
      if (!ocUrl || !ocKey) return json({ disabled: true, mode, reason: "The link to OrderConcrete is not set up yet (ORDERCONCRETE_URL, ORDERCONCRETE_SERVICE_ROLE_KEY)." });
      const oc = deps.createClient(ocUrl, ocKey, { auth: { persistSession: false } });
      return await notifySent(direct, env, source, "concrete", await concreteAction({ action, mode, admin: admin === true, email, source: source as any, choice, direct, oc, now,
        json, hide: (m: unknown) => hide(m instanceof Error ? m.message : m, [...secrets, ocKey]) }), email);
    }

    // 4. ordersteel: read only, the codes on this PO
    const os = deps.createClient(osUrl, osKey, { auth: { persistSession: false } });
    const codes = [...new Set((source.lines || []).filter((l) => isOrdersteel(l.category)).map((l) => lineCode(l)).filter(Boolean))];
    const [types, prods, prices, costs, dup] = await Promise.all([
      os.from("order_types").select("name, id_prefix, active, default_supplier, po_type").in("name", TYPES),
      os.from("products").select("code, description, category, active, standard_price").in("code", [...codes, ...FREIGHTS]),
      os.from("customer_prices").select("company_name, code, custom_price").in("company_name", [COMPANY, STANDARD]).in("code", [...codes, ...FREIGHTS]),
      os.from("cost_prices").select("code, supplier_name, cost_price").in("code", [...codes, ...FREIGHTS]),   // every supplier (4 Nov 2026)
      os.from("orders").select("order_id").eq("retail_customer_po", source.po_no).limit(1),
    ]);
    for (const [n, r] of [["order types", types], ["products", prods], ["prices", prices], ["costs", costs], ["orders", dup]] as const)
      if ((r as any).error) throw new Error("ordersteel " + n + ": " + (r as any).error.message);
    const cat: Catalogue = {
      orderType: (types.data || []).find((t: any) => t.name === MATERIALS.rediwall.orderType) || null,
      orderTypes: new Map((types.data || []).map((t: any) => [t.name, t])),
      products: new Map((prods.data || []).map((p: any) => [String(p.code).trim(), { description: String(p.description || ""), category: p.category ?? null, active: p.active !== false, standard_price: p.standard_price ?? null }])),
      prices: new Map((prices.data || []).map((p: any) => [p.company_name + "|" + String(p.code).trim(), p.custom_price])),   // $0 and blank stay: priceOf treats them as not set
      // by "supplier|code", and by code for the AFS rows (as before); the first row for a supplier and code wins
      costs: new Map((costs.data || []).filter((c: any) => c.cost_price !== null && c.cost_price !== "").flatMap((c: any) => {
        const k = c.supplier_name + "|" + String(c.code).trim(), n = Number(c.cost_price);
        return c.supplier_name === MATERIALS.rediwall.supplier ? [[String(c.code).trim(), n], [k, n]] : [[k, n]];
      }).reverse()),
    };
    const built = buildOrder(source, choice, cat, email, now);
    /* 6 Nov 2026: a sent PO's delivery changed in Direct: the same fields on DBM's order, while it is Open */
    /* 6 Nov 2026: a sent PO's items changed in Direct: the same items on DBM's order, while it is Open */
    if (action === "update_items") return await pushItemsOS({ db: os, items: built.rows.items as any[], order: built.rows.order as Record<string, unknown>, source, direct, email, json, hide: (m: unknown) => hide(m, secrets) });
    if (action === "update_delivery") { const r = built.rows.order as Record<string, unknown>;
      return await pushDelivery({ portal: "OrderSteel", db: os, table: "orders", idCol: "order_id", companyCol: "company_name", source, direct, email, json, hide: (m: unknown) => hide(m, secrets),
        fields: Object.fromEntries(["booking_date", "booking_time", "site_address", "suburb", "contact_name", "contact_phone", "dbm_special_instructions"].filter((k) => k in r).map((k) => [k, r[k]])) }); }
    const already = (dup.data || [])[0]?.order_id;
    if (already) built.problems.unshift(source.po_no + " is already in ordersteel as " + already + ".");
    const preview = { mode, kind, material: built.material.key, material_label: built.material.label, supplier_label: built.material.supplierLabel, freight_price: built.freightPrice,
      po_no: source.po_no, route: built.route, want_date: built.rows.order.booking_date, problems: built.problems, skipped: built.skipped,
      lines: built.rows.items.map((l) => ({ code: l.item_code, description: l.item_description, qty: l.qty, billed: l.qty_display, price: l.price, line_total: l.line_total })),
      totals: { products: built.base, impact: built.impact, freight_deliveries: built.freight, subtotal: built.subtotal, gst: built.gst, total: built.total },
      deliver_to: built.rows.order.site_address + ", " + built.rows.order.suburb, contact: built.rows.order.contact_name + " " + built.rows.order.contact_phone,
      booking: (built.rows.order.booking_date || "date not chosen yet") + " " + built.rows.order.booking_time, notes: built.rows.order.dbm_special_instructions, warnings: built.warnings,
      customer: source.customer, quote_no: source.quote_no, contact_name: built.rows.order.contact_name, contact_phone: built.rows.order.contact_phone,
      // every Rediwall line of the PO, for the ticks: sent (in the order now), its quantity, and why not when it cannot go
      items: (source.lines || []).filter((l) => isOrdersteel(l.category) && l.item_id != null).map((l) => {
        const sent = built.products.some((p) => p.item_id === Number(l.item_id));
        const chosen = choice.lines ? choice.lines.find((c) => Number(c.item_id) === Number(l.item_id)) : null;
        // BlueDeck: its code from the product; a custom size (no length in its name) is cut to the lengths entered (cuts)
        const bd = materialOf(l.category)?.key === "bluedeck", fixed = bd ? bdLength(l.name) : null;
        const extra = bd ? { bluedeck: true, fixed_mm: fixed, cut: !fixed, cuts: (choice.cuts || {})[String(l.item_id)] || [] } : {};
        return { ...extra, item_id: Number(l.item_id), name: l.name, code: lineCode(l) || null, ordered: Number(l.qty), qty: chosen ? Number(chosen.qty) : Number(l.qty),
          ticked: choice.lines ? !!chosen : true, sent: !!sent, why: built.skipped.find((k) => k.name === String(l.name || "").trim())?.why || null };
      }) };
    if (action === "preview") return json({ preview: true, ...preview, can_test: admin === true, note: "Nothing was sent." });
    if (built.problems.length) return json({ error: "This purchase order cannot be sent yet.", ...preview }, 422);

    // 5a. a test: a marked Quote in ordersteel, nothing on Direct's side but the audit
    if (action === "send_test") {
      const recent = await os.from("orders").select("order_id").eq("retail_customer_po", testPo(source.po_no)).gte("date_submitted", new Date(now.getTime() - 10 * 60000).toISOString()).limit(1);
      if (recent.error) throw new Error("ordersteel orders: " + recent.error.message);
      if ((recent.data || [])[0]) return json({ error: "A test of " + source.po_no + " was sent a moment ago as " + recent.data[0].order_id + "." }, 409);
      const t = asTest(built.rows, source.po_no);
      let added: string | null = null;
      try {
        const next = await os.rpc("next_order_id", { order_type: built.material.orderType });
        if (next.error || !next.data) throw new Error("no ordersteel order number (" + (next.error?.message || "none came back") + ")");
        const o = await os.from("orders").insert({ ...t.order, order_id: String(next.data) }).select("id, order_id").single();
        if (o.error || !o.data) throw new Error("orders: " + (o.error?.message || "no row came back"));
        added = o.data.id;
        const it = await os.from("order_items").insert(t.items.map((l) => ({ ...l, order_id: added })));
        if (it.error) throw new Error("order_items: " + it.error.message);
        const g = await os.from("order_po_groups").insert(t.groups.map((x) => ({ ...x, order_id: added })));
        if (g.error) throw new Error("order_po_groups: " + g.error.message);
        const p = await os.from("order_pos").upsert(t.pos.map((x) => ({ ...x, order_id: added })), { onConflict: "order_id,po_no", ignoreDuplicates: true });
        if (p.error) throw new Error("order_pos: " + p.error.message);
        await direct.from("audit_log").insert({ who: email, action: "ordersteel_test_send", detail: source.po_no + " sent to ordersteel as a TEST quote " + o.data.order_id + " (" + preview.totals.total + " incl GST)" });
        return json({ sent: true, test: true, kind, order_id: o.data.order_id, po_no: source.po_no, totals: preview.totals });
      } catch (err) {
        const msg = hide(err instanceof Error ? err.message : err, secrets);
        if (added) {
          for (const t2 of ["order_pos", "order_po_groups", "order_items"]) { try { await os.from(t2).delete().eq("order_id", added); } catch { /* reported below */ } }
          try { await os.from("orders").delete().eq("id", added); } catch { /* reported below */ }
        }
        return json({ error: "The test was not sent to ordersteel: " + msg + ". Nothing was left half-done." }, 502);
      }
    }

    // 5. send: claim it on Direct's side (once only), then add the order to ordersteel
    const { data: claim, error: claimErr } = kind === "stock"
      ? await direct.rpc("ordersteel_stock_claim", { p_po_id: orderId, p_by: email, p_request: { choice } })
      : await direct.rpc("ordersteel_send_claim", { p_order_id: orderId, p_by: email, p_request: { choice } });
    if (claimErr) throw new Error("Direct: " + claimErr.message);
    if (claim?.error) return json({ error: claim.error }, 409);
    let added: string | null = null;
    try {
      const next = await os.rpc("next_order_id", { order_type: built.material.orderType });
      if (next.error || !next.data) throw new Error("no ordersteel order number (" + (next.error?.message || "none came back") + ")");
      const o = await os.from("orders").insert({ ...built.rows.order, order_id: String(next.data) }).select("id, order_id").single();
      if (o.error || !o.data) throw new Error("orders: " + (o.error?.message || "no row came back"));
      added = o.data.id;
      const it = await os.from("order_items").insert(built.rows.items.map((l) => ({ ...l, order_id: added })));
      if (it.error) throw new Error("order_items: " + it.error.message);
      const g = await os.from("order_po_groups").insert(built.rows.groups.map((x) => ({ ...x, order_id: added })));
      if (g.error) throw new Error("order_po_groups: " + g.error.message);
      // ordersteel's own trigger makes the PO row for each group; one it made is left as it is
      const p = await os.from("order_pos").upsert(built.rows.pos.map((x) => ({ ...x, order_id: added })), { onConflict: "order_id,po_no", ignoreDuplicates: true });
      if (p.error) throw new Error("order_pos: " + p.error.message);
      const fin = await direct.rpc("ordersteel_send_finish", { p_claim_id: claim.claim_id, p_ok: true, p_ordersteel_id: o.data.order_id, p_error: null, p_result: { ...preview.totals, lines: (preview.lines || []).map((l: any) => ({ code: l.code, description: l.description, qty: l.billed ?? l.qty, price: l.price, line_total: l.line_total })) } });   /* the lines sent: Direct's Xero PO copies them (20261101100000); a BlueDeck line at its billed m2 (6 Nov 2026) */
      return await notifySent(direct, env, source, built.material.key, json({ sent: true, kind, order_id: o.data.order_id, po_no: source.po_no, totals: preview.totals, lines: preview.lines, recorded_on_po: fin.data?.supplier_ref_set === true }), email);
    } catch (err) {
      const msg = hide(err instanceof Error ? err.message : err, secrets);
      if (added) {   // only the rows this send added, by the new order's own id
        for (const t of ["order_pos", "order_po_groups", "order_items"]) { try { await os.from(t).delete().eq("order_id", added); } catch { /* reported below */ } }
        try { await os.from("orders").delete().eq("id", added); } catch { /* reported below */ }
      }
      await direct.rpc("ordersteel_send_finish", { p_claim_id: claim.claim_id, p_ok: false, p_ordersteel_id: null, p_error: msg, p_result: {} });
      return json({ error: "Not sent to ordersteel: " + msg + ". Nothing was left half-done; try again." }, 502);
    }
  } catch (err) {
    return json({ error: "Send to ordersteel: " + hide(err instanceof Error ? err.message : err, secrets) }, 502);
  }
}

/* A PO just sent to DBM, emailed by Direct's messages queue (6 Nov 2026): concrete, waffle pods, or the rest, each to its
   address (settings, with these defaults), in DBM's own email design with the text as its fallback; DBM's prices from the
   send. Only after a real send; a failure here never changes the send's own answer. */
const PO_MAIL: Record<string, [string, string]> = {
  concrete: ["dbm_po_email_concrete", "concrete@discountbuildingmaterial.com.au"],
  waffle: ["dbm_po_email_waffle", "orders@styrofoamindustries.com.au"],
};
const PO_MAT: Record<string, string> = { waffle: "Waffle Pods", rediwall: "Rediwall", hebel: "Hebel", bluedeck: "BlueDeck", reo: "Reinforcement", concrete: "Concrete" };
/* The PO email (11 Nov 2026), in OrderSteel's purchase-order layout: Direct's header, "New purchase order", the PO number,
   who it is to, the date tile with the time and the site, What we need (product and quantity, no prices), the special
   instructions highlighted, the contact on site, the billing details and how to confirm. Table layout and inline styles,
   as email apps need. */
function poEmailHtml(d: any): string {const e=(x: unknown)=>String(x??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'} as Record<string,string>)[c]);
 const lab='font-size:10px;color:#8B867B;';
 const rows=(d.items||[]).map((i: any)=>'<tr><td style="padding:10px 12px;border-top:1px solid #E7E3DA;font-size:13px">'+e(i.name)+(i.code?'<div style="color:#2F6FDE;font-size:11px;margin-top:2px">'+e(i.code)+'</div>':'')+'</td><td align="right" style="padding:10px 12px;border-top:1px solid #E7E3DA;font-size:13px;white-space:nowrap">'+e(i.qty)+(i.unit&&!/^each$/i.test(i.unit)?' '+e(i.unit):'')+'</td></tr>').join('');
 const ins=String(d.instructions||'').trim();
 const det=(d.details||[]).filter((x: any)=>x&&x[1]!=null&&String(x[1]).trim()!=='');const detRows: string[]=[];
 for(let i=0;i<det.length;i+=2)detRows.push('<tr>'+[det[i],det[i+1]].map((x: any)=>x?'<td width="50%" style="padding:8px 0;border-top:1px solid #ECE8E0;vertical-align:top"><div style="'+lab+'">'+e(x[0])+'</div><div style="font-size:13px;margin-top:2px">'+e(x[1])+'</div></td>':'<td width="50%" style="border-top:1px solid #ECE8E0"></td>').join('<td width="16"></td>')+'</tr>');
 return '<div style="background:#E4E1DA;padding:20px 0;font-family:Arial,Helvetica,sans-serif;color:#1f1b16"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff">'
  +'<tr><td style="background:#1f1b16;padding:18px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td><span style="color:#ffffff;font-weight:900;font-size:20px;letter-spacing:1px">DIRECT</span> <span style="display:inline-block;background:#B91C1C;color:#ffffff;font-weight:900;font-size:13px;letter-spacing:1px;padding:4px 8px;margin-left:4px">BUILDING MATERIAL</span></td><td align="right" style="color:#F59E0B;font-size:12px;font-weight:bold">'+e(d.tag||'Purchase order')+'</td></tr></table></td></tr>'
  +'<tr><td style="padding:22px 24px 0"><span style="display:inline-block;background:#E8E4FA;color:#4338CA;font-size:11px;font-weight:bold;padding:3px 9px;border-radius:3px">'+e(d.status||'New purchase order')+'</span>'
  +'<div style="font-size:24px;font-weight:bold;margin:12px 0 4px">Purchase order '+e(d.poNo)+'</div><div style="font-size:12px;color:#6B665C;margin-bottom:16px">To '+e(d.to||'Discount Building Material Pty Ltd')+'</div></td></tr>'
  +'<tr><td style="padding:0 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:2px solid #1f1b16"><tr><td width="104" align="center" style="background:#1f1b16;color:#ffffff;padding:12px 8px"><div style="font-size:12px;font-weight:bold">'+e(d.dow)+'</div><div style="font-size:34px;font-weight:bold;color:#F59E0B;line-height:1.1">'+e(d.dnum)+'</div><div style="font-size:11px;font-weight:bold">'+e(d.mon)+'</div></td>'
  +'<td style="padding:12px 16px;vertical-align:middle"><div style="font-size:20px;font-weight:bold">'+e(d.time)+'</div><div style="font-size:13px;margin-top:4px">'+e(d.addr1)+'</div>'+(d.addr2?'<div style="font-size:13px">'+e(d.addr2)+'</div>':'')+'</td></tr>'
  +'<tr><td colspan="2" style="border-top:1px solid #D9D4C9;padding:10px 16px"><div style="'+lab+'">Purchase order</div><div style="font-size:13px;font-weight:bold;margin-top:2px">'+e(d.poNo)+'</div>'+(d.portalNo?'<div style="'+lab+'margin-top:6px">'+e(d.portal||'DBM')+' order</div><div style="font-size:13px;font-weight:bold;margin-top:2px">'+e(d.portalNo)+'</div>':'')+'</td></tr></table></td></tr>'
  +'<tr><td style="padding:22px 24px 0"><div style="font-size:15px;font-weight:bold;margin-bottom:8px">What we need</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F2EE;border-collapse:collapse"><tr><td style="padding:8px 12px;font-size:10px;color:#8B867B">Product</td><td align="right" style="padding:8px 12px;font-size:10px;color:#8B867B">Qty</td></tr>'+rows+'</table></td></tr>'
  +(ins?'<tr><td style="padding:16px 24px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FEF9C3;border:1px solid #FACC15"><tr><td style="padding:12px 14px"><div style="font-size:10px;font-weight:bold;letter-spacing:1px;color:#A16207">SPECIAL INSTRUCTIONS</div><div style="font-size:13px;font-weight:bold;margin-top:6px;white-space:pre-line;line-height:1.5">'+e(ins)+'</div></td></tr></table></td></tr>':'')
  +((d.contactName||d.contactPhone)?'<tr><td style="padding:14px 24px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="50%"><div style="'+lab+'">Contact name</div><div style="font-size:13px;margin-top:2px">'+e(d.contactName)+'</div></td><td><div style="'+lab+'">Contact phone</div><div style="font-size:13px;margin-top:2px">'+e(d.contactPhone)+'</div></td></tr></table></td></tr>':'')
  +(detRows.length?'<tr><td style="padding:14px 24px 0"><div style="font-size:15px;font-weight:bold;margin-bottom:4px">On the day</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0">'+detRows.join('')+'</table></td></tr>':'')
  +'<tr><td style="padding:16px 24px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFF1F2;border:1px solid #FDA4AF"><tr><td style="padding:12px 14px"><div style="font-size:10px;font-weight:bold;letter-spacing:1px;color:#BE123C">BILLING DETAILS:</div><div style="font-size:12.5px;margin-top:6px;line-height:1.5">This purchase order is from <b>Direct Building Material Pty Ltd</b>. Please invoice <b>Direct Building Material Pty Ltd</b>.'+(d.reference?' Reference: <b>'+e(d.reference)+'</b>.':'')+'</div></td></tr></table></td></tr>'
  +'<tr><td style="padding:18px 24px 0"><a href="mailto:'+e(d.replyTo||'orders@directbuildingmaterial.com.au')+'?subject='+encodeURIComponent('Confirmed: purchase order '+(d.poNo||''))+'" style="display:inline-block;background:#1f1b16;color:#ffffff;font-size:12px;font-weight:bold;padding:10px 16px;text-decoration:none">Confirm this purchase order</a></td></tr>'
  +'<tr><td style="padding:16px 24px 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FEFCE8;border:1px solid #FDE68A"><tr><td style="padding:10px 14px;font-size:11.5px;color:#57534E;line-height:1.5">Please confirm this purchase order and the delivery date by reply. If anything cannot be supplied as scheduled, tell us before the delivery date rather than on it.</td></tr></table></td></tr>'
  +'<tr><td align="center" style="background:#1f1b16;color:#D6CFC4;font-size:11.5px;padding:16px 24px">Direct Building Material · 16 Cassola Place, Penrith NSW 2750</td></tr></table></td></tr></table></div>'}


/* The waffle pod PO email (11 Nov 2026), in OrderPods' purchase-order layout: the OrderPods header with Direct's PO
   number, the greeting to Styrofoam Industries, Delivery and Fulfilment, Deliver to (with the gate code and scrap
   pick-up) and Site contact, then Items ordered as products and additional charges: quantity, code and description only,
   no prices or totals; the special instructions highlighted; how to confirm. */
function podsEmailHtml(d: any): string {const e=(x: unknown)=>String(x??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'} as Record<string,string>)[c]);
 const lab='font-size:9.5px;font-weight:bold;letter-spacing:.8px;color:#8B867B;text-transform:uppercase';
 const box=(inner: string)=>'<td valign="top" style="border:1px solid #E7E3DA;border-radius:6px;padding:10px 12px">'+inner+'</td>';
 const isCharge=(i: any)=>/^(WPDEL|WPENVIRO|WPSB|FUEL ?LEVY|FR-)/i.test(String(i.code||''));
 const prods=(d.items||[]).filter(i=>!isCharge(i)),charges=(d.items||[]).filter(isCharge);
 const row=(i: any)=>'<tr><td style="padding:8px 6px;border-top:1px solid #EFECE6;font-size:12.5px;font-weight:bold;white-space:nowrap">'+e(i.qty)+'</td><td style="padding:8px 6px;border-top:1px solid #EFECE6;font-size:12.5px;font-weight:bold;white-space:nowrap">'+e(i.code)+(/^WPSB$/i.test(String(i.code||''))&&i.free?' <span style="display:inline-block;background:#DCFCE7;color:#15803D;font-size:9px;font-weight:bold;padding:1px 5px;border-radius:3px">FREE</span>':'')+'</td><td style="padding:8px 6px;border-top:1px solid #EFECE6;font-size:12.5px">'+e(i.name)+'</td></tr>';
 const sec=(t: string)=>'<tr><td colspan="3" style="padding:10px 6px 4px;'+lab+'">'+t+'</td></tr>';
 const ins=String(d.instructions||'').trim();
 return '<div style="background:#E4E1DA;padding:20px 0;font-family:Arial,Helvetica,sans-serif;color:#1f1b16"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden">'
  +'<tr><td style="background:#1f1b16;padding:16px 24px;border-bottom:3px solid #F59E0B"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-size:20px;font-weight:bold"><span style="color:#ffffff">Order</span><span style="color:#F59E0B">Pods</span></td><td align="right"><div style="color:#A8A29E;font-size:9px;font-weight:bold;letter-spacing:1px">PURCHASE ORDER</div><div style="color:#ffffff;font-size:18px;font-weight:bold">'+e(d.poNo)+'</div></td></tr></table></td></tr>'
  +'<tr><td style="padding:22px 24px 0"><div style="font-size:20px;font-weight:bold">New purchase order</div><div style="font-size:12.5px;color:#44403C;margin-top:6px;line-height:1.5">Hi <b>'+e(d.to||'Styrofoam Industries Pty Ltd')+'</b>, please supply the items below for delivery to '+e(d.site||'the site below')+'. Please confirm or decline it using the button at the bottom.</div></td></tr>'
  +'<tr><td style="padding:16px 24px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="8" style="margin:0 -8px"><tr>'
  +box('<div style="'+lab+'">'+(d.fulfil==='Pick-up'?'Pick-up':'Delivery')+'</div><div style="font-size:13.5px;font-weight:bold;margin-top:4px">'+e(d.dateLong||'Date to come')+'</div><div style="font-size:11.5px;color:#78716C;margin-top:2px">Time: '+e(d.time||'ANYTIME')+'</div>')
  +box('<div style="'+lab+'">Fulfilment</div><div style="font-size:13.5px;font-weight:bold;margin-top:4px">'+e(d.fulfil||'Delivery')+'</div><div style="font-size:11.5px;color:#78716C;margin-top:2px">'+e(d.location||'')+'</div>')
  +'</tr></table></td></tr>'
  +'<tr><td style="padding:4px 24px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="8" style="margin:0 -8px"><tr>'
  +box('<div style="'+lab+'">Deliver to</div><div style="font-size:13.5px;font-weight:bold;margin-top:4px">'+e(d.addr1)+'</div><div style="font-size:11.5px;color:#78716C">'+e(d.addr2)+'</div><table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:8px;font-size:11.5px"><tr><td style="color:#78716C;padding:2px 14px 2px 0">Gate code</td><td style="font-weight:bold">'+e(d.gate||'N/A')+'</td></tr><tr><td style="color:#78716C;padding:2px 14px 2px 0">Scrap pick-up</td><td style="font-weight:bold">'+e(d.scrap||'No')+'</td></tr>'+(d.trailer?'<tr><td style="color:#78716C;padding:2px 14px 2px 0">Trailer access</td><td style="font-weight:bold">'+e(d.trailer)+'</td></tr>':'')+'</table>')
  +box('<div style="'+lab+'">Site contact</div><div style="font-size:13.5px;font-weight:bold;margin-top:4px">'+e([d.contactName,d.contactPhone].filter(Boolean).join(' ')||'—')+'</div>'+(d.contactEmail?'<div style="font-size:11.5px;color:#2F6FDE">'+e(d.contactEmail)+'</div>':'')+'<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:8px;font-size:11.5px"><tr><td style="color:#78716C;padding:2px 14px 2px 0;vertical-align:top">Ordered by</td><td style="font-weight:bold">'+e(d.by||'Direct Building Material')+'</td></tr><tr><td style="color:#78716C;padding:2px 14px 2px 0">Placed</td><td style="font-weight:bold">'+e(d.placed||'')+'</td></tr></table>')
  +'</tr></table></td></tr>'
  +'<tr><td style="padding:16px 24px 0"><div style="font-size:14px;font-weight:bold">Items ordered <span style="font-weight:normal;color:#78716C;font-size:12px">('+((d.items||[]).length)+' lines)</span></div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;border-collapse:collapse"><tr><td style="padding:6px;'+lab+';border-bottom:1px solid #1f1b16">Qty</td><td style="padding:6px;'+lab+';border-bottom:1px solid #1f1b16">Code</td><td style="padding:6px;'+lab+';border-bottom:1px solid #1f1b16">Description</td></tr>'
  +(prods.length?sec('Products')+prods.map(row).join(''):'')+(charges.length?sec('Additional charges')+charges.map(row).join(''):'')+'</table></td></tr>'
  +(ins?'<tr><td style="padding:16px 24px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FEF9C3;border:1px solid #FACC15;border-radius:6px"><tr><td style="padding:12px 14px"><div style="font-size:9.5px;font-weight:bold;letter-spacing:1px;color:#A16207">SPECIAL INSTRUCTIONS</div><div style="font-size:13px;font-weight:bold;margin-top:6px;white-space:pre-line;line-height:1.5">'+e(ins)+'</div></td></tr></table></td></tr>':'')
  +'<tr><td style="padding:16px 24px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFF1F2;border:1px solid #FDA4AF;border-radius:6px"><tr><td style="padding:10px 14px;font-size:12px;line-height:1.5"><b style="font-size:9.5px;letter-spacing:1px;color:#BE123C">BILLING DETAILS:</b> This purchase order is from <b>Direct Building Material Pty Ltd</b>. Please invoice <b>Direct Building Material Pty Ltd</b>.'+(d.reference?' Reference: <b>'+e(d.reference)+'</b>.':'')+'</td></tr></table></td></tr>'
  +'<tr><td style="padding:20px 24px 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFBEB;border-radius:6px"><tr><td align="center" style="padding:18px 16px"><div style="font-size:15px;font-weight:bold">Can you supply this order?</div><div style="font-size:12px;color:#57534E;margin:6px 0 12px">Please confirm or decline it by reply, and tell us before the delivery date if anything cannot be supplied as scheduled.</div><a href="mailto:'+e(d.replyTo||'orders@directbuildingmaterial.com.au')+'?subject='+encodeURIComponent('Purchase order '+(d.poNo||'')+': confirmed')+'" style="display:inline-block;background:#F59E0B;color:#1f1b16;font-size:13px;font-weight:bold;padding:10px 22px;border-radius:6px;text-decoration:none">Confirm this purchase order</a></td></tr></table></td></tr>'
  +'<tr><td align="center" style="background:#1f1b16;padding:14px 24px;font-size:14px;font-weight:bold"><span style="color:#ffffff">Order</span><span style="color:#F59E0B">Pods</span></td></tr></table></td></tr></table></div>'}


/* The concrete PO email (11 Nov 2026), in OrderConcrete's order layout: the OrderConcrete header with Direct's PO number,
   "New concrete order" with the site and the day, the times we'd like (preferred, option 2, option 3), the order and its
   release, every item (quantity, code, description, no prices), the pour details, the special instructions highlighted,
   the billing details and how to confirm. */
function concreteEmailHtml(d: any): string {const e=(x: unknown)=>String(x??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'} as Record<string,string>)[c]);
 const lab='font-size:9.5px;font-weight:bold;letter-spacing:.8px;color:#8B867B;text-transform:uppercase';
 const tile=(t: string,v: unknown,on?: boolean)=>'<td align="center" style="border:'+(on?'2px solid #16A34A;background:#F0FDF4':'1px solid #D6D3D1')+';border-radius:4px;padding:8px 12px;min-width:90px"><div style="'+lab+(on?';color:#15803D':'')+'">'+e(t)+'</div><div style="font-size:15px;font-weight:bold;margin-top:2px">'+e(v||'—')+'</div></td><td width="8"></td>';
 const rows=(d.items||[]).map((i: any)=>'<tr><td style="padding:8px 6px;border-top:1px solid #EFECE6;font-size:12.5px;font-weight:bold;white-space:nowrap">'+e(i.qty)+(i.unit?' '+e(i.unit):'')+'</td><td style="padding:8px 6px;border-top:1px solid #EFECE6;font-size:12.5px;font-weight:bold;white-space:nowrap">'+e(i.code)+'</td><td style="padding:8px 6px;border-top:1px solid #EFECE6;font-size:12.5px">'+e(i.name)+'</td></tr>').join('');
 const det=(d.details||[]).filter((x: any)=>x&&x[1]!=null&&String(x[1]).trim()!=='');const detRows: string[]=[];
 for(let i=0;i<det.length;i+=2)detRows.push('<tr>'+[det[i],det[i+1]].map((x: any)=>x?'<td width="50%" style="padding:7px 0;border-top:1px solid #ECE8E0;vertical-align:top"><div style="'+lab+'">'+e(x[0])+'</div><div style="font-size:12.5px;margin-top:2px">'+e(x[1])+'</div></td>':'<td width="50%" style="border-top:1px solid #ECE8E0"></td>').join('<td width="16"></td>')+'</tr>');
 const ins=String(d.instructions||'').trim();
 return '<div style="background:#E4E1DA;padding:20px 0;font-family:Arial,Helvetica,sans-serif;color:#1f1b16"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff">'
  +'<tr><td style="background:#1f1b16;padding:16px 24px;border-bottom:3px solid #F59E0B"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td><span style="color:#ffffff;font-weight:900;font-size:18px;letter-spacing:1px">ORDER</span> <span style="display:inline-block;background:#F59E0B;color:#1f1b16;font-weight:900;font-size:15px;letter-spacing:1px;padding:2px 6px">CONCRETE</span></td><td align="right" style="color:#F59E0B;font-size:12px;font-weight:bold">New order · '+e(d.poNo)+'</td></tr></table></td></tr>'
  +'<tr><td style="padding:20px 24px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ECFDF5;border-left:4px solid #16A34A"><tr><td style="padding:12px 14px"><div style="font-size:19px;font-weight:bold;color:#14532D">New concrete order'+(d.plant?' for '+e(d.plant):'')+'</div><div style="font-size:13px;margin-top:4px">'+e(d.site)+(d.dateShort?' · '+e(d.dateShort):'')+'</div></td></tr></table></td></tr>'
  +'<tr><td style="padding:16px 24px 0"><div style="'+lab+'">Times we\'d like</div><table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:6px"><tr>'+tile('Preferred',d.opt1,true)+tile('Option 2',d.opt2)+tile('Option 3',d.opt3)+'</tr></table></td></tr>'
  +'<tr><td style="padding:14px 24px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E7E3DA"><tr><td width="50%" style="padding:10px 12px"><div style="'+lab+'">Order</div><div style="font-size:13.5px;font-weight:bold;margin-top:2px">'+e(d.poNo)+'</div></td><td style="padding:10px 12px"><div style="'+lab+'">Release</div><div style="font-size:13.5px;font-weight:bold;margin-top:2px">'+e(d.release||'—')+'</div></td></tr></table></td></tr>'
  +'<tr><td style="padding:16px 24px 0"><div style="font-size:14px;font-weight:bold">Items <span style="font-weight:normal;color:#78716C;font-size:12px">('+((d.items||[]).length)+' lines)</span></div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;border-collapse:collapse"><tr><td style="padding:6px;'+lab+';border-bottom:1px solid #1f1b16">Qty</td><td style="padding:6px;'+lab+';border-bottom:1px solid #1f1b16">Code</td><td style="padding:6px;'+lab+';border-bottom:1px solid #1f1b16">Description</td></tr>'+rows+'</table></td></tr>'
  +(detRows.length?'<tr><td style="padding:14px 24px 0"><div style="font-size:14px;font-weight:bold;margin-bottom:4px">The pour</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0">'+detRows.join('')+'</table></td></tr>':'')
  +(ins?'<tr><td style="padding:14px 24px 0"><div style="'+lab+'">Special instructions</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;background:#FFF7ED;border-left:4px solid #F59E0B"><tr><td style="padding:10px 12px;font-size:13px;white-space:pre-line;line-height:1.5">'+e(ins)+'</td></tr></table></td></tr>':'')
  +((d.contactName||d.contactPhone)?'<tr><td style="padding:14px 24px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="50%"><div style="'+lab+'">Contact name</div><div style="font-size:13px;margin-top:2px">'+e(d.contactName)+'</div></td><td><div style="'+lab+'">Contact phone</div><div style="font-size:13px;margin-top:2px">'+e(d.contactPhone)+'</div></td></tr></table></td></tr>':'')
  +'<tr><td style="padding:14px 24px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFF1F2;border:1px solid #FDA4AF"><tr><td style="padding:10px 14px;font-size:12px;line-height:1.5"><b style="font-size:9.5px;letter-spacing:1px;color:#BE123C">BILLING DETAILS:</b> This order is from <b>Direct Building Material Pty Ltd</b>. Please invoice <b>Direct Building Material Pty Ltd</b>.'+(d.reference?' Reference: <b>'+e(d.reference)+'</b>.':'')+'</td></tr></table></td></tr>'
  +'<tr><td align="center" style="padding:20px 24px 6px"><a href="mailto:'+e(d.replyTo||'orders@directbuildingmaterial.com.au')+'?subject='+encodeURIComponent('Concrete order '+(d.poNo||'')+': booked')+'" style="display:inline-block;background:#F59E0B;color:#1f1b16;font-size:13px;font-weight:bold;padding:11px 22px;border-radius:4px;text-decoration:none">Confirm the booking</a></td></tr>'
  +'<tr><td align="center" style="padding:0 24px 22px;font-size:11.5px;color:#78716C">Please reply with the time booked, or decline it, and tell us before the day if it cannot go as planned.</td></tr>'
  +'<tr><td align="center" style="background:#1f1b16;color:#D6CFC4;font-size:11.5px;padding:14px 24px">Direct Building Material · 16 Cassola Place, Penrith NSW 2750</td></tr></table></td></tr></table></div>'}


const money2 = (n: unknown) => { const v = Number(n); return Number.isFinite(v) ? "$" + v.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""; };
export async function notifySent(direct: any, env: (k: string) => string, source: any, mat: string, res: Response, who = ""): Promise<Response> {
  /* Direct's new portal (13 Nov 2026): the PO email goes from New Order itself, so nothing more is sent here */
  void direct; void env; void source; void mat; void who; return res;

  try {
    const r = await res.clone().json();
    if (!r?.sent || r?.test) return res;
    const [key, fallback] = PO_MAIL[mat] || ["dbm_po_email_default", "sales@discountbuildingmaterial.com.au"];
    const { data: st } = await direct.from("settings").select("value").eq("key", key).maybeSingle();
    const to = String(st?.value || fallback).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res;
    const portal = mat === "waffle" ? "OrderPods" : mat === "concrete" ? "OrderConcrete" : "OrderSteel", label = PO_MAT[mat] || "Supplier";
    const job = (source.job && typeof source.job === "object" ? source.job : {}) as Record<string, unknown>, cl = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
    const dm = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(source.want_date || "")), dt = dm ? new Date(+dm[1], +dm[2] - 1, +dm[3]) : null;
    const slot = cl(job.delivery_requested_slot || source.slot), time = !slot || /^any ?time$/i.test(slot) ? "Any time" : slot;
    const site = source.ds_route === "penrith" ? "16 Cassola Place, Penrith NSW (stock for Direct's warehouse)" : cl(source.site), cut = site.lastIndexOf(",");
    const units = new Map((source.lines || []).map((l: any) => [cl(l.code), cl(l.unit)]));
    const sent = Array.isArray(r.lines) && r.lines.length ? r.lines : (source.lines || []).filter((l: any) => l && l.item_id != null && Number(l.qty) > 0).map((l: any) => ({ code: l.code, description: l.name, qty: l.qty }));
    const items = sent.map((l: any) => ({ name: cl(l.description || l.name), code: cl(l.code), qty: String(l.qty ?? ""), unit: ((u: string) => /^cubic ?met/i.test(u) ? "m³" : u)(String(units.get(cl(l.code)) || (mat === "concrete" && /^CR\d/i.test(cl(l.code)) ? "m³" : ""))),
      price: l.price != null ? money2(l.price) : "", amount: l.line_total != null ? money2(l.line_total) : "" }));
    const yn = (v: unknown) => /^y(es)?$/i.test(cl(v)) ? "Yes" : cl(v) ? "No" : "";
    const details: [string, string][] = mat !== "concrete" ? [] : [["Truck size", cl(job.concrete_truck)], ["Spacing", cl(job.concrete_spacing)], ["Pour method", cl(job.concrete_pour)], ["Tester", yn(job.concrete_tester)],
      ["Coloured", yn(job.concrete_coloured) === "Yes" ? "Yes" + (cl(job.concrete_colour) ? ", " + cl(job.concrete_colour) : "") : yn(job.concrete_coloured)], ["Site access", yn(job.concrete_restriction) === "Yes" ? cl(job.concrete_restriction_note) || "Restricted" : yn(job.concrete_restriction)],
      ["Site contact", cl(job.site_contact || source.site_contact)], ["Supplier", cl(job.concrete_supplier) || "DBM chooses"]];
    const tt = r.totals || {}, by = who ? who.split("@")[0].replace(/[._]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "Direct Building Material";
    const d = { tag: mat === "concrete" ? "Concrete order" : "Purchase order", status: "Sent", title: "New " + (mat === "concrete" ? "concrete" : label) + " order",
      dow: dt ? dt.toLocaleDateString("en-AU", { weekday: "short" }) : "", dnum: dt ? String(dt.getDate()) : "–", mon: dt ? dt.toLocaleDateString("en-AU", { month: "short", year: "numeric" }) : "Date to come",
      time, addr1: cut > 0 ? site.slice(0, cut).trim() : site, addr2: cut > 0 ? site.slice(cut + 1).trim() : "", orderLabel: portal + " order", orderId: r.order_id, byLabel: "Sent by", by,
      itemsTitle: mat === "concrete" ? "Your concrete" : "Items", items, subtotal: money2(tt.subtotal), gst: money2(tt.gst), total: Number(tt.total) > 0 ? money2(tt.total) : "",
      details, concrete: mat === "concrete", note: "Direct's purchase order " + source.po_no + " · order " + (source.quote_no || "") + " · customer " + (source.customer || "") + ".",
      status: "New purchase order", poNo: source.po_no, to: mat === "waffle" ? "Styrofoam Industries" : "Discount Building Material Pty Ltd", portal, portalNo: r.order_id,
      instructions: [cl(source.site_notes), cl(job.special_instructions)].filter(Boolean).join("\n"),
      contactName: cl(cl(source.site_contact).replace(/(\+?\d[\d\s]{7,}\d)/, "")) || cl(source.contact_name), contactPhone: ((cl(source.site_contact).match(/(\+?\d[\d\s]{7,}\d)/) || [])[1] || cl(source.contact)),
      reference: source.quote_no || "", replyTo: "orders@directbuildingmaterial.com.au" };
    const subject = "Direct Building Material · " + source.po_no + " sent to " + portal + " as " + r.order_id;
    const body = [d.title + ": " + source.po_no + " is in " + portal + " as " + r.order_id + " (Open).", "",
      "When: " + (dt ? dt.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "to be advised") + ", " + time, "Deliver to: " + site, "",
      "Items:", ...items.map((i: any) => "  " + i.qty + (i.unit ? " " + i.unit : "") + "  " + i.name + (i.code ? " (" + i.code + ")" : "") + ""), "",
      "", ...details.filter((x) => x[1]).map(([k, v]) => k + ": " + v), "", d.note, "Sent from the Direct portal by " + by + "."]
      .filter((x, i, a) => !(x === "" && a[i - 1] === "")).join("\n");
    const row: Record<string, unknown> = { channel: "email", event: "dbm_po_sent", to_addr: to, subject, body, html: mat === "waffle" ? podsEmailHtml({ poNo: source.po_no, to: "Styrofoam Industries Pty Ltd", site, addr1: cut > 0 ? site.slice(0, cut).trim() : site, addr2: cut > 0 ? site.slice(cut + 1).trim() : "",
      dateLong: dt ? dt.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "", time: time === "Any time" ? "ANYTIME" : time,
      fulfil: /pick/i.test(cl(source.fulfil)) ? "Pick-up" : "Delivery", location: cl(job.location), gate: cl(job.gate_code) || "N/A", scrap: yn(job.scrap_pickup), trailer: yn(job.trailer_access),
      contactName: cl(cl(source.site_contact).replace(/(\+?\d[\d\s]{7,}\d)/, "")) || cl(source.contact_name), contactPhone: ((cl(source.site_contact).match(/(\+?\d[\d\s]{7,}\d)/) || [])[1] || cl(source.contact)),
      by, placed: new Date().toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric" }),
      items: items.map((i: any) => ({ qty: i.qty, code: i.code, name: i.name, free: /^WPSB$/i.test(i.code) })), instructions: [cl(source.site_notes), cl(job.special_instructions)].filter(Boolean).join("\n"),
      reference: source.quote_no || "", replyTo: "orders@directbuildingmaterial.com.au" }) : mat === "concrete" ? concreteEmailHtml({ poNo: source.po_no, site, dateShort: dt ? dt.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "",
      opt1: cl(job.concrete_option1) || time, opt2: cl(job.concrete_option2), opt3: cl(job.concrete_option3),
      release: /^release/i.test(cl(job.concrete_release)) ? "Released" : /^call/i.test(cl(job.concrete_release)) ? "Call to release" : cl(job.concrete_release),
      items: items.map((i: any) => ({ qty: i.qty, unit: /^each$/i.test(i.unit) ? "" : i.unit, code: i.code, name: i.name })),
      details: [...details, ["Slump", cl(job.concrete_slump) ? cl(job.concrete_slump) + " mm" : ""], ["Max quantity in colour", cl(job.concrete_colour_max)]] /* every question (11 Nov 2026) */, instructions: [cl(source.site_notes), cl(job.special_instructions)].filter(Boolean).join("\n"),
      contactName: cl(cl(source.site_contact).replace(/(\+?\d[\d\s]{7,}\d)/, "")) || cl(source.contact_name), contactPhone: ((cl(source.site_contact).match(/(\+?\d[\d\s]{7,}\d)/) || [])[1] || cl(source.contact)),
      reference: source.quote_no || "", replyTo: "orders@directbuildingmaterial.com.au" }) : poEmailHtml(d), ref_kind: "order", ref_id: String(source.order_id), customer: portal, status: "queued", created_by: who || "ordersteel-po" };
    let m = await direct.from("messages").insert(row).select("id").single();
    if (m.error && /html/.test(String(m.error.message || ""))) { delete row.html; m = await direct.from("messages").insert(row).select("id").single(); }   // before the html column is added
    if (m.data?.id) await fetch(env("SUPABASE_URL") + "/functions/v1/send-messages", { method: "POST",
      headers: { Authorization: "Bearer " + env("SUPABASE_SERVICE_ROLE_KEY"), "Content-Type": "application/json" }, body: JSON.stringify({ message_ids: [m.data.id] }) }).catch(() => {});
  } catch { /* the PO is sent either way */ }
  return res;
}
