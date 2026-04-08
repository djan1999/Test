import { useEffect, useRef } from "react";

export function useRealtimeTable({
  supabase,
  channelName,
  table,
  onChange,
  enabled = true,
}) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!enabled || !supabase || !channelName || !table) return;

    const channel = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table }, (payload) => {
        onChangeRef.current?.(payload);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, channelName, table, enabled]);
}
