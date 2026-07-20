const LIVE_SUPABASE_PROJECT_REF = "cvljktjmksfibuyphdln";
const LIVE_POWERSYNC_HOST = "6a2edf200ef84ed671a1a45e.powersync.journeyapps.com";
const STAGING_ACK = "MILKA_STAGING_ONLY";

function projectRefFromUrl(value) {
  try {
    const host = new URL(String(value || "")).hostname;
    return host.endsWith(".supabase.co") ? host.split(".")[0] : "";
  } catch {
    return "";
  }
}

function hostFromUrl(value) {
  try {
    return new URL(String(value || "")).hostname;
  } catch {
    return "";
  }
}

export function evaluateDeploymentIsolation(env = {}) {
  const environment = String(env.VITE_DEPLOYMENT_ENV || "production").trim().toLowerCase();
  const isStaging = environment === "staging";
  if (!isStaging) return { isStaging: false, safe: true, reasons: [] };

  const reasons = [];
  const supabaseRef = projectRefFromUrl(env.VITE_SUPABASE_URL);
  const powerSyncDisabled = String(env.VITE_DISABLE_POWERSYNC || "").toLowerCase() === "true";
  const powerSyncHost = hostFromUrl(env.VITE_POWERSYNC_URL);

  if (env.VITE_STAGING_ISOLATION_ACK !== STAGING_ACK) {
    reasons.push("The staging isolation acknowledgement is missing.");
  }
  if (!supabaseRef) {
    reasons.push("A staging Supabase URL is required.");
  } else if (supabaseRef === LIVE_SUPABASE_PROJECT_REF) {
    reasons.push("The staging build is pointing at the live Supabase project.");
  }
  if (!powerSyncDisabled) {
    if (!powerSyncHost) {
      reasons.push("PowerSync must be explicitly disabled or configured for staging.");
    } else if (powerSyncHost === LIVE_POWERSYNC_HOST) {
      reasons.push("The staging build is pointing at the live PowerSync instance.");
    }
  }

  return {
    environment,
    isStaging: true,
    safe: reasons.length === 0,
    reasons,
    reservationsV2Enabled: String(env.VITE_RESERVATIONS_V2_ENABLED || "").toLowerCase() === "true",
  };
}

export const deploymentIsolation = evaluateDeploymentIsolation(import.meta.env);

