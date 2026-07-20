import { describe, expect, it } from "vitest";
import { evaluateDeploymentIsolation } from "../config/deploymentEnvironment.js";

const safeStaging = {
  VITE_DEPLOYMENT_ENV: "staging",
  VITE_STAGING_ISOLATION_ACK: "MILKA_STAGING_ONLY",
  VITE_SUPABASE_URL: "https://staging-project.supabase.co",
  VITE_DISABLE_POWERSYNC: "true",
  VITE_RESERVATIONS_V2_ENABLED: "true",
};

describe("deployment isolation", () => {
  it("does not change existing production behavior", () => {
    expect(evaluateDeploymentIsolation({})).toMatchObject({ isStaging: false, safe: true });
  });

  it("accepts a staging backend with PowerSync explicitly disabled", () => {
    expect(evaluateDeploymentIsolation(safeStaging)).toMatchObject({
      isStaging: true,
      safe: true,
      reservationsV2Enabled: true,
    });
  });

  it("blocks the live Supabase project in staging", () => {
    const result = evaluateDeploymentIsolation({
      ...safeStaging,
      VITE_SUPABASE_URL: "https://cvljktjmksfibuyphdln.supabase.co",
    });
    expect(result.safe).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/live Supabase/i);
  });

  it("blocks the live PowerSync instance in staging", () => {
    const result = evaluateDeploymentIsolation({
      ...safeStaging,
      VITE_DISABLE_POWERSYNC: "false",
      VITE_POWERSYNC_URL: "https://6a2edf200ef84ed671a1a45e.powersync.journeyapps.com",
    });
    expect(result.safe).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/live PowerSync/i);
  });

  it("fails closed when staging variables are incomplete", () => {
    const result = evaluateDeploymentIsolation({ VITE_DEPLOYMENT_ENV: "staging" });
    expect(result.safe).toBe(false);
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
  });
});

