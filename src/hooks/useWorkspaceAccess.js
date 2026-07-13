import { useCallback, useEffect, useRef, useState } from "react";
import {
  TABLES,
  supabase,
  setWorkspaceId as setScopedWorkspaceId,
} from "../lib/supabaseClient.js";
import { normalizeWorkspaceRole } from "../auth/roles.js";
import { useRealtimeTable } from "./useRealtimeTable.js";

const WORKSPACE_KEY = "milka_workspace";
const WORKSPACE_MEMBERS_TABLE = TABLES.WORKSPACE_MEMBERS || "workspace_members";

export function readPersistedWorkspace() {
  try { return localStorage.getItem(WORKSPACE_KEY) || null; } catch { return null; }
}

// Seed the module-level query scope before the first React effect. This keeps
// boot-time cache/database reads in the restaurant chosen on the prior launch.
if (supabase) setScopedWorkspaceId(readPersistedWorkspace());

async function withRetry(fn, attempts = 4, baseMs = 600) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await fn(); } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, baseMs * (attempt + 1)));
    }
  }
  throw lastError;
}

/**
 * Owns login, password-link state, workspace selection and the signed-in
 * person's role. Operational App state stays outside this hook.
 */
export function useWorkspaceAccess({ onWorkspaceApply } = {}) {
  const onWorkspaceApplyRef = useRef(onWorkspaceApply);
  onWorkspaceApplyRef.current = onWorkspaceApply;

  const [session, setSession] = useState(null);
  const [sessionChecked, setSessionChecked] = useState(!supabase);
  const [passwordRecovery, setPasswordRecovery] = useState(() => {
    try { return new URLSearchParams(window.location.search).get("set-password") === "1"; }
    catch { return false; }
  });
  const [workspaceId, setWorkspaceId] = useState(() => (supabase ? readPersistedWorkspace() : null));
  const [workspaces, setWorkspaces] = useState([]);
  const [workspacesResolved, setWorkspacesResolved] = useState(false);

  const applyWorkspace = useCallback((id) => {
    const nextId = id || null;
    setScopedWorkspaceId(nextId);
    setWorkspaceId(nextId);
    onWorkspaceApplyRef.current?.(nextId);
    try {
      if (nextId) localStorage.setItem(WORKSPACE_KEY, nextId);
      else localStorage.removeItem(WORKSPACE_KEY);
    } catch { /* storage is an optimization; React state remains authoritative */ }
  }, []);

  const openProfilePicker = useCallback(() => {
    try { localStorage.removeItem(WORKSPACE_KEY); } catch {}
    window.location.reload();
  }, []);

  const signOut = useCallback(async () => {
    try { await supabase?.auth.signOut({ scope: "local" }); } catch {}
    try { localStorage.removeItem(WORKSPACE_KEY); } catch {}
    setScopedWorkspaceId(null);
    window.location.reload();
  }, []);

  const completePasswordSetup = useCallback(() => {
    setPasswordRecovery(false);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("set-password");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    } catch { /* password is saved even if cosmetic URL cleanup is unavailable */ }
  }, []);

  useEffect(() => {
    if (!supabase) { setSessionChecked(true); return undefined; }
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data?.session || null);
      setSessionChecked(true);
    });
    const { data: subscriptionData } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      setSession(nextSession || null);
      if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
    });
    return () => {
      active = false;
      subscriptionData?.subscription?.unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !session?.user?.id) {
      setWorkspaces([]);
      setWorkspacesResolved(false);
      return undefined;
    }
    let active = true;
    setWorkspacesResolved(false);
    (async () => {
      try {
        const [workspaceResult, membershipResult] = await Promise.all([
          withRetry(async () => {
            const result = await supabase.from("workspaces").select("id, name, kind, slug")
              .order("kind", { ascending: true }).order("name", { ascending: true });
            if (result.error) throw result.error;
            return result;
          }),
          withRetry(async () => {
            // Admins may read every member in their restaurant. Filtering by
            // the current user is therefore security-critical; otherwise the
            // final row could overwrite the Admin's role in the map below.
            const result = await supabase.from(WORKSPACE_MEMBERS_TABLE)
              .select("workspace_id, role")
              .eq("user_id", session.user.id);
            if (result.error) throw result.error;
            return result;
          }),
        ]);
        if (!active) return;
        const roleByWorkspace = new Map(
          (membershipResult.data || []).map((row) => [row.workspace_id, normalizeWorkspaceRole(row.role)]),
        );
        const list = (workspaceResult.data || []).map((workspace) => ({
          ...workspace,
          role: roleByWorkspace.get(workspace.id) || null,
        }));
        setWorkspaces(list);
        const persisted = readPersistedWorkspace();
        if (persisted && list.some((workspace) => workspace.id === persisted)) applyWorkspace(persisted);
        else if (list.length === 1) applyWorkspace(list[0].id);
        else applyWorkspace(null);
      } catch (error) {
        if (active) console.warn("Workspace resolution failed:", error);
      } finally {
        if (active) setWorkspacesResolved(true);
      }
    })();
    return () => { active = false; };
  }, [session?.user?.id, applyWorkspace]);

  const refreshOwnMembership = useCallback(async () => {
    if (!supabase || !workspaceId || !session?.user?.id) return;
    const { data, error } = await supabase
      .from(WORKSPACE_MEMBERS_TABLE)
      .select("workspace_id, role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (error) return;
    if (!data) {
      openProfilePicker();
      return;
    }
    const nextRole = normalizeWorkspaceRole(data.role);
    setWorkspaces((previous) => previous.map((workspace) => (
      workspace.id === workspaceId ? { ...workspace, role: nextRole } : workspace
    )));
  }, [workspaceId, session?.user?.id, openProfilePicker]);

  useRealtimeTable({
    supabase,
    channelName: `milka-membership-${workspaceId}`,
    filter: workspaceId ? `workspace_id=eq.${workspaceId}` : undefined,
    table: WORKSPACE_MEMBERS_TABLE,
    onChange: (payload) => {
      const changedUserId = payload.new?.user_id || payload.old?.user_id;
      if (!changedUserId || changedUserId === session?.user?.id) refreshOwnMembership();
    },
    onResubscribe: refreshOwnMembership,
    enabled: Boolean(supabase && workspaceId && session?.user?.id),
  });

  const currentWorkspace = workspaces.find((workspace) => workspace.id === workspaceId) || null;

  return {
    session,
    sessionChecked,
    passwordRecovery,
    completePasswordSetup,
    workspaceId,
    workspaces,
    workspacesResolved,
    currentWorkspace,
    applyWorkspace,
    openProfilePicker,
    signOut,
    refreshOwnMembership,
  };
}
