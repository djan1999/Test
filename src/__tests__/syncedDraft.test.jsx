import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { mergeListDraft, useSyncedList } from "../hooks/useSyncedList.js";
import { useSyncedDraft } from "../hooks/useSyncedDraft.js";

describe("live editors", () => {
  const base = [{ id: "a", name: "Wine", notes: "old" }];
  it("adopts fresh lists, including deletions, while an editor is clean", () => {
    const { result, rerender } = renderHook(({ rows }) => useSyncedList(rows), { initialProps: { rows: base } });
    rerender({ rows: [] }); expect(result.current[0]).toEqual([]);
  });
  it("merges unrelated fields and newly added remote items into an unfinished draft", () => {
    const remote = [{ ...base[0], notes: "new notes" }, { id: "b", name: "Tea" }];
    const { rows, conflict } = mergeListDraft(base, [{ ...base[0], name: "My name" }], remote);
    expect(rows).toEqual([{ id: "a", name: "My name", notes: "new notes" }, remote[1]]);
    expect(conflict).toBe(false);
  });
  it("detects conflicting edits and edit-versus-delete without losing the local draft", () => {
    const local = [{ ...base[0], name: "Local" }];
    expect(mergeListDraft(base, local, [{ ...base[0], name: "Remote" }])).toEqual({ rows: local, conflict: true });
    expect(mergeListDraft(base, local, [])).toEqual({ rows: local, conflict: true });
  });
  it("protects settings forms until an explicit reload", () => {
    const { result, rerender } = renderHook(({ value }) => useSyncedDraft(value), { initialProps: { value: { title: "before" } } });
    act(() => result.current[1]({ title: "draft" }));
    rerender({ value: { title: "remote" } });
    expect(result.current[0]).toEqual({ title: "draft" }); expect(result.current[2]).toBe(true);
    act(() => result.current[3]()); expect(result.current[0]).toEqual({ title: "remote" }); expect(result.current[2]).toBe(false);
  });
  it("recognizes a successful save echoed by the remote source as clean", () => {
    const { result, rerender } = renderHook(({ value }) => useSyncedDraft(value), { initialProps: { value: "before" } });
    act(() => result.current[1]("saved")); rerender({ value: "saved" }); rerender({ value: "newer" });
    expect(result.current[0]).toBe("newer"); expect(result.current[2]).toBe(false);
  });
});
