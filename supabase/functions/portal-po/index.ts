// portal-po: the previous portal's PO sender (ordersteel-po), brought across to Direct's new portal (13 Nov 2026).
// Deploy: npx supabase functions deploy portal-po --project-ref qnfuifckyfhiuvqyvkvf
// Secrets: ORDERSTEEL_URL / _SERVICE_ROLE_KEY, ORDERCONCRETE_URL / _SERVICE_ROLE_KEY, ORDERPODS_URL / _SERVICE_ROLE_KEY.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handle } from "./handler.ts";
/* DBM's portals are written to by INSERT only (13 Nov 2026): a new order and its own rows. A client for another project
   refuses any update, and any upsert that could overwrite (only "insert, else leave the existing row as it is" passes).
   Deleting is left for the one case the sender uses it: taking back the rows it has just added when a send fails part
   way, by the new order's own id. */
function insertOnly(client: any) {
  const guardTable = (q: any, table: string) => new Proxy(q, { get(t, k) {
    if (k === "update") return () => { throw new Error("Not allowed: updating " + table + " in a DBM portal (new rows only)"); };
    if (k === "upsert") return (rows: unknown, opts: any) => { if (!opts || opts.ignoreDuplicates !== true) throw new Error("Not allowed: overwriting " + table + " in a DBM portal (new rows only)"); return t.upsert(rows, opts); };
    const v = t[k]; return typeof v === "function" ? v.bind(t) : v; } });
  return new Proxy(client, { get(t, k) {
    if (k === "from") return (table: string) => guardTable(t.from(table), table);
    const v = t[k]; return typeof v === "function" ? v.bind(t) : v; } });
}
const own = (Deno.env.get("SUPABASE_URL") ?? "").trim();
Deno.serve((req) => handle(req, { env: (k) => Deno.env.get(k), createClient: (url: string, key: string, opts?: any) => {
  const c = createClient(url, key, opts);
  return String(url).trim() === own ? c : insertOnly(c);   /* Direct's own database as usual; DBM's portals insert only */
} }));
