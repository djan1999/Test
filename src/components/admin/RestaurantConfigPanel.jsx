import { useEffect, useState } from "react";
import { sanitizeRestaurantConfig } from "../../config/restaurantConfig.js";
import { tokens } from "../../styles/tokens.js";
import { baseInput } from "../../styles/mixins.js";
import { FONT } from "./adminStyles.js";

const labelStyle = {
  fontFamily: FONT,
  fontSize: 8,
  letterSpacing: 2,
  color: tokens.ink[3],
  textTransform: "uppercase",
  marginBottom: 6,
};

export default function RestaurantConfigPanel({ config, onSave }) {
  const [draft, setDraft] = useState(() => sanitizeRestaurantConfig(config));
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setDraft(sanitizeRestaurantConfig(config));
    setStatus(null);
    setMessage("");
  }, [config]);

  const updateTable = (index, patch) => {
    setDraft((previous) => ({
      ...previous,
      tables: previous.tables.map((table, tableIndex) => (
        tableIndex === index ? { ...table, ...patch } : table
      )),
    }));
  };

  const addTable = () => {
    setDraft((previous) => {
      const used = new Set(previous.tables.map((table) => Number(table.id)));
      let id = 1;
      while (used.has(id)) id += 1;
      return {
        ...previous,
        tables: [...previous.tables, { id, label: `T${String(id).padStart(2, "0")}` }]
          .sort((a, b) => Number(a.id) - Number(b.id)),
      };
    });
  };

  const removeTable = (index) => {
    setDraft((previous) => {
      if (previous.tables.length <= 1) return previous;
      return { ...previous, tables: previous.tables.filter((_, tableIndex) => tableIndex !== index) };
    });
  };

  const save = async () => {
    setStatus("saving");
    setMessage("");
    const clean = sanitizeRestaurantConfig(draft, config);
    const result = await onSave?.(clean);
    if (result?.ok) {
      setDraft(result.config || clean);
      setStatus("saved");
      setMessage("Restaurant setup saved on every device.");
    } else {
      setStatus("error");
      setMessage(result?.error || "Restaurant setup could not be saved.");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <div style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, letterSpacing: 2, color: tokens.ink[0], textTransform: "uppercase", marginBottom: 8 }}>
          Restaurant setup
        </div>
        <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[2], lineHeight: 1.6, maxWidth: 720 }}>
          These values belong to this restaurant workspace. Changing them updates the operating screens without rebuilding the app. A table that contains live service work cannot be removed until it is cleared or the service ends.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, maxWidth: 760 }}>
        <label>
          <div style={labelStyle}>Restaurant name</div>
          <input
            value={draft.name}
            onChange={(event) => setDraft((previous) => ({ ...previous, name: event.target.value }))}
            style={{ ...baseInput, width: "100%" }}
          />
        </label>
        <label>
          <div style={labelStyle}>App subtitle</div>
          <input
            value={draft.subtitle}
            onChange={(event) => setDraft((previous) => ({ ...previous, subtitle: event.target.value }))}
            style={{ ...baseInput, width: "100%" }}
          />
        </label>
      </div>

      <div style={{ maxWidth: 760 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
          <div>
            <div style={labelStyle}>Service tables</div>
            <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[2] }}>{draft.tables.length} configured</div>
          </div>
          <button type="button" onClick={addTable} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1.5, padding: "8px 12px", border: `1px solid ${tokens.ink[3]}`, background: tokens.neutral[0], cursor: "pointer" }}>
            + ADD TABLE
          </button>
        </div>

        <div style={{ border: `1px solid ${tokens.ink[4]}` }}>
          {draft.tables.map((table, index) => (
            <div key={`${table.id}-${index}`} style={{ display: "grid", gridTemplateColumns: "90px minmax(140px, 1fr) auto", gap: 8, padding: 8, borderBottom: index === draft.tables.length - 1 ? "none" : `1px solid ${tokens.ink[4]}`, alignItems: "center" }}>
              <input
                type="number"
                min="1"
                max="999"
                value={table.id}
                aria-label={`Table ${index + 1} id`}
                onChange={(event) => updateTable(index, { id: event.target.value })}
                style={{ ...baseInput, width: "100%" }}
              />
              <input
                value={table.label}
                aria-label={`Table ${index + 1} label`}
                onChange={(event) => updateTable(index, { label: event.target.value })}
                style={{ ...baseInput, width: "100%" }}
              />
              <button
                type="button"
                onClick={() => removeTable(index)}
                disabled={draft.tables.length <= 1}
                style={{ fontFamily: FONT, fontSize: 9, padding: "8px 10px", border: `1px solid ${tokens.red.border}`, background: tokens.red.bg, color: tokens.red.text, cursor: draft.tables.length <= 1 ? "not-allowed" : "pointer", opacity: draft.tables.length <= 1 ? 0.4 : 1 }}
              >REMOVE</button>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={save}
          disabled={status === "saving"}
          style={{ fontFamily: FONT, fontSize: 10, letterSpacing: 2, padding: "11px 18px", border: `1px solid ${tokens.charcoal.default}`, background: tokens.charcoal.default, color: tokens.neutral[0], cursor: status === "saving" ? "not-allowed" : "pointer" }}
        >{status === "saving" ? "SAVING..." : "SAVE RESTAURANT SETUP"}</button>
        {message && (
          <span style={{ fontFamily: FONT, fontSize: 10, color: status === "error" ? tokens.red.text : tokens.green.text }}>
            {message}
          </span>
        )}
      </div>
    </div>
  );
}
