import { useEffect, useRef } from "react";

// Realtime table subscription that heals itself. A Supabase channel can quietly
// die when the device sleeps, the tab is backgrounded, or the network blips —
// and nothing rejoins it, so updates silently stop and the app limps along on
// its slow poll fallback. This hook:
//   • reports connection status via onStatus (drives the live/reconnecting UI),
//   • resubscribes with backoff on CHANNEL_ERROR / TIMED_OUT / CLOSED,
//   • forces a fresh resubscribe when the device wakes (visibility) or the
//     network returns (online) — but only if it isn't currently connected.
export function useRealtimeTable({
  supabase,
  channelName,
  table,
  onChange,
  enabled = true,
  filter,
  onStatus,
}) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  useEffect(() => {
    if (!enabled || !supabase || !channelName || !table) return;

    const binding = { event: "*", schema: "public", table };
    if (filter) binding.filter = filter;

    let channel = null;
    let retryTimer = null;
    let attempts = 0;
    let lastStatus = null;
    let cancelled = false;

    const teardown = () => {
      clearTimeout(retryTimer);
      if (channel) { try { supabase.removeChannel(channel); } catch { /* noop */ } channel = null; }
    };

    const subscribe = () => {
      if (cancelled) return;
      teardown();
      channel = supabase
        .channel(channelName)
        .on("postgres_changes", binding, (payload) => onChangeRef.current?.(payload))
        .subscribe((status) => {
          lastStatus = status;
          onStatusRef.current?.(status);
          if (status === "SUBSCRIBED") {
            attempts = 0;
            clearTimeout(retryTimer);
          } else if (
            status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED"
          ) {
            if (cancelled) return;
            clearTimeout(retryTimer);
            const delay = Math.min(1000 * 2 ** attempts, 15000);
            attempts += 1;
            retryTimer = setTimeout(subscribe, delay);
          }
        });
    };

    subscribe();

    // Wake / reconnect: only churn the channel if it isn't healthy.
    const resubscribeIfStale = () => {
      if (cancelled || lastStatus === "SUBSCRIBED") return;
      attempts = 0;
      subscribe();
    };
    const onVisible = () => { if (!document.hidden) resubscribeIfStale(); };
    window.addEventListener("online", resubscribeIfStale);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.removeEventListener("online", resubscribeIfStale);
      document.removeEventListener("visibilitychange", onVisible);
      teardown();
    };
  }, [supabase, channelName, table, enabled, filter]);
}
