// portal-po: the previous portal's PO sender (ordersteel-po), brought across to Direct's new portal (13 Nov 2026).
// Deploy: npx supabase functions deploy portal-po --project-ref qnfuifckyfhiuvqyvkvf
// Secrets: ORDERSTEEL_URL / _SERVICE_ROLE_KEY, ORDERCONCRETE_URL / _SERVICE_ROLE_KEY, ORDERPODS_URL / _SERVICE_ROLE_KEY.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handle } from "./handler.ts";
Deno.serve((req) => handle(req, { env: (k) => Deno.env.get(k), createClient }));
