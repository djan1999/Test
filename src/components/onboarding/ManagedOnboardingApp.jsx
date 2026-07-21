import { useEffect, useMemo, useState } from "react";
import { supabase, hasSupabaseConfig } from "../../lib/supabaseClient.js";
import { requestManagedRestaurants } from "../../lib/managedOnboarding.js";
import {
  defaultOnboardingTables,
  MAX_ONBOARDING_TABLES,
  normalizeManagedRestaurantPayload,
  slugifyRestaurantName,
} from "../../../shared/managedOnboarding.js";
import { tokens } from "../../styles/tokens.js";
import "./ManagedOnboardingApp.css";

const initialTimezone = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Ljubljana"; }
  catch { return "Europe/Ljubljana"; }
})();

function emptyForm(adminEmail = "") {
  return {
    name: "",
    slug: "",
    subtitle: "SERVICE BOARD",
    adminEmail,
    timezone: initialTimezone,
    keepOperatorAdmin: true,
    tables: defaultOnboardingTables(10),
  };
}

function FieldError({ children }) {
  return children ? <span className="mo-field-error">{children}</span> : null;
}

function resizeTables(current, count) {
  const safeCount = Math.min(MAX_ONBOARDING_TABLES, Math.max(1, Number(count) || 1));
  const defaults = defaultOnboardingTables(safeCount);
  return Array.from({ length: safeCount }, (_, index) => (
    current[index] || defaults[index]
  ));
}

export function ManagedOnboardingApp() {
  const [gate, setGate] = useState({ status: "loading", message: "Checking platform access…" });
  const [accessToken, setAccessToken] = useState(null);
  const [operator, setOperator] = useState(null);
  const [canManageOthers, setCanManageOthers] = useState(false);
  const [restaurants, setRestaurants] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [slugEdited, setSlugEdited] = useState(false);
  const [errors, setErrors] = useState({});
  const [step, setStep] = useState("setup");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (!hasSupabaseConfig || !supabase) {
          if (active) setGate({ status: "error", message: "Supabase is not configured for this build." });
          return;
        }
        const { data, error } = await supabase.auth.getSession();
        if (!active) return;
        const token = data?.session?.access_token;
        if (error || !token) {
          setGate({ status: "signed-out", message: "Sign into the main app with your platform account first." });
          return;
        }
        setAccessToken(token);
        const response = await requestManagedRestaurants({ accessToken: token });
        if (!active) return;
        const creator = response.creator || response.operator || null;
        setOperator(creator);
        setCanManageOthers(response.canManageOtherRestaurants === true);
        setForm((current) => ({
          ...current,
          adminEmail: current.adminEmail || creator?.email || "",
          keepOperatorAdmin: true,
        }));
        setRestaurants(response.restaurants || []);
        setGate({ status: "ready", message: "Account confirmed." });
      } catch (requestError) {
        if (!active) return;
        setGate({ status: "error", message: requestError.message });
      }
    })();
    return () => { active = false; };
  }, []);

  const normalized = useMemo(() => normalizeManagedRestaurantPayload(form), [form]);
  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const updateName = (name) => {
    setForm((current) => ({
      ...current,
      name,
      ...(!slugEdited ? { slug: slugifyRestaurantName(name) } : {}),
    }));
    setErrors((current) => ({ ...current, name: undefined, slug: undefined }));
  };

  const updateTable = (index, patch) => {
    setForm((current) => ({
      ...current,
      tables: current.tables.map((table, tableIndex) => (
        tableIndex === index ? { ...table, ...patch } : table
      )),
    }));
    setErrors((current) => ({ ...current, tables: undefined }));
  };

  const openReview = () => {
    const next = normalizeManagedRestaurantPayload(form);
    if (!next.ok) {
      setErrors(next.errors);
      setSubmitError("Please fix the highlighted fields before review.");
      return;
    }
    setForm(next.value);
    setErrors({});
    setSubmitError("");
    setStep("review");
    window.scrollTo?.({ top: 0, behavior: "smooth" });
  };

  const createRestaurant = async () => {
    if (!accessToken || submitting || !normalized.ok) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const response = await requestManagedRestaurants({
        accessToken,
        method: "POST",
        payload: normalized.value,
      });
      setResult(response);
      setRestaurants((current) => [response.restaurant, ...current]);
      setStep("success");
    } catch (error) {
      setErrors(error.fields || {});
      setSubmitError(error.message);
      if (Object.keys(error.fields || {}).length) setStep("setup");
    } finally {
      setSubmitting(false);
    }
  };

  const startAnother = () => {
    setForm(emptyForm(operator?.email || ""));
    setSlugEdited(false);
    setErrors({});
    setResult(null);
    setSubmitError("");
    setStep("setup");
  };

  const palette = {
    "--mo-bg": tokens.ink.bg,
    "--mo-card": tokens.neutral[0],
    "--mo-ink": tokens.ink[0],
    "--mo-text": tokens.ink[2],
    "--mo-muted": tokens.ink[3],
    "--mo-rule": tokens.ink[4],
    "--mo-soft": tokens.ink[5],
    "--mo-success": tokens.green.text,
    "--mo-success-bg": tokens.green.bg,
    "--mo-danger": tokens.red.text,
    "--mo-danger-bg": tokens.red.bg,
    fontFamily: tokens.font,
  };

  if (gate.status !== "ready") {
    return (
      <main className="mo-shell mo-gate" style={palette}>
        <section className="mo-gate-card" aria-live="polite">
          <p className="mo-kicker">MANAGED ONBOARDING</p>
          <h1>Restaurant setup</h1>
          <p>{gate.message}</p>
          {gate.status === "loading" && <div className="mo-progress" aria-label="Checking access" />}
          {gate.status !== "loading" && <a className="mo-link-button" href="/">Open main app</a>}
        </section>
      </main>
    );
  }

  return (
    <main className="mo-shell" style={palette}>
      <header className="mo-header">
        <div>
          <p className="mo-kicker">RESTAURANT ONBOARDING</p>
          <h1>Create a restaurant</h1>
          <p className="mo-lead">Create an isolated work environment and link your account as its first Admin.</p>
        </div>
        <div className="mo-operator">
          <span>{canManageOthers ? "PLATFORM ACCOUNT" : "YOUR ACCOUNT"}</span>
          <strong>{operator?.email || operator?.id}</strong>
          <a href="/">Main app →</a>
        </div>
      </header>

      <div className="mo-layout">
        <section className="mo-card">
          <nav className="mo-steps" aria-label="Onboarding progress">
            <span data-active={step === "setup"}>01 SETUP</span>
            <span data-active={step === "review"}>02 REVIEW</span>
            <span data-active={step === "success"}>03 COMPLETE</span>
          </nav>

          {submitError && <div className="mo-alert" role="alert">{submitError}</div>}

          {step === "setup" && (
            <form onSubmit={(event) => { event.preventDefault(); openReview(); }} noValidate>
              <fieldset>
                <legend>Restaurant identity</legend>
                <div className="mo-grid-two">
                  <label>
                    <span>Restaurant name</span>
                    <input value={form.name} onChange={(event) => updateName(event.target.value)} autoFocus />
                    <FieldError>{errors.name}</FieldError>
                  </label>
                  <label>
                    <span>Unique restaurant key</span>
                    <div className="mo-slug-input">
                      <input
                        value={form.slug}
                        onChange={(event) => {
                          setSlugEdited(true);
                          updateField("slug", event.target.value.toLowerCase());
                        }}
                        spellCheck="false"
                      />
                    </div>
                    <FieldError>{errors.slug}</FieldError>
                  </label>
                  <label>
                    <span>Board subtitle</span>
                    <input value={form.subtitle} onChange={(event) => updateField("subtitle", event.target.value)} />
                  </label>
                  <label>
                    <span>Timezone</span>
                    <input
                      value={form.timezone}
                      onChange={(event) => updateField("timezone", event.target.value)}
                      list="mo-timezones"
                      spellCheck="false"
                    />
                    <datalist id="mo-timezones">
                      <option value="Europe/Ljubljana" />
                      <option value="Europe/Zagreb" />
                      <option value="Europe/Budapest" />
                      <option value="Europe/Vienna" />
                      <option value="Europe/London" />
                      <option value="America/New_York" />
                    </datalist>
                    <small>Stored per restaurant. The current live app keeps its existing sitting-time defaults.</small>
                    <FieldError>{errors.timezone}</FieldError>
                  </label>
                </div>
              </fieldset>

              <fieldset>
                <legend>First Admin</legend>
                {canManageOthers ? (
                  <>
                    <label>
                      <span>Admin email</span>
                      <input
                        type="email"
                        value={form.adminEmail}
                        onChange={(event) => updateField("adminEmail", event.target.value)}
                        autoComplete="email"
                      />
                      <small>Use your own email, link an existing user, or send a secure invitation to a new owner.</small>
                      <FieldError>{errors.adminEmail}</FieldError>
                    </label>
                    <label className="mo-check">
                      <input
                        type="checkbox"
                        checked={form.keepOperatorAdmin}
                        onChange={(event) => updateField("keepOperatorAdmin", event.target.checked)}
                      />
                      <span>
                        <strong>Add my platform account as an Admin too</strong>
                        <small>This is an explicit, visible membership—not a hidden tenant bypass.</small>
                      </span>
                    </label>
                  </>
                ) : (
                  <div className="mo-review-warning">
                    <strong>{form.adminEmail}</strong>
                    <span>Your signed-in account will be linked to this restaurant with the Admin role.</span>
                    <FieldError>{errors.adminEmail}</FieldError>
                  </div>
                )}
              </fieldset>

              <fieldset>
                <legend>Service tables</legend>
                <label className="mo-count">
                  <span>COUNT</span>
                  <input
                    type="number"
                    min="1"
                    max={MAX_ONBOARDING_TABLES}
                    value={form.tables.length}
                    onChange={(event) => setForm((current) => ({
                      ...current,
                      tables: resizeTables(current.tables, event.target.value),
                    }))}
                  />
                </label>
                <div className="mo-table-grid">
                  {form.tables.map((table, index) => (
                    <div className="mo-table-row" key={index}>
                      <label>
                        <span>ID</span>
                        <input
                          type="number"
                          min="1"
                          max="999"
                          value={table.id}
                          onChange={(event) => updateTable(index, { id: event.target.value })}
                        />
                      </label>
                      <label>
                        <span>LABEL</span>
                        <input value={table.label} onChange={(event) => updateTable(index, { label: event.target.value })} />
                      </label>
                    </div>
                  ))}
                </div>
                <FieldError>{errors.tables}</FieldError>
              </fieldset>

              <div className="mo-actions">
                <a className="mo-secondary" href="/">Cancel</a>
                <button className="mo-primary" type="submit">Review setup →</button>
              </div>
            </form>
          )}

          {step === "review" && (
            <div>
              <div className="mo-review-warning">
                <strong>Nothing live is copied or changed.</strong>
                <span>This creates a new empty tenant. If any database step fails, all database steps roll back.</span>
              </div>
              <dl className="mo-review-list">
                <div><dt>Restaurant</dt><dd>{normalized.value.name}</dd></div>
                <div><dt>Restaurant key</dt><dd>{normalized.value.slug}</dd></div>
                <div><dt>First Admin</dt><dd>{normalized.value.adminEmail}</dd></div>
                <div><dt>Timezone</dt><dd>{normalized.value.timezone}</dd></div>
                <div><dt>Tables</dt><dd>{normalized.value.tables.length}</dd></div>
                <div>
                  <dt>{canManageOthers ? "Platform access" : "Account link"}</dt>
                  <dd>{canManageOthers
                    ? (normalized.value.keepOperatorAdmin ? "Additional Admin membership" : "No additional membership")
                    : "Your account becomes Admin"}</dd>
                </div>
              </dl>
              <div className="mo-table-summary">
                {normalized.value.tables.map((table) => <span key={table.id}>{table.id} · {table.label}</span>)}
              </div>
              <div className="mo-actions">
                <button className="mo-secondary" type="button" onClick={() => setStep("setup")} disabled={submitting}>← Edit setup</button>
                <button className="mo-primary" type="button" onClick={createRestaurant} disabled={submitting}>
                  {submitting ? "Creating safely…" : "Create restaurant"}
                </button>
              </div>
            </div>
          )}

          {step === "success" && (
            <div className="mo-success" aria-live="polite">
              <span className="mo-success-mark">✓</span>
              <p className="mo-kicker">RESTAURANT CREATED</p>
              <h2>{result?.restaurant?.name}</h2>
              <p>
                {result?.mode === "self-service"
                  ? `${form.adminEmail} is now linked as the restaurant Admin.`
                  : result?.invited
                  ? `A secure Admin invitation was sent to ${form.adminEmail}.`
                  : `${form.adminEmail} was linked as the first Admin.`}
              </p>
              <dl className="mo-result-details">
                <div><dt>Workspace ID</dt><dd>{result?.restaurant?.id}</dd></div>
                <div><dt>Slug</dt><dd>{result?.restaurant?.slug}</dd></div>
                <div><dt>Tables</dt><dd>{result?.restaurant?.tableCount ?? form.tables.length}</dd></div>
              </dl>
              <div className="mo-actions mo-actions-center">
                <a className="mo-secondary" href="/">Open main app</a>
                <button className="mo-primary" type="button" onClick={startAnother}>Create another</button>
              </div>
            </div>
          )}
        </section>

        <aside className="mo-sidebar">
          <p className="mo-kicker">SAFETY BOUNDARY</p>
          <ul>
            <li>Separate URL and feature flag</li>
            <li>Server-only secret key</li>
            <li>{canManageOthers ? "Operator-only invitations" : "Creator becomes first Admin"}</li>
            <li>Atomic database transaction</li>
            <li>Empty tenant—no Milka data copy</li>
            <li>Audited creation event</li>
          </ul>
          <div className="mo-existing">
            <span>EXISTING WORKSPACES</span>
            <strong>{restaurants.length}</strong>
            {restaurants.slice(0, 5).map((restaurant) => (
              <small key={restaurant.id || restaurant.slug}>{restaurant.name} / {restaurant.slug}</small>
            ))}
          </div>
        </aside>
      </div>
    </main>
  );
}

export default ManagedOnboardingApp;
