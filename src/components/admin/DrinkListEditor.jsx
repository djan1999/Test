import { tokens } from "../../styles/tokens.js";
import { UI } from "../../styles/uiChrome.js";
import { baseInput, fieldLabel as mixinFieldLabel } from "../../styles/mixins.js";

const FONT = tokens.font;
const baseInp = { ...baseInput };
const fieldLabel = { ...mixinFieldLabel };

export default function DrinkListEditor({ list, setList, newItem, setNewItem, nextId, label }) {
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 28px", gap: 8, marginBottom: 8 }}>
        {["Name", "Notes / Label", ""].map((h, i) => (
          <div key={i} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#666", textTransform: "uppercase" }}>{h}</div>
        ))}
      </div>
      <div style={{ borderTop: "1px solid #f0f0f0", marginBottom: 12 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 24 }}>
        {list.map(item => (
          <div key={item.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 28px", gap: 8, alignItems: "center" }}>
            <input value={item.name} onChange={e => setList(l => l.map(x => x.id === item.id ? { ...x, name: e.target.value } : x))}
              style={{ ...baseInp, padding: "5px 8px" }} placeholder="Name" />
            <input value={item.notes} onChange={e => setList(l => l.map(x => x.id === item.id ? { ...x, notes: e.target.value } : x))}
              style={{ ...baseInp, padding: "5px 8px" }} placeholder="e.g. classic / on the rocks" />
            <button onClick={() => setList(l => l.filter(x => x.id !== item.id))} style={{
              background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0,
            }}>×</button>
          </div>
        ))}
      </div>
      <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: 16 }}>
        <div style={fieldLabel}>Add {label}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
          <input value={newItem.name} onChange={e => setNewItem(x => ({ ...x, name: e.target.value }))}
            placeholder="Name" style={{ ...baseInp, padding: "5px 8px" }} />
          <input value={newItem.notes} onChange={e => setNewItem(x => ({ ...x, notes: e.target.value }))}
            placeholder="Notes (optional)" style={{ ...baseInp, padding: "5px 8px" }}
            onKeyDown={e => { if (e.key === "Enter" && newItem.name.trim()) { setList(l => [...l, { ...newItem, id: nextId.current++ }]); setNewItem({ name: "", notes: "" }); }}} />
        </div>
        <button onClick={() => { if (!newItem.name.trim()) return; setList(l => [...l, { ...newItem, id: nextId.current++ }]); setNewItem({ name: "", notes: "" }); }} style={{
          fontFamily: FONT, fontSize: 10, letterSpacing: 2, padding: "8px 20px",
          border: `1px solid ${UI.line}`, borderRadius: tokens.radius, cursor: "pointer", background: UI.surface2, color: UI.ink, fontWeight: 600,
        }}>+ ADD {label.toUpperCase()}</button>
      </div>
    </>
  );
}
