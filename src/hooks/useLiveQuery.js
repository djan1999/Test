import { useEffect, useRef, useSyncExternalStore } from "react";
import { getWorkspaceId, supabase } from "../lib/supabaseClient.js";
import { registerLiveQuery, subscribeLiveStatus, getLiveStatus } from "../lib/liveData.js";
import { isSandbox } from "../lib/sandbox.js";
import { readStateKey, pendingStateKeys } from "../lib/stateStore.js";

// Component readers default to the background lane (config, catalogues,
// archives); pass lane: "live" for data that changes during service.
export function useLiveQuery(key, read, apply, { enabled = !!supabase, tables = [], scope = supabase ? getWorkspaceId() : null, onError, lane = "background" } = {}) {
  const latest = useRef({ read, apply, onError });
  latest.current = { read, apply, onError };
  const tableKey = tables.join("|");
  useEffect(() => {
    if (!enabled || !scope) return;
    // Most re-reads return what is already painted. Skip adopting an identical
    // result: every adoption re-renders the app, and during service a dozen
    // unchanged settings re-rendering per tap slowed the kitchen display.
    let adopted;
    const query = registerLiveQuery({ key, scope, lane, tables: tableKey.split("|"),
      read: () => latest.current.read(),
      apply: async value => {
        if (getWorkspaceId() !== scope || isSandbox()) return false;
        let fingerprint = null;
        try { fingerprint = JSON.stringify(value); } catch { /* adopt uncomparable values */ }
        if (fingerprint != null && fingerprint === adopted) return true;
        const accepted = await latest.current.apply(value);
        adopted = accepted === false ? undefined : fingerprint;
        return accepted;
      },
      onError: error => latest.current.onError?.(error),
    });
    return () => query.dispose();
  }, [key, scope, enabled, tableKey, lane]);
}

export function useLiveSetting(key, apply, options = {}) {
  useLiveQuery(`setting:${key}`, () => readStateKey(key), value => {
    if (pendingStateKeys().includes(key)) return false;
    return apply(value);
  }, { ...options, tables: ["service_settings"] });
}

export function useLiveDataStatus(scope = supabase ? getWorkspaceId() : null) {
  const all = useSyncExternalStore(subscribeLiveStatus, getLiveStatus, getLiveStatus);
  const rows = all.filter(row => row.scope === scope);
  return {
    rows,
    errors: rows.filter(row => row.error != null),
    loading: rows.some(row => row.state === "loading"),
    held: rows.some(row => row.state === "held"),
  };
}

// The header chip needs two facts, not every reader's state. Subscribing the
// app root to the full list re-rendered it twice per read (loading → ready) —
// dozens of times per tap during service. This re-renders only when a fact
// flips. "loading" means a reader has not loaded yet; a routine re-read of
// data already on screen is not staleness.
export function useLiveDataSummary(scope = supabase ? getWorkspaceId() : null) {
  const summarize = () => {
    let errors = 0, loading = false;
    for (const row of getLiveStatus()) {
      if (row.scope !== scope) continue;
      if (row.error != null) errors += 1;
      if (row.state === "loading" && row.updatedAt == null) loading = true;
    }
    return `${errors}|${loading ? 1 : 0}`;
  };
  const [errors, loading] = useSyncExternalStore(subscribeLiveStatus, summarize, summarize).split("|");
  return { errors: Number(errors), loading: loading === "1" };
}
