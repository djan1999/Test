import { describe, expect, it } from "vitest";
import { foldFloorMaps, foldFloorStatus } from "../utils/foldSettingState.js";

const map = (id, name, tables) => ({
  id,
  name,
  kind: "dining",
  tables,
});

describe("shared floor-setting three-way folds", () => {
  it("preserves independent SET-marker changes from different devices", () => {
    const ancestor = { dining: { T1: "SET" } };
    const mine = { dining: { T1: "SET", T2: "SET" } };
    const server = {
      dining: { T1: "SET" },
      terrace: { T21: "SET" },
    };

    expect(foldFloorStatus(ancestor, mine, server).state).toEqual({
      dining: { T1: "SET", T2: "SET" },
      terrace: { T21: "SET" },
    });
  });

  it("keeps an independent remote marker while applying a local deletion", () => {
    const ancestor = { dining: { T1: "SET", T2: "SET" } };
    const mine = { dining: { T2: "SET" } };
    const server = {
      dining: { T1: "SET", T2: "SET" },
      terrace: { T21: "SET" },
    };

    expect(foldFloorStatus(ancestor, mine, server).state).toEqual({
      dining: { T2: "SET" },
      terrace: { T21: "SET" },
    });
  });

  it("combines edits made to different floor maps", () => {
    const ancestor = {
      geometryVersion: 1,
      activeDiningMapId: "inside",
      config: { snap: true },
      maps: [
        map("inside", "Inside", [{ id: "T1", x: 0 }]),
        map("terrace", "Terrace", [{ id: "T21", x: 0 }]),
      ],
    };
    const mine = {
      ...ancestor,
      geometryVersion: 2,
      maps: [
        map("inside", "Inside", [{ id: "T1", x: 20 }]),
        ancestor.maps[1],
      ],
    };
    const server = {
      ...ancestor,
      geometryVersion: 3,
      maps: [
        ancestor.maps[0],
        map("terrace", "Terrace", [{ id: "T21", x: 40 }]),
      ],
    };

    const result = foldFloorMaps(ancestor, mine, server);
    expect(result.conflicts).toEqual([]);
    expect(result.state.geometryVersion).toBe(3);
    expect(result.state.maps.find(({ id }) => id === "inside").tables[0].x).toBe(20);
    expect(result.state.maps.find(({ id }) => id === "terrace").tables[0].x).toBe(40);
  });

  it("preserves both designs when two admins edit the same map", () => {
    const ancestor = {
      activeDiningMapId: "inside",
      maps: [map("inside", "Inside", [{ id: "T1", x: 0 }])],
    };
    const mine = {
      ...ancestor,
      maps: [map("inside", "Inside", [{ id: "T1", x: 20 }])],
    };
    const server = {
      ...ancestor,
      maps: [map("inside", "Inside", [{ id: "T1", x: 40 }])],
    };

    const first = foldFloorMaps(ancestor, mine, server);
    const second = foldFloorMaps(ancestor, mine, server);
    const recovered = first.state.maps.find(({ id }) => id.startsWith("inside__recovered_"));

    expect(first.state.maps.find(({ id }) => id === "inside").tables[0].x).toBe(40);
    expect(recovered.tables[0].x).toBe(20);
    expect(recovered.name).toContain("RECOVERED COPY");
    expect(first.conflicts).toEqual([{
      type: "map",
      mapId: "inside",
      recoveredMapId: recovered.id,
    }]);
    expect(second.state).toEqual(first.state);
  });
});
