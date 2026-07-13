import { blankTable } from "../utils/tableHelpers.js";
import {
  configuredTableIds,
  configuredTableLabel,
  makeDefaultRestaurantConfig,
  reconcileConfiguredTables,
  removedLiveTableIds,
  sanitizeRestaurantConfig,
} from "../config/restaurantConfig.js";

describe("restaurant configuration", () => {
  it("keeps Milka's current ten-table behavior as the default", () => {
    const config = makeDefaultRestaurantConfig();
    expect(configuredTableIds(config)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(configuredTableLabel(config, 1)).toBe("T01");
  });

  it("accepts sparse and custom table ids/labels", () => {
    const config = sanitizeRestaurantConfig({
      name: "MILKA",
      tables: [{ id: 2, label: "CHEF" }, { id: 12, label: "TERRACE 12" }],
    });
    expect(configuredTableIds(config)).toEqual([2, 12]);
    expect(configuredTableLabel(config, 12)).toBe("TERRACE 12");
  });

  it("drops invalid and duplicate configuration rows", () => {
    const config = sanitizeRestaurantConfig({ tables: [1, 1, 0, -2, 4, "bad"] });
    expect(configuredTableIds(config)).toEqual([1, 4]);
  });

  it("never hides a removed table that still contains live service work", () => {
    const live = { ...blankTable(10), active: true, arrivedAt: "19:00" };
    const config = sanitizeRestaurantConfig({ tables: [1, 2] });
    const next = reconcileConfiguredTables([blankTable(1), blankTable(2), live], config);
    expect(next.map((table) => table.id)).toEqual([1, 2, 10]);
    expect(removedLiveTableIds([live], config)).toEqual([10]);
  });

  it("removes a retired table once it is empty", () => {
    const config = sanitizeRestaurantConfig({ tables: [1, 2] });
    expect(reconcileConfiguredTables([blankTable(1), blankTable(2), blankTable(10)], config)
      .map((table) => table.id)).toEqual([1, 2]);
  });
});
