import FullModal from "../ui/FullModal.jsx";
import TableSummaryCard from "./TableSummaryCard.jsx";
import { tokens } from "../../styles/tokens.js";
import { mergeTableGroups, tableGroupLabel } from "../../utils/tableHelpers.js";

const FONT = tokens.font;

// The summary is read on the screen it is on. It used to also offer COPY TEXT,
// which flattened the same cards into a pasteable block — nobody pasted it, so
// the button and its second, drifting rendering of every party are gone.
export default function SummaryModal({ tables, optionalExtras = [], optionalPairings = [], celebrationKeys = [], onClose }) {
  // Collapse multi-table reservations into one virtual row so a party
  // spanning T02-T03 shows up once with all seats merged. celebrationKeys:
  // birthday-seeded extras must not make secondary blanks read as guests.
  const active = mergeTableGroups(tables, celebrationKeys).filter(t => t.active || t.arrivedAt);
  const groupLabel = tableGroupLabel;

  return (
    <FullModal title="Service Summary" onClose={onClose}>
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
        {active.length === 0 && <div style={{ fontFamily: FONT, fontSize: 11, color: tokens.neutral[400], textAlign: "center", padding: "80px 0" }}>No active tables</div>}
        {active.map((t) => (
          <TableSummaryCard key={t.id} table={t} groupLabel={groupLabel(t)} optionalExtras={optionalExtras} optionalPairings={optionalPairings} />
        ))}
      </div>
    </FullModal>
  );
}
