export const RESERVATION_STATUSES = [
  "pending",
  "confirmed",
  "arrived",
  "completed",
  "cancelled",
  "no_show",
];

const TRANSITIONS = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["arrived", "cancelled", "no_show"],
  arrived: ["completed", "confirmed"],
  completed: [],
  cancelled: ["pending"],
  no_show: ["confirmed"],
};

export function canTransitionReservation(from, to) {
  return Boolean(TRANSITIONS[from]?.includes(to));
}

export function assertReservationTransition(from, to, reason = "") {
  if (!canTransitionReservation(from, to)) {
    throw new Error(`Reservation cannot move from ${from} to ${to}.`);
  }
  if ((to === "cancelled" || to === "no_show") && !String(reason).trim()) {
    throw new Error("A reason is required for cancellation or no-show.");
  }
  return true;
}

export function statusLabel(status) {
  return ({
    pending: "Pending",
    confirmed: "Confirmed",
    arrived: "Arrived",
    completed: "Completed",
    cancelled: "Cancelled",
    no_show: "No-show",
  })[status] || status;
}
