import { tokens } from "../../../styles/tokens.js";
import { FONT, coversOf, darkButton, dayLabel } from "./shared.js";

/**
 * Planning & Print.
 *
 * Every sheet is produced by the generator the kitchen and floor already read
 * — this tab only chooses the date and service and calls it. A card appears
 * only when its handler is wired, so nothing here promises paper the app
 * cannot actually produce.
 */
export default function PlanningPrint({ date, dayBookings, onPrintBreakdown, onPrintAllergySheet, onPrintKitchenTicket, onPrintWeekly }) {
  const withRestrictions = dayBookings.filter((booking) => {
    const list = booking.operationalData?.restrictions || booking.allergies || [];
    return Array.isArray(list) && list.length > 0;
  });

  const cards = [
    onPrintBreakdown && {
      key: "breakdown",
      title: "Service breakdown",
      body: `Every party for ${dayLabel(date)}, grouped by seating — tables, covers, menu, dietaries and notes.`,
      note: `${dayBookings.length} ${dayBookings.length === 1 ? "party" : "parties"} · ${coversOf(dayBookings)} covers`,
      action: () => onPrintBreakdown(date),
    },
    onPrintAllergySheet && {
      key: "allergy",
      title: "Kitchen allergy sheet",
      body: "The course matrix, one column per guest with a restriction, for the pass.",
      note: withRestrictions.length
        ? `${withRestrictions.length} ${withRestrictions.length === 1 ? "party" : "parties"} with restrictions`
        : "No restrictions recorded for this day",
      action: () => onPrintAllergySheet(date),
    },
    onPrintKitchenTicket && {
      key: "ticket",
      title: "Kitchen tickets",
      body: "The per-table tickets, exactly as service prints them today.",
      note: `${dayBookings.length} ${dayBookings.length === 1 ? "ticket" : "tickets"}`,
      action: () => onPrintKitchenTicket(date),
    },
    onPrintWeekly && {
      key: "weekly",
      title: "Weekly overview",
      body: "The week's reservations and allergy sheet, for the office wall.",
      note: "Week containing " + dayLabel(date),
      action: () => onPrintWeekly(date),
    },
  ].filter(Boolean);

  if (!cards.length) {
    return (
      <div style={{ textAlign: "center", padding: "70px 0", color: tokens.ink[3], fontFamily: FONT }}>
        <div style={{ fontSize: 24, marginBottom: 12, letterSpacing: "0.10em", color: tokens.ink[4] }}>[ ]</div>
        <div style={{ fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase" }}>No print generators are connected</div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12 }}>
      {cards.map((card) => (
        <div key={card.key} style={{ background: tokens.neutral[0], border: `1px solid ${tokens.ink[4]}`, padding: "14px 16px", fontFamily: FONT }}>
          <div style={{ fontSize: 12, color: tokens.ink[0], fontWeight: 500 }}>{card.title}</div>
          <div style={{ fontSize: 9, color: tokens.ink[3], lineHeight: 1.7, marginTop: 5 }}>{card.body}</div>
          <div style={{ fontSize: 8, letterSpacing: "0.10em", textTransform: "uppercase", color: tokens.ink[2], marginTop: 8 }}>{card.note}</div>
          <button type="button" style={{ ...darkButton, marginTop: 10 }} onClick={card.action}>
            Print
          </button>
        </div>
      ))}
    </div>
  );
}
