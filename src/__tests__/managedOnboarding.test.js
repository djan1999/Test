import { describe, expect, it } from "vitest";
import {
  defaultOnboardingTables,
  normalizeManagedRestaurantPayload,
  parsePlatformOperatorIds,
  slugifyRestaurantName,
} from "../../shared/managedOnboarding.js";

describe("managed restaurant onboarding input", () => {
  it("creates a stable URL slug without accents or punctuation", () => {
    expect(slugifyRestaurantName(" Gostilna Špica & Bar ")).toBe("gostilna-spica-bar");
  });

  it("normalizes a complete restaurant without importing live data", () => {
    const result = normalizeManagedRestaurantPayload({
      name: "  Nova Hiša  ",
      adminEmail: " OWNER@EXAMPLE.COM ",
      timezone: "Europe/Ljubljana",
      tables: [{ id: 2, label: " Terrace " }, { id: 1, label: " Main " }],
    });
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({
      name: "Nova Hiša",
      slug: "nova-hisa",
      adminEmail: "owner@example.com",
      keepOperatorAdmin: true,
      tables: [{ id: 1, label: "Main" }, { id: 2, label: "Terrace" }],
    });
    expect(result.value).not.toHaveProperty("reservations");
    expect(result.value).not.toHaveProperty("menu");
  });

  it("rejects duplicate table ids, malformed email, slug, and timezone", () => {
    const result = normalizeManagedRestaurantPayload({
      name: "Restaurant",
      slug: "Not Valid",
      adminEmail: "not-an-email",
      timezone: "Mars/Olympus",
      tables: [{ id: 1, label: "A" }, { id: 1, label: "B" }],
    });
    expect(result.ok).toBe(false);
    expect(Object.keys(result.errors)).toEqual(expect.arrayContaining(["slug", "adminEmail", "timezone", "tables"]));
  });

  it("generates table ids and labels within the product limit", () => {
    expect(defaultOnboardingTables(3)).toEqual([
      { id: 1, label: "T01" },
      { id: 2, label: "T02" },
      { id: 3, label: "T03" },
    ]);
    expect(defaultOnboardingTables(100)).toHaveLength(60);
  });

  it("accepts only UUIDs in the server-side platform allowlist", () => {
    const ids = parsePlatformOperatorIds(
      "11111111-1111-4111-8111-111111111111, not-an-id, 22222222-2222-4222-8222-222222222222",
    );
    expect([...ids]).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
  });
});
