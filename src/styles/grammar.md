# Milka Service Board — Visual Grammar
## Rawlab-inspired: precision under pressure × live service state

---

### 1. Labels vs Values
Labels use `typeScale.label` (10px, 0.12em tracking, uppercase). Values use `typeScale.value`
(14px) or `typeScale.prominent` (18px). Labels sit **above** or **to the left** of their value —
never inline-mixed at the same size.

### 2. Metadata format
Coordinate-style, underscore-separated: `TABLE_03`, `COVERS_08`, `SEATED_19:42`.  
Compound readings use slash: `COURSE_02 / APPETIZER`.

### 3. Color = signal only
Every color token in `signal.*` carries a specific state meaning:
- `signal.active` (#c8a96e gold) — active / in-progress
- `signal.warn`   (#c49a4a amber) — delay or soft warning
- `signal.alert`  (#b84a3a red) — allergen flag, critical
- `signal.done`   (#8a8a8a) — completed, archived

If a color does not carry one of these states, it is wrong. Use `ink.*` instead.

### 4. Borders, shadows, radius
Borders: `rule.hairline` (1px) in `ink[4]`. **No drop shadows. No gradients. No border-radius** (`tokens.radius = 0`).
Cards are separated by negative space, not decoration.

### 5. Guest identifiers
Dense views: `G_A`, `G_B`, `G_C` (or 2-letter initials if available). Never full names.

### 6. Allergy / restriction flags
Monospaced square-bracket tags: `[GLUTEN]` `[DAIRY]` `[NUTS]`.  
Color: `signal.alert`. No background fill. No pill shape.

### 7. Status indicators
A single colored **rule** (top-border) or **dot** (6×6px, no radius) carries status.
Never a filled pill, badge, or button-shaped element for status.

### 8. Negative space
Default padding: `space[4]` (16px) horizontal, `space[5]` (24px) vertical.
If a layout feels crowded: **remove information**, do not reduce spacing or font size.

---

**Ink scale reference**

| Token   | Hex       | Use |
|---------|-----------|-----|
| ink[0]  | #0a0a0a   | Highest emphasis, prominent values |
| ink[1]  | #1a1a1a   | Primary text |
| ink[2]  | #4a4a4a   | Secondary text, meta labels |
| ink[3]  | #8a8a8a   | Tertiary, course labels, dividers |
| ink[4]  | #c4c4c4   | Hairline rules |
| ink[5]  | #e8e6e2   | Subtle fills |
| ink.bg  | #f8f7f5   | Canvas background |
