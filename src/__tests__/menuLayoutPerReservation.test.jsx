// Per-reservation menu layouts — a party booked on a special layout (e.g. a
// four-hands dinner mixing our dishes with a guest chef's) is served from that
// layout everywhere: course flow, kitchen ticket, weekly prints, the form.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  resolveTableProfile,
  resolveTableTemplate,
  tableLayoutOverride,
  profileBadge,
  specialOnlyCourseKeys,
  sanitizeProfilesPayload,
  setProfileBadge,
} from "../utils/menuLayoutProfiles.js";
import { getVisibleCoursesForTable } from "../utils/courseProgress.js";
import { generateKitchenTicketsHTML, generateWeeklyAllergyHTML } from "../utils/weeklyPrintGenerator.js";
import { blankTable, reservationDescriptiveFields } from "../utils/tableHelpers.js";
import ResvForm from "../components/reservations/ResvForm.jsx";

const tpl = (...keys) => ({
  version: 2,
  rows: keys.map((k, i) => ({ id: `r${i}`, left: { type: "course", courseKey: k }, right: null })),
});

const course = (key, position, name = key.toUpperCase()) => ({
  course_key: key, position, is_active: true, is_snack: false,
  course_category: "main", optional_flag: "", menu: { name, sub: "" },
});

const menuCourses = [
  course("bread", 1), course("trout", 2), course("lamb", 3),
  course("guest_scallop", 4), course("guest_dessert", 5),
];

const live = {
  id: "live", name: "Autumn Menu", target: "guest_menu",
  menuTemplate: tpl("bread", "trout", "lamb"),
  shortMenuTemplate: tpl("bread", "lamb"),
};
const fourHands = {
  id: "fh", name: "Milka 4 Hands", badge: "4 HANDS", target: "guest_menu",
  menuTemplate: tpl("bread", "guest_scallop", "trout", "guest_dessert"),
  shortMenuTemplate: null,
};
const profiles = [live, fourHands];
const assignments = { longMenuProfileId: "live" };

describe("resolveTableProfile / resolveTableTemplate", () => {
  it("serves the live layout when the booking picks none", () => {
    expect(resolveTableProfile({}, profiles, assignments).id).toBe("live");
    expect(resolveTableTemplate({ menuType: "short" }, profiles, assignments)).toBe(live.shortMenuTemplate);
  });

  it("serves the booking's own layout when it picks one", () => {
    const t = { menuProfileId: "fh" };
    expect(resolveTableProfile(t, profiles, assignments).id).toBe("fh");
    expect(resolveTableTemplate(t, profiles, assignments)).toBe(fourHands.menuTemplate);
  });

  it("falls back to the long version when the special layout has no short one", () => {
    expect(resolveTableTemplate({ menuProfileId: "fh", menuType: "short" }, profiles, assignments))
      .toBe(fourHands.menuTemplate);
  });

  it("falls back to live when the picked layout was deleted", () => {
    const t = { menuProfileId: "gone" };
    expect(resolveTableProfile(t, profiles, assignments).id).toBe("live");
    expect(tableLayoutOverride(t, profiles, assignments)).toBeNull();
  });

  it("only reports an override for a non-live layout", () => {
    expect(tableLayoutOverride({ menuProfileId: "live" }, profiles, assignments)).toBeNull();
    expect(tableLayoutOverride({ menuProfileId: "fh" }, profiles, assignments)?.id).toBe("fh");
  });

  it("badge defaults to the layout name", () => {
    expect(profileBadge(fourHands)).toBe("4 HANDS");
    expect(profileBadge({ name: "Wine Dinner" })).toBe("Wine Dinner");
  });

  it("lists guest-chef-only dishes as special-only", () => {
    expect([...specialOnlyCourseKeys(profiles, assignments)].sort()).toEqual(["guest_dessert", "guest_scallop"]);
  });

  it("sanitize and setProfileBadge keep the badge", () => {
    const next = setProfileBadge(profiles, "fh", "  duo  ");
    const out = sanitizeProfilesPayload({ profiles: next, assignments });
    expect(out.profiles.find(p => p.id === "fh").badge).toBe("duo");
  });
});

describe("the booking's layout reaches the table and the course flow", () => {
  it("reservationDescriptiveFields carries menuProfileId to the table", () => {
    expect(reservationDescriptiveFields({ menuProfileId: "fh" }).menuProfileId).toBe("fh");
    expect(reservationDescriptiveFields({}).menuProfileId).toBe("");
    expect(blankTable(1).menuProfileId).toBe("");
  });

  it("course flow follows the special layout's courses and order", () => {
    const table = { ...blankTable(4), menuProfileId: "fh" };
    const keys = getVisibleCoursesForTable(table, menuCourses, { profiles, assignments }).map(c => c.key);
    expect(keys).toEqual(["bread", "guest_scallop", "trout", "guest_dessert"]);
  });

  it("a regular table never sees the guest chef's dishes", () => {
    const keys = getVisibleCoursesForTable(blankTable(5), menuCourses, { profiles, assignments }).map(c => c.key);
    expect(keys).toEqual(["bread", "trout", "lamb"]);
  });
});

describe("weekly prints", () => {
  const resv = (id, data) => ({ id, date: "2026-11-12", table_id: 3, data: { resName: id, guests: 2, ...data } });

  it("kitchen tickets list the special layout's courses and label the menu", () => {
    const html = generateKitchenTicketsHTML([resv("A", { menuProfileId: "fh" })], menuCourses, [], profiles, assignments);
    expect(html).toContain("GUEST_SCALLOP");
    expect(html).not.toContain("LAMB");
    expect(html).toContain("4 HANDS");
    const regular = generateKitchenTicketsHTML([resv("B", {})], menuCourses, [], profiles, assignments);
    expect(regular).toContain("LAMB");
    expect(regular).not.toContain("GUEST_SCALLOP");
  });

  it("the allergy sheet hides guest-chef dishes in a week without four-hands bookings", () => {
    const week = Array.from({ length: 7 }, (_, i) => new Date(2026, 10, 9 + i));
    const restr = [{ note: "vegan", pos: 1 }];
    const plain = generateWeeklyAllergyHTML([resv("A", { restrictions: restr })], menuCourses, week, [], profiles, assignments);
    expect(plain).not.toContain("GUEST_SCALLOP");
    const event = generateWeeklyAllergyHTML([resv("A", { restrictions: restr }), resv("B", { restrictions: restr, menuProfileId: "fh" })], menuCourses, week, [], profiles, assignments);
    expect(event).toContain("GUEST_SCALLOP");
    expect(event).toContain("4 HANDS");
  });
});

describe("ResvForm layout picker", () => {
  if (typeof window !== "undefined" && !window.ResizeObserver) {
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
  const tables = Array.from({ length: 10 }, (_, i) => blankTable(i + 1));
  const initial = (data = {}) => ({ id: "res-1", date: "2026-11-12", table_id: 3,
    data: { resName: "NOVAK", resTime: "19:00", guests: 2, tableGroup: [], service_session: "dinner", ...data } });
  const renderForm = (props) => {
    const onSave = vi.fn().mockResolvedValue({ ok: true });
    render(<ResvForm initial={initial()} tables={tables} reservations={[]} excludeId="res-1"
      onSave={onSave} onCancel={vi.fn()} menuLayouts={profiles} liveLayoutId="live" {...props} />);
    return onSave;
  };

  it("saves the picked special layout on the booking", async () => {
    const onSave = renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Milka 4 Hands" }));
    fireEvent.click(screen.getByText("SAVE"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].data.menuProfileId).toBe("fh");
  });

  it("switching back to the live layout stores an empty id", async () => {
    const onSave = renderForm({ initial: initial({ menuProfileId: "fh" }) });
    fireEvent.click(screen.getByRole("button", { name: "Autumn Menu (live)" }));
    fireEvent.click(screen.getByText("SAVE"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].data.menuProfileId).toBe("");
  });

  it("hides the picker when only the live layout exists", () => {
    renderForm({ menuLayouts: [live] });
    expect(screen.queryByText("Menu layout")).toBeNull();
  });
});

describe("MenuLayoutPanel — special layouts", () => {
  it("lists live and special layouts, shows bookings, creates an empty layout and edits the badge", async () => {
    const { default: MenuLayoutPanel } = await import("../components/admin/MenuLayoutPanel.jsx");
    const onCreate = vi.fn();
    const onBadge = vi.fn();
    render(
      <MenuLayoutPanel
        menuCourses={menuCourses}
        menuTemplate={fourHands.menuTemplate}
        layoutProfiles={profiles}
        activeLayoutProfileId="fh"
        layoutAssignments={assignments}
        layoutBookings={{ fh: { count: 3, guests: 14, dates: ["2026-11-12"] } }}
        onCreateLayoutProfile={onCreate}
        onSetLayoutProfileBadge={onBadge}
      />
    );
    expect(screen.getByText("Live menu")).toBeTruthy();
    expect(screen.getByText(/Special layouts/)).toBeTruthy();
    expect(screen.getAllByText(/3 bookings · 14 guests/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("+ Empty layout"));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ blank: true }));

    const badge = screen.getByLabelText("Kitchen badge");
    fireEvent.change(badge, { target: { value: "DUO" } });
    fireEvent.blur(badge);
    expect(onBadge).toHaveBeenCalledWith("fh", "DUO");
  });
});

describe("second logo on the menu header", () => {
  it("stacks a second inline logo under the main one, and refuses non-image sources", async () => {
    const { generateMenuHTML } = await import("../utils/menuGenerator.js");
    const png = "data:image/png;base64,iVBORw0KGgo=";
    const template = (second) => ({ version: 2, rows: [
      { id: "h", left: { type: "title" }, right: { type: "logo", size: 10.5, secondLogo: second, secondLogoSize: 16, secondLogoGap: 2.5 }, widthPreset: "55/45" },
      { id: "c", left: { type: "course", courseKey: "bread" }, right: null, widthPreset: "55/45" },
    ] });
    const render = (second) => generateMenuHTML({
      seat: { id: 1 }, table: { menuType: "" }, menuCourses, menuTemplate: template(second),
      logoDataUri: "data:image/png;base64,AAAA", lang: "en",
    });
    const withSecond = render(png);
    expect(withSecond).toContain('class="logo-second"');
    expect(withSecond).toContain("width:16mm");
    expect(render("").includes("logo-second")).toBe(false);
    expect(render("https://evil.example/x.png\" onerror=\"x").includes("logo-second")).toBe(false);
  });
});

describe("logo size precedence", () => {
  const tpl = (logo) => ({ version: 2, rows: [
    { id: "h", left: { type: "title" }, right: { type: "logo", ...logo }, widthPreset: "55/45" },
    { id: "c", left: { type: "course", courseKey: "bread" }, right: null, widthPreset: "55/45" },
  ] });
  const render = async (logo, layoutStyles) => {
    const { generateMenuHTML } = await import("../utils/menuGenerator.js");
    return generateMenuHTML({ seat: { id: 1 }, table: {}, menuCourses, menuTemplate: tpl(logo), layoutStyles, _logo: "data:image/png;base64,AAAA" });
  };
  it("the block's own size wins over the legacy layout style", async () => {
    expect(await render({ size: 30 }, { logoSize: 21.7 })).toContain("#logo img{width:30mm;");
  });
  it("a block without a size falls back to the legacy style, then 10.5mm", async () => {
    expect(await render({}, { logoSize: 21.7 })).toContain("#logo img{width:21.7mm;");
    expect(await render({}, {})).toContain("#logo img{width:10.5mm;");
  });
});
