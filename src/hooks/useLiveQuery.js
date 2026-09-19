import { useEffect, useRef, useSyncExternalStore } from "react";
import { getWorkspaceId, supabase } from "../lib/supabaseClient.js";
import { registerLiveQuery, subscribeLiveStatus, getLiveStatus } from "../lib/liveData.js";
import { isSandbox } from "../lib/sandbox.js";
import { readStateKey, pendingStateKeys } from "../lib/stateStore.js";

export function useLiveQuery(key, read, apply, { enabled = !!supabase, tables = [], scope = supabase ? getWorkspaceId() : null, onError } = {}) {
  const latest = useRef({ read, apply, onError });
  latest.current = { read, apply, onError };
  const tableKey = tables.join("|");
  useEffect(() => {
    if (!enabled || !scope) return;
    const query = registerLiveQuery({ key, scope, tables: tableKey.split("|"),
      read: () => latest.current.read(),
      apply: value => {
        if (getWorkspaceId() !== scope || isSandbox()) return false;
        return latest.current.apply(value);
      },
      onError: error => latest.current.onError?.(error),
    });
    return () => query.dispose();
  }, [key, scope, enabled, tableKey]);
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
