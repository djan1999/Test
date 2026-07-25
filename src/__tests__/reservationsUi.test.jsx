import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ReservationWorkspace from "../components/reservations/ReservationWorkspace.jsx";
import PublicBookingPage, { ManageBooking } from "../components/reservations/PublicBookingPage.jsx";
import ReservationsAdminPanel from "../components/admin/reservations/ReservationsAdminPanel.jsx";
import { DEFAULT_RESERVATION_CONFIG, DEFAULT_WEEKLY_SERVICES, normalizeReservationConfig } from "../domain/reservations/config.js";

const DATE = "2026-07-22"; // a Wednesday — lunch and dinner both served
const config = normalizeReservationConfig(DEFAULT_RESERVATION_CONFIG);

const booking = (overrides = {}) => ({
  id: "b1",
  date: DATE,
  service: "dinner",
  time: "18:00",
  pax: 2,
  status: "confirmed",
  name: "Zupan, Marko",
  phone: "+386 41 000 000",
  email: "marko@example.com",
  language: "sl",
  source: "phone",
  ref: "MK-ABC12",
  tableLabel: "T01",
  experience: "grand_tasting",
  occasion: "",
  notes: "",
  allergies: [],
  accessibility: [],
  consentNews: false,
  operationalData: { tableGroup: ["T01"], restrictions: [], menuType: "long" },
  ...overrides,
});

const workspaceProps = (overrides = {}) => ({
  bookings: [booking()],
  serviceDate: DATE,
  activeService: "dinner",
  reservationConfig: DEFAULT_RESERVATION_CONFIG,
  weeklyServices: DEFAULT_WEEKLY_SERVICES,
  calendarRules: [],
  waitlist: [],
  tables: [{ id: 1, displayLabel: "T01" }, { id: 2, displayLabel: "T02" }],
  onSaveBooking: vi.fn().mockResolvedValue({}),
  onStatusChange: vi.fn().mockResolvedValue({}),
  onAssignTables: vi.fn().mockResolvedValue({}),
  onSwapBookings: vi.fn().mockResolvedValue({}),
  onResolveConflict: vi.fn(),
  onConvertWaitlist: vi.fn().mockResolvedValue({}),
  onRemoveWaitlist: vi.fn().mockResolvedValue({}),
  ...overrides,
});

describe("ReservationWorkspace", () => {
  it("shows the day's bookings with their status and table", () => {
    render(<ReservationWorkspace {...workspaceProps()} />);
    expect(screen.getByText("Zupan, Marko")).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "T01" })).toBeInTheDocument();
  });

  it("renders every tab without crashing", () => {
    render(<ReservationWorkspace {...workspaceProps()} />);
    ["Timeline", "Calendar", "Guests", "Waitlist", "Planning & Print"].forEach((tab) => {
      fireEvent.click(screen.getByRole("button", { name: tab }));
    });
    expect(screen.getByRole("button", { name: "Day Book" })).toBeInTheDocument();
  });

  it("offers only the transitions the lifecycle allows, and confirms without a reason", () => {
    const props = workspaceProps();
    render(<ReservationWorkspace {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    // confirmed → arrived / cancelled / no_show. "Confirm" must not be offered.
    expect(screen.getByRole("button", { name: "Mark arrived" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark arrived" }));
    expect(props.onStatusChange).toHaveBeenCalledWith({ id: "b1", to: "arrived" });
  });

  it("requires a reason before a cancellation is sent", () => {
    const props = workspaceProps();
    render(<ReservationWorkspace {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Cancel booking" }));
    expect(props.onStatusChange).not.toHaveBeenCalled();
    expect(screen.getByText("A reason is required.")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Reason \(required/), { target: { value: "guest called" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel booking" }));
    expect(props.onStatusChange).toHaveBeenCalledWith({ id: "b1", to: "cancelled", reason: "guest called" });
  });

  it("surfaces a failed write instead of reporting success", async () => {
    const props = workspaceProps({ onStatusChange: vi.fn().mockRejectedValue(new Error("Server refused the change.")) });
    render(<ReservationWorkspace {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark arrived" }));
    expect(await screen.findByText("Server refused the change.")).toBeInTheDocument();
  });

  it("offers MOVE THEM as well as swap when a table is already held", () => {
    const props = workspaceProps({
      bookings: [
        booking(),
        booking({ id: "b2", name: "Kovač, Petra", time: "18:00", tableLabel: "T02", operationalData: { tableGroup: ["T02"], restrictions: [] } }),
      ],
    });
    render(<ReservationWorkspace {...props} />);
    fireEvent.click(screen.getAllByRole("button", { name: "T01" })[0]);
    // T02 is held by Petra at the same time — choosing it opens the resolution.
    fireEvent.click(screen.getByRole("button", { name: /T02.*Holds Kovač/s }));
    expect(screen.getByText(/T02 holds Kovač, Petra/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Move them →/ }).length).toBeGreaterThan(0);
  });

  it("flags a possible duplicate guest by telephone", () => {
    const props = workspaceProps({
      bookings: [booking(), booking({ id: "b3", name: "Zupan, M.", phone: "+386 41 000 000" })],
    });
    render(<ReservationWorkspace {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Guests" }));
    expect(screen.getAllByText("DUP?").length).toBeGreaterThan(0);
    expect(screen.getByText(/possible duplicate/i)).toBeInTheDocument();
  });

  it("only renders a print card when its generator is wired", () => {
    const { rerender } = render(<ReservationWorkspace {...workspaceProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Planning & Print" }));
    expect(screen.getByText(/No print generators are connected/i)).toBeInTheDocument();

    rerender(<ReservationWorkspace {...workspaceProps({ onPrintBreakdown: vi.fn() })} />);
    fireEvent.click(screen.getByRole("button", { name: "Planning & Print" }));
    expect(screen.getByText("Service breakdown")).toBeInTheDocument();
  });

  it("says so plainly when a date has no service", () => {
    render(<ReservationWorkspace {...workspaceProps({ calendarRules: [{ date: DATE, kind: "closed", label: "staff party" }] })} />);
    expect(screen.getByText(/No service on/)).toBeInTheDocument();
  });

  it("hides editing controls for a read-only role", () => {
    render(<ReservationWorkspace {...workspaceProps({ canEdit: false })} />);
    expect(screen.queryByRole("button", { name: "[+] New booking" })).not.toBeInTheDocument();
  });


  it("calls the print generators with the shape useReservationWorkspace expects", () => {
    const handlers = {
      onPrintBreakdown: vi.fn(),
      onPrintAllergySheet: vi.fn(),
      onPrintKitchenTicket: vi.fn(),
      onPrintWeekly: vi.fn(),
    };
    render(<ReservationWorkspace {...workspaceProps(handlers)} />);
    fireEvent.click(screen.getByRole("button", { name: "Planning & Print" }));
    screen.getAllByRole("button", { name: "Print" }).forEach((button) => fireEvent.click(button));

    expect(handlers.onPrintBreakdown).toHaveBeenCalledWith({ date: DATE, service: "dinner" });
    expect(handlers.onPrintAllergySheet).toHaveBeenCalledWith({ date: DATE, service: "dinner" });
    expect(handlers.onPrintKitchenTicket).toHaveBeenCalledWith({ date: DATE, service: "dinner" });
    expect(handlers.onPrintWeekly).toHaveBeenCalledWith({ from: DATE });
  });

  it("converts a waitlist party onto the evening they asked for, not the day on screen", () => {
    const entry = {
      id: "w1",
      date: "2026-07-24",
      service: "lunch",
      time: "12:30",
      window: "",
      name: "Perko, Ana",
      phone: "+386 40 335 660",
      email: "ana@example.com",
      pax: 3,
      quotedMinutes: 30,
      notes: "by the window",
      status: "waiting",
      createdAt: "2026-07-21T18:12:00Z",
    };
    const props = workspaceProps({ waitlist: [entry] });
    render(<ReservationWorkspace {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Waitlist" }));
    fireEvent.click(screen.getByRole("button", { name: "Convert" }));

    const payload = props.onConvertWaitlist.mock.calls[0][0];
    expect(payload).toMatchObject({ id: "w1", date: "2026-07-24", service: "lunch", time: "12:30", pax: 3, name: "Perko, Ana" });
  });

  it("hides waitlist parties that are no longer waiting", () => {
    const base = { date: DATE, service: "dinner", time: "19:00", pax: 2, quotedMinutes: 30, createdAt: "2026-07-21T18:00:00Z" };
    render(
      <ReservationWorkspace
        {...workspaceProps({
          waitlist: [
            { ...base, id: "w1", name: "Still Waiting", status: "waiting" },
            { ...base, id: "w2", name: "Already Removed", status: "removed" },
            { ...base, id: "w3", name: "Already Converted", status: "converted" },
          ],
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Waitlist" }));
    expect(screen.getByText("Still Waiting")).toBeInTheDocument();
    expect(screen.queryByText("Already Removed")).not.toBeInTheDocument();
    expect(screen.queryByText("Already Converted")).not.toBeInTheDocument();
    expect(screen.getByText(/unplaced demand · 1/i)).toBeInTheDocument();
  });

  it("shows loading and error states rather than an empty screen", () => {
    const { rerender } = render(<ReservationWorkspace {...workspaceProps({ loading: true })} />);
    expect(screen.getByText(/Loading reservations/i)).toBeInTheDocument();
    rerender(<ReservationWorkspace {...workspaceProps({ error: "Network unreachable", onRetry: vi.fn() })} />);
    expect(screen.getByText("Network unreachable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("PublicBookingPage", () => {
  const publicConfig = {
    restaurantName: "Milka",
    tagline: "A table at Milka",
    ...DEFAULT_RESERVATION_CONFIG.online,
    ...DEFAULT_RESERVATION_CONFIG.publicPage,
    experiences: DEFAULT_RESERVATION_CONFIG.experiences.map((item) => ({ ...item })),
  };
  const services = [
    { service: "dinner", first: "18:00", last: "19:30", interval: 30, slots: [{ time: "18:00", ok: true }, { time: "18:30", ok: false, reason: "sitting_full" }] },
  ];

  it("walks the guest from date to a live time", async () => {
    render(<PublicBookingPage publicConfig={publicConfig} loadAvailability={vi.fn().mockResolvedValue(services)} submitBooking={vi.fn()} joinWaitlist={vi.fn()} startDate={DATE} />);
    fireEvent.click(screen.getByRole("button", { name: "Find a time" }));
    expect(await screen.findByRole("button", { name: /18:00/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /18:30/ })).toBeDisabled();
  });

  // The servers used to strip `reason` from the public response, so every
  // closed time read "Full" — including one that was closed because no table of
  // that SIZE was free, which a smaller party could have taken.
  it("says which kind of no a closed time is", async () => {
    const mixed = [{
      service: "dinner", first: "18:00", last: "19:30", interval: 30,
      slots: [
        { time: "18:00", ok: true },
        { time: "18:30", ok: false, reason: "no_table" },
        { time: "19:00", ok: false, reason: "too_late" },
        { time: "19:30", ok: false, reason: "sitting_full" },
      ],
    }];
    render(<PublicBookingPage publicConfig={publicConfig} loadAvailability={vi.fn().mockResolvedValue(mixed)} submitBooking={vi.fn()} joinWaitlist={vi.fn()} startDate={DATE} />);
    fireEvent.click(screen.getByRole("button", { name: "Find a time" }));

    expect(await screen.findByRole("button", { name: /19:30/ })).toHaveTextContent("Full");
    const noTable = screen.getByRole("button", { name: /18:30/ });
    expect(noTable).toHaveTextContent("No table");
    expect(noTable).toHaveAttribute("title", "No table of the right size is free then.");
    expect(screen.getByRole("button", { name: /19:00/ })).toHaveTextContent("Too late");
  });

  it("returns the guest to live times when the table goes mid-flow", async () => {
    const loadAvailability = vi.fn().mockResolvedValue(services);
    const submitBooking = vi.fn().mockRejectedValue(Object.assign(new Error("gone"), { code: "slot_taken" }));
    render(<PublicBookingPage publicConfig={publicConfig} loadAvailability={loadAvailability} submitBooking={submitBooking} joinWaitlist={vi.fn()} startDate={DATE} />);

    fireEvent.click(screen.getByRole("button", { name: "Find a time" }));
    fireEvent.click(await screen.findByRole("button", { name: /18:00/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByPlaceholderText("Name and surname"), { target: { value: "Ana Perko" } });
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "ana@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("+386 …"), { target: { value: "+386 41 000 111" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Review reservation" }));
    fireEvent.click(screen.getByText(/I accept the reservation conditions/));
    fireEvent.click(screen.getByRole("button", { name: "Confirm reservation" }));

    expect(await screen.findByText(/Nothing was booked/)).toBeInTheDocument();
  });

  it("blocks confirmation until the conditions are accepted", async () => {
    const submitBooking = vi.fn();
    render(<PublicBookingPage publicConfig={publicConfig} loadAvailability={vi.fn().mockResolvedValue(services)} submitBooking={submitBooking} joinWaitlist={vi.fn()} startDate={DATE} />);
    fireEvent.click(screen.getByRole("button", { name: "Find a time" }));
    fireEvent.click(await screen.findByRole("button", { name: /18:00/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByPlaceholderText("Name and surname"), { target: { value: "Ana Perko" } });
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "ana@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("+386 …"), { target: { value: "+386 41 000 111" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Review reservation" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm reservation" }));
    expect(submitBooking).not.toHaveBeenCalled();
    expect(screen.getByText(/Please accept the reservation conditions/)).toBeInTheDocument();
  });

  it("shows the test-mode banner", () => {
    render(<PublicBookingPage publicConfig={publicConfig} loadAvailability={vi.fn().mockResolvedValue(services)} submitBooking={vi.fn()} joinWaitlist={vi.fn()} testMode startDate={DATE} />);
    expect(screen.getByText(/Test mode/)).toBeInTheDocument();
  });

  it("gives the manage link an honest expired state", () => {
    render(<ManageBooking booking={null} expired onCancel={vi.fn()} restaurantName="Milka" phone="+386 40 000 000" />);
    expect(screen.getByText(/Link expired or invalid/i)).toBeInTheDocument();
  });
});

describe("ReservationsAdminPanel", () => {
  const adminProps = (overrides = {}) => ({
    config: DEFAULT_RESERVATION_CONFIG,
    weeklyServices: DEFAULT_WEEKLY_SERVICES,
    exceptions: [],
    bookings: [],
    audit: [],
    onSave: vi.fn().mockResolvedValue({}),
    ...overrides,
  });

  it("names the change and its consequence before saving", async () => {
    const props = adminProps({
      bookings: [{ ...booking({ date: "2099-01-01", time: "18:00", pax: 14 }) }],
    });
    render(<ReservationsAdminPanel {...props} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Availability & Capacity/ })[0]);
    // Drop the per-seating cap below the busiest booked seating.
    const [down] = screen.getAllByRole("button", { name: "−" });
    fireEvent.click(down);
    fireEvent.click(screen.getByRole("button", { name: "What will change?" }));
    expect(screen.getByText("Guests per seating")).toBeInTheDocument();
    expect(screen.getByText(/above the new cap/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(props.onSave).toHaveBeenCalledTimes(1);
    const payload = props.onSave.mock.calls[0][0];
    expect(payload.config.pacing.coversPerSlot).toBe(config.pacing.coversPerSlot - 1);
    expect(payload.changes.some((change) => change.label === "Guests per seating")).toBe(true);
  });

  it("warns how many bookings a removed service day lands on", () => {
    render(
      <ReservationsAdminPanel
        {...adminProps({ bookings: [booking({ date: "2099-01-07", service: "dinner", status: "confirmed" })] })}
      />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /Services & Hours/ })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Wed" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "What will change?" }));
    expect(screen.getByText(/dinner on Wednesday/)).toBeInTheDocument();
  });

  it("does not save until the manager confirms", () => {
    const props = adminProps();
    render(<ReservationsAdminPanel {...props} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Booking Rules/ })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "+" })[0]);
    expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();
    expect(props.onSave).not.toHaveBeenCalled();
  });
});
