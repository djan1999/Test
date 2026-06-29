// PowerSync ↔ Supabase backend connector (READ-ONLY pilot variant).
//
// Two responsibilities in the PowerSync model:
//   1. fetchCredentials() — hand PowerSync the instance URL + a valid Supabase
//      access token so it can authenticate the sync stream. We reuse the app's
//      existing supabase client (src/lib/supabaseClient.js) so the token, the
//      "remember me" storage adapter, and silent refresh are all shared — no
//      second auth surface.
//   2. uploadData() — drains the local SQLite write queue back to the backend.
//
// PILOT POLICY — READ-ONLY: during the pilot the app still performs every WRITE
// through the existing scopedFrom()/supabase-js path exactly as today; the local
// SQLite DB is used for fast READS only. So no local CRUD is expected here. To
// make that guarantee airtight we ACKNOWLEDGE (complete) any stray local op
// WITHOUT pushing it upstream — the pilot physically cannot write to Postgres,
// which removes all composite-PK / cross-workspace write-back risk. Proper
// workspace-scoped write-back lands in a later step once reads are validated.

import { supabase } from "../lib/supabaseClient.js";
import { POWERSYNC_URL } from "./config.js";

export class SupabaseConnector {
  async fetchCredentials() {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data?.session) {
      // No session → return null so PowerSync waits and retries after login,
      // instead of connecting unauthenticated.
      return null;
    }
    return {
      endpoint: POWERSYNC_URL,
      token: data.session.access_token,
    };
  }

  async uploadData(database) {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;
    // READ-ONLY pilot: discard local ops without uploading. In normal pilot
    // operation this never runs (the app doesn't write to local SQLite yet).
    if (transaction.crud.length > 0) {
      console.warn(
        `[PowerSync] read-only pilot: acknowledging ${transaction.crud.length} local op(s) without upload`,
      );
    }
    await transaction.complete();
  }
}
