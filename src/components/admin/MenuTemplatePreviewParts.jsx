import { useEffect, useMemo, useRef, useState } from "react";
import { FONT, baseInp } from "./adminStyles.js";
import { optionalExtrasFromCourses, optionalPairingsFromCourses } from "../../utils/menuUtils.js";
import { tokens } from "../../styles/tokens.js";
import { resolveAperitifFromQuickAccessOption } from "../../utils/quickAccessResolve.js";

const SELECTED_RING = tokens.charcoal.default;

const PREVIEW_PAIRINGS = [
  { value: "—",         label: "None"      },
  { value: "Wine",      label: "Wine"      },
  { value: "Non-Alc",   label: "Non-Alc"   },
  { value: "Our Story", label: "Our Story" },
  { value: "Premium",   label: "Premium"   },
];

const PREVIEW_RESTRICTIONS = [
  { key: "veg",         label: "Veg"        },
  { key: "vegan",       label: "Vegan"      },
  { key: "gluten",      label: "Gluten-Free"},
  { key: "dairy",       label: "Dairy-Free" },
  { key: "nut",         label: "Nut-Free"   },
  { key: "no_pork",     label: "No Pork"    },
  { key: "no_red_meat", label: "No Red Meat"},
  { key: "no_game",     label: "No Game"    },
  { key: "no_alcohol",  label: "No Alcohol" },
  { key: "shellfish",   label: "Shellfish"  },
];

const makePreviewSeat = (id) => ({
  id, pairing: "Wine", extras: {},
  aperitifs: [], glasses: [], cocktails: [], beers: [],
  restrictions: [],
});

export function DrinkPill({ label, sub, onRemove }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 4,
      background: tokens.neutral[100], border: `1px solid ${tokens.neutral[300]}`, borderRadius: 0,
      padding: "2px 6px", fontFamily: FONT, fontSize: 8,
    }}>
      <span style={{ color: tokens.text.body, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}{sub ? ` · ${sub}` : ""}
      </span>
      <button
        onClick={onRemove}
        style={{ border: "none", background: "transparent", cursor: "pointer", color: tokens.text.disabled, fontSize: 10, padding: 0, lineHeight: 1 }}
        onMouseEnter={e => { e.currentTarget.style.color = tokens.red.text; }}
        onMouseLeave={e => { e.currentTarget.style.color = tokens.text.disabled; }}
      >×</button>
    </div>
  );
}

/** Inline search dropdown for wines and cocktails in the preview data panel */
export function MiniSearch({ wines = [], cocktails = [], spirits = [], beers = [], byGlass = false, bottleOnly = false, placeholder = "search…", onAdd }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const results = (() => {
    if (!q.trim()) return [];
    const lq = q.toLowerCase();
    const out = [];
    const winePool = byGlass ? wines.filter(w => w.byGlass) : wines;
    winePool.forEach(w => {
      if ((w.name || "").toLowerCase().includes(lq) || (w.producer || "").toLowerCase().includes(lq) || (w.vintage || "").includes(lq))
        out.push({ __type: "wine", name: w.name, producer: w.producer, vintage: w.vintage, country: w.country, region: w.region });
    });
    if (!bottleOnly && !byGlass) {
      cocktails.forEach(c => {
        if ((c.name || "").toLowerCase().includes(lq) || (c.notes || "").toLowerCase().includes(lq))
          out.push({ __type: "cocktail", name: c.name, notes: c.notes });
      });
      spirits.forEach(s => {
        if ((s.name || "").toLowerCase().includes(lq) || (s.notes || "").toLowerCase().includes(lq))
          out.push({ __type: "spirit", name: s.name, notes: s.notes });
      });
      beers.forEach(b => {
        if ((b.name || "").toLowerCase().includes(lq) || (b.notes || "").toLowerCase().includes(lq))
          out.push({ __type: "beer", name: b.name, notes: b.notes });
      });
    }
    return out.slice(0, 8);
  })();

  const pick = item => { onAdd(item); setQ(""); setOpen(false); };

  return (
    <div ref={ref} style={{ position: "relative", flex: 1 }}>
      <input
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(e.target.value.trim().length > 0); }}
        placeholder={placeholder}
        style={{ ...baseInp, fontSize: 9, padding: "3px 7px", width: "100%" }}
        autoComplete="off"
      />
      {open && results.length > 0 && (
        <div style={{
          position: "absolute", top: "calc(100% + 2px)", left: 0, right: 0, zIndex: 500,
          background: tokens.neutral[0], border: `1px solid ${tokens.neutral[200]}`, borderRadius: 0,
          boxShadow: "0 4px 16px rgba(0,0,0,0.12)", maxHeight: 180, overflowY: "auto",
        }}>
          {results.map((r, i) => (
            <div key={i} onMouseDown={() => pick(r)} style={{
              padding: "6px 10px", cursor: "pointer", fontFamily: FONT,
              borderBottom: `1px solid ${tokens.neutral[100]}`,
            }}
              onMouseEnter={e => { e.currentTarget.style.background = tokens.neutral[100]; }}
              onMouseLeave={e => { e.currentTarget.style.background = tokens.neutral[0]; }}
            >
              <div style={{ fontSize: 9, fontWeight: 700, color: tokens.text.primary }}>{r.name}</div>
              <div style={{ fontSize: 8, color: tokens.text.muted }}>
                {r.__type === "wine" ? [r.producer, r.vintage, r.country].filter(Boolean).join(" · ") : (r.notes || "")}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The collapsible preview data configuration panel */
export function PreviewDataPanel({
  wines, cocktails, spirits, beers,
  aperitifOptions = [],
  guests, onGuestsChange,
  seatIdx, onSeatIdxChange,
  seats, onUpdateSeat,
  menuCourses = [],
  bottleWines, onBottleWinesChange,
  lang, onLangChange,
  menuType, onMenuTypeChange,
  open, onToggle,
}) {
  const seat = seats[seatIdx] || makePreviewSeat(seatIdx + 1);

  const updSeat = patch => onUpdateSeat(seatIdx, patch);

  const optionalExtras   = useMemo(() => optionalExtrasFromCourses(menuCourses),  [menuCourses]);
  const optionalPairings = useMemo(() => optionalPairingsFromCourses(menuCourses), [menuCourses]);

  const addGlass  = item => updSeat({ glasses:   [...seat.glasses,   item] });
  const addAp     = item => updSeat({ aperitifs: [...seat.aperitifs, { ...item, __type: item.__type || "wine" }] });
  const addCock   = item => updSeat({ cocktails: [...seat.cocktails, item] });
  const addBottle = item => onBottleWinesChange([...bottleWines, item]);

  const apQuickAdd = opt => {
    const resolved = resolveAperitifFromQuickAccessOption(opt, { wines, cocktails, spirits, beers });
    const type = opt.type || "wine";
    if (resolved) {
      if (type === "wine") {
        addAp({ __type: "wine", name: resolved.name, producer: resolved.producer, vintage: resolved.vintage, country: resolved.country, region: resolved.region });
      } else {
        addAp({ __type: type === "beer" ? "beer" : "cocktail", name: resolved.name, notes: resolved.notes || "" });
      }
      return;
    }
    addAp({ __type: type === "beer" ? "beer" : "cocktail", name: opt.label });
  };

  const toggleRestriction = key => {
    const cur = seat.restrictions || [];
    updSeat({ restrictions: cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key] });
  };

  const btnStyle = (active) => ({
    fontFamily: FONT, fontSize: 8, letterSpacing: 0.5,
    padding: "3px 8px", border: `1px solid ${active ? SELECTED_RING : tokens.neutral[300]}`,
    borderRadius: 0, cursor: "pointer",
    background: active ? tokens.neutral[100] : tokens.neutral[0],
    color: active ? SELECTED_RING : tokens.text.muted,
  });

  const seatTabStyle = (i) => ({
    fontFamily: FONT, fontSize: 8.5, letterSpacing: 1, padding: "3px 10px",
    border: "none", borderBottom: `2px solid ${seatIdx === i ? SELECTED_RING : "transparent"}`,
    background: "transparent", cursor: "pointer",
    color: seatIdx === i ? SELECTED_RING : tokens.text.muted, fontWeight: seatIdx === i ? 700 : 400,
  });

  return (
    <div style={{
      borderBottom: `1px solid ${tokens.neutral[200]}`, background: tokens.neutral[50],
      flexShrink: 0, overflow: "hidden",
    }}>
      {/* Header strip — always visible */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "5px 12px", borderBottom: open ? `1px solid ${tokens.neutral[200]}` : "none",
      }}>
        <button
          onClick={onToggle}
          style={{ fontFamily: FONT, fontSize: 7.5, letterSpacing: 2, color: tokens.charcoal.default, background: "none", border: "none", cursor: "pointer", padding: 0, textTransform: "uppercase" }}
        >{open ? "▾ PREVIEW DATA" : "▸ PREVIEW DATA"}</button>

        <div style={{ width: 1, height: 14, background: tokens.neutral[200], flexShrink: 0 }} />

        {/* Seat tabs */}
        {Array.from({ length: guests }, (_, i) => (
          <button key={i} style={seatTabStyle(i)} onClick={() => onSeatIdxChange(i)}>
            P{i + 1}
          </button>
        ))}

        {/* Guests stepper */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 2 }}>
          <span style={{ fontFamily: FONT, fontSize: 7.5, color: tokens.text.muted, letterSpacing: 1 }}>GUESTS</span>
          <button onClick={() => onGuestsChange(guests - 1)} disabled={guests <= 1} style={{ ...btnStyle(false), padding: "2px 6px", fontSize: 10 }}>-</button>
          <span style={{ fontFamily: FONT, fontSize: 9, color: tokens.text.body, minWidth: 14, textAlign: "center" }}>{guests}</span>
          <button onClick={() => onGuestsChange(guests + 1)} disabled={guests >= 8} style={{ ...btnStyle(false), padding: "2px 6px", fontSize: 10 }}>+</button>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          {/* Lang toggle */}
          <span style={{ fontFamily: FONT, fontSize: 7.5, color: tokens.text.muted }}>LANG</span>
          {["en","si"].map(l => (
            <button key={l} onClick={() => onLangChange(l)} style={btnStyle(lang === l)}>{l.toUpperCase()}</button>
          ))}
          {/* Menu type toggle */}
          <span style={{ fontFamily: FONT, fontSize: 7.5, color: tokens.text.muted, marginLeft: 4 }}>MENU</span>
          <button onClick={() => onMenuTypeChange("")}      style={btnStyle(menuType === "")}>FULL</button>
          <button onClick={() => onMenuTypeChange("short")} style={btnStyle(menuType === "short")}>SHORT</button>
        </div>
      </div>

      {/* Expanded body */}
      {open && (
        <div style={{ display: "flex", gap: 0, padding: "10px 12px", overflowX: "auto" }}>

          {/* Column 1: Pairing + Restrictions */}
          <div style={{ minWidth: 190, marginRight: 16 }}>
            <div style={{ fontFamily: FONT, fontSize: 7, letterSpacing: 2, color: tokens.text.disabled, textTransform: "uppercase", marginBottom: 6 }}>
              P{seatIdx + 1} PAIRING
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 12 }}>
              {PREVIEW_PAIRINGS.map(p => (
                <button key={p.value} onClick={() => updSeat({ pairing: p.value })} style={btnStyle(seat.pairing === p.value)}>
                  {p.label}
                </button>
              ))}
            </div>
            <div style={{ fontFamily: FONT, fontSize: 7, letterSpacing: 2, color: tokens.text.disabled, textTransform: "uppercase", marginBottom: 6 }}>
              P{seatIdx + 1} RESTRICTIONS
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 12 }}>
              {PREVIEW_RESTRICTIONS.map(r => (
                <button key={r.key} onClick={() => toggleRestriction(r.key)} style={btnStyle((seat.restrictions || []).includes(r.key))}>
                  {r.label}
                </button>
              ))}
            </div>
            {optionalPairings.length > 0 && (<>
              <div style={{ fontFamily: FONT, fontSize: 7, letterSpacing: 2, color: tokens.text.disabled, textTransform: "uppercase", marginBottom: 6, marginTop: 8 }}>
                P{seatIdx + 1} OPT. PAIRINGS
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 6 }}>
                {optionalPairings.map(opt => {
                  const raw = (seat.optionalPairings || {})[opt.key];
                  const active = raw?.ordered !== undefined ? !!raw.ordered : opt.defaultOn !== false;
                  return (
                    <button key={opt.key} onClick={() => {
                      const cur = { ...(seat.optionalPairings || {}) };
                      cur[opt.key] = { ordered: !active };
                      updSeat({ optionalPairings: cur });
                    }} style={btnStyle(active)}>{opt.label}</button>
                  );
                })}
              </div>
            </>)}
            {optionalExtras.length > 0 && (<>
              <div style={{ fontFamily: FONT, fontSize: 7, letterSpacing: 2, color: tokens.text.disabled, textTransform: "uppercase", marginBottom: 6 }}>
                P{seatIdx + 1} EXTRAS
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                {optionalExtras.map(dish => {
                  const active = !!(seat.extras || {})[dish.key]?.ordered;
                  return (
                    <button key={dish.key} onClick={() => {
                      const cur = { ...(seat.extras || {}) };
                      cur[dish.key] = { ordered: !active, pairing: dish.pairings[0] };
                      updSeat({ extras: cur });
                    }} style={btnStyle(active)}>{dish.name}</button>
                  );
                })}
              </div>
            </>)}
          </div>

          {/* Divider */}
          <div style={{ width: 1, background: tokens.neutral[200], flexShrink: 0, marginRight: 16 }} />

          {/* Column 2: By-glass + Aperitifs */}
          <div style={{ minWidth: 200, marginRight: 16 }}>
            <div style={{ fontFamily: FONT, fontSize: 7, letterSpacing: 2, color: tokens.text.disabled, textTransform: "uppercase", marginBottom: 5 }}>
              P{seatIdx + 1} BY-THE-GLASS
            </div>
            <div style={{ display: "flex", gap: 4, marginBottom: 5 }}>
              <MiniSearch wines={wines} cocktails={[]} spirits={[]} beers={[]} byGlass placeholder="search wine…" onAdd={addGlass} />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 10 }}>
              {seat.glasses.map((w, i) => (
                <DrinkPill key={i} label={w.name} sub={w.vintage} onRemove={() => updSeat({ glasses: seat.glasses.filter((_, j) => j !== i) })} />
              ))}
            </div>

            <div style={{ fontFamily: FONT, fontSize: 7, letterSpacing: 2, color: tokens.text.disabled, textTransform: "uppercase", marginBottom: 5 }}>
              P{seatIdx + 1} APERITIFS
            </div>
            {aperitifOptions.length > 0 && (
              <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginBottom: 4 }}>
                {aperitifOptions.map(opt => (
                  <button key={opt.label} onClick={() => apQuickAdd(opt)} style={{ ...btnStyle(false), fontSize: 7.5 }}>{opt.label}</button>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 4, marginBottom: 5 }}>
              <MiniSearch wines={wines} cocktails={cocktails} spirits={spirits} beers={beers} placeholder="search aperitif…" onAdd={addAp} />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
              {seat.aperitifs.map((a, i) => (
                <DrinkPill key={i} label={a.name} sub={a.vintage} onRemove={() => updSeat({ aperitifs: seat.aperitifs.filter((_, j) => j !== i) })} />
              ))}
            </div>
          </div>

          {/* Divider */}
          <div style={{ width: 1, background: tokens.neutral[200], flexShrink: 0, marginRight: 16 }} />

          {/* Column 3: Cocktails + Bottle wines */}
          <div style={{ minWidth: 200 }}>
            <div style={{ fontFamily: FONT, fontSize: 7, letterSpacing: 2, color: tokens.text.disabled, textTransform: "uppercase", marginBottom: 5 }}>
              P{seatIdx + 1} COCKTAILS
            </div>
            <div style={{ display: "flex", gap: 4, marginBottom: 5 }}>
              <MiniSearch wines={[]} cocktails={cocktails} spirits={spirits} beers={beers} placeholder="search cocktail…" onAdd={addCock} />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 10 }}>
              {seat.cocktails.map((c, i) => (
                <DrinkPill key={i} label={c.name || c.label} onRemove={() => updSeat({ cocktails: seat.cocktails.filter((_, j) => j !== i) })} />
              ))}
            </div>

            <div style={{ fontFamily: FONT, fontSize: 7, letterSpacing: 2, color: tokens.text.disabled, textTransform: "uppercase", marginBottom: 5 }}>
              TABLE BOTTLE WINES
            </div>
            <div style={{ display: "flex", gap: 4, marginBottom: 5 }}>
              <MiniSearch wines={wines} cocktails={[]} spirits={[]} beers={[]} bottleOnly placeholder="search bottle wine…" onAdd={addBottle} />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
              {bottleWines.map((w, i) => (
                <DrinkPill key={i} label={w.name} sub={w.vintage} onRemove={() => onBottleWinesChange(bottleWines.filter((_, j) => j !== i))} />
              ))}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}

