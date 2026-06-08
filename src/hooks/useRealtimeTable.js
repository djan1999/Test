import { useEffect, useRef } from "react";

export function useRealtimeTable({
  supabase,
  channelName,
  table,
  onChange,
  enabled = true,
  filter,
}) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!enabled || !supabase || !channelName || !table) return;

    // `filter` scopes the stream to a single workspace (e.g.
    // "workspace_id=eq.<id>") so a restaurant only receives its own changes.
    const binding = { event: "*", schema: "public", table };
    if (filter) binding.filter = filter;

    const channel = supabase
      .channel(channelName)
      .on("postgres_changes", binding, (payload) => {
        onChangeRef.current?.(payload);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, channelName, table, enabled, filter]);
}
