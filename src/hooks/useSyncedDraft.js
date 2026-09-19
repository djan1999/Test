import { useState } from "react";

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Forms follow remote values while clean. Keep a dirty form intact and require
// explicit reload when its baseline changes, rather than erasing either edit.
export function useSyncedDraft(remote) {
  const [state, setState] = useState(() => ({ base: remote, draft: remote, conflict: false }));
  if (!equal(state.base, remote)) {
    const clean = equal(state.draft, state.base) || equal(state.draft, remote);
    setState({ base: remote, draft: clean ? remote : state.draft,
      conflict: !clean || state.conflict && !equal(state.draft, remote) });
  }
  const edit = next => setState(prev => ({ ...prev,
    draft: typeof next === "function" ? next(prev.draft) : next,
  }));
  return [state.draft, edit, state.conflict,
    () => setState({ base: remote, draft: remote, conflict: false })];
}
