import { useEffect, useRef } from "react";

// Realtime table subscription that heals itself. A Supabase channel can quietly
// die when the device sleeps, the tab is backgrounded, or the network blips —
// and nothing rejoins it, so updates silently stop and the app limps along on
// its slow poll fallback. This hook:
//   • reports connection status via onStatus (drives the live/reconnecting UI),
//   • resubscribes with backoff on CHANNEL_ERROR / TIMED_OUT / CLOSED,
//   • forces a genuinely FRESH channel when the device wakes (visibility) or
//     the network returns (online). The old "skip if lastStatus is SUBSCRIBED"
//     gate was the falsely-connected bug: when Android suspends the process
//     the socket dies WITHOUT a status callback, so the last recorded status
//     stays SUBSCRIBED forever and the wake handler did nothing — the device
//     showed live while receiving nothing until the 60s poll noticed.
//   • debounces duplicate wake signals (online + visibilitychange fire
//     together on wake) so one wake builds one channel, not two,
//   • ignores callbacks from removed channels — a late CLOSED from the torn-
//     down channel must not schedule a retry loop that fights the healthy
//     replacement,
//   • fires onResubscribe after every re-join (not the first). Realtime events
//     are NOT a durable log: anything sent while the socket was dead is gone,
//     so the consumer must do an authoritative catch-up read there —
//     including reconciling deletions, not just appending rows.
export function useRealtimeTable({
  supabase,
  channelName,
  table,
  onChange,
  enabled = true,
  filter,
  onStatus,
  onResubscribe,
}) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const onResubscribeRef = useRef(onResubscribe);
  onResubscribeRef.current = onResubscribe;

  useEffect(() => {
    if (!enabled || !supabase || !channelName || !table) return;

    const binding = { event: "*", schema: "public", table };
    if (filter) binding.filter = filter;

    let channel = null;
    let retryTimer = null;
    let wakeTimer = null;
    let attempts = 0;
    let cancelled = false;
    let everSubscribed = false;

    const teardown = () => {
      clearTimeout(retryTimer);
      if (channel) { try { supabase.removeChannel(channel); } catch { /* noop */ } channel = null; }
    };

    const subscribe = () => {
      if (cancelled) return;
      teardown();
      const mine = supabase
        .channel(channelName)
        .on("postgres_changes", binding, (payload) => {
          if (!cancelled && mine === channel) onChangeRef.current?.(payload);
        });
      channel = mine;
      mine.subscribe((status) => {
        // A callback from a channel we already replaced must not touch the
        // replacement's state (schedule retries, flip the status UI, …).
        if (cancelled || mine !== channel) return;
        onStatusRef.current?.(status);
        if (status === "SUBSCRIBED") {
          attempts = 0;
          clearTimeout(retryTimer);
          // Any join after the first happened because the previous socket
          // died — reconcile what the dead socket missed.
          if (everSubscribed) onResubscribeRef.current?.();
          everSubscribed = true;
        } else if (
          status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED"
        ) {
          clearTimeout(retryTimer);
          const delay = Math.min(1000 * 2 ** attempts, 15000);
          attempts += 1;
          retryTimer = setTimeout(subscribe, delay);
        }
      });
    };

    subscribe();

    // Wake / reconnect: ALWAYS rebuild — the socket may be dead while the
    // last recorded status still says SUBSCRIBED (no callback fires when the
    // OS suspends the process). Debounced: online + visibilitychange arrive
    // together on wake and must produce ONE fresh channel.
    const forceRejoin = () => {
      if (cancelled) return;
      clearTimeout(wakeTimer);
      wakeTimer = setTimeout(() => {
        if (cancelled) return;
        attempts = 0;
        subscribe();
      }, 250);
    };
    const onVisible = () => { if (!document.hidden) forceRejoin(); };
    window.addEventListener("online", forceRejoin);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearTimeout(wakeTimer);
      window.removeEventListener("online", forceRejoin);
      document.removeEventListener("visibilitychange", onVisible);
      teardown();
    };
  }, [supabase, channelName, table, enabled, filter]);
}
