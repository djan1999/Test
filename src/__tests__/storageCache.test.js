import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setWorkspaceId } from "../lib/supabaseClient.js";
import {
  readLocalMenuCourses, writeLocalMenuCourses,
  readLocalWines, writeLocalWines,
  readLocalLogo, writeLocalLogo,
  readLocalReservations, writeLocalReservations,
  readLocalRestrictions, writeLocalRestrictions,
  readLocalCourseNotes, writeLocalCourseNotes,
} from "../utils/storage.js";

// These caches back the "local-first" boot path: the device paints instantly
// from them, and they must be isolated per workspace so switching restaurants
// never shows the previous one's data.
describe("local-first device caches", () => {
  beforeEach(() => { localStorage.clear(); setWorkspaceId(null); });
  afterEach(() => { setWorkspaceId(null); });

  it("menu courses round-trip", () => {
    expect(readLocalMenuCourses()).toBeNull();
    const courses = [{ course_key: "amuse", position: 1 }, { course_key: "venison", position: 2 }];
    writeLocalMenuCourses(courses);
    expect(readLocalMenuCourses()).toEqual(courses);
  });

  it("wines round-trip", () => {
    expect(readLocalWines()).toBeNull();
    const wines = [{ id: "w1", name: "Riesling", byGlass: true }];
    writeLocalWines(wines);
    expect(readLocalWines()).toEqual(wines);
  });

  it("logo round-trip (empty string when unset)", () => {
    expect(readLocalLogo()).toBe("");
    writeLocalLogo("data:image/svg+xml;base64,AAAA");
    expect(readLocalLogo()).toBe("data:image/svg+xml;base64,AAAA");
    writeLocalLogo("");
    expect(readLocalLogo()).toBe("");
  });

  it("reservations round-trip", () => {
    expect(readLocalReservations()).toBeNull();
    const resv = [{ id: "r1", date: "2026-06-08" }, { id: "r2", date: "2026-06-09" }];
    writeLocalReservations(resv);
    expect(readLocalReservations()).toEqual(resv);
  });

  it("restrictions round-trip", () => {
    expect(readLocalRestrictions()).toBeNull();
    const list = [{ key: "veg", label: "Vegetarian" }];
    writeLocalRestrictions(list);
    expect(readLocalRestrictions()).toEqual(list);
  });

  it("course quick-notes round-trip (object, not array)", () => {
    expect(readLocalCourseNotes()).toBeNull();
    const notes = { amuse: "no nuts", venison: "med-rare" };
    writeLocalCourseNotes(notes);
    expect(readLocalCourseNotes()).toEqual(notes);
    // An array is not a valid notes map → reads back as null.
    localStorage.setItem("milka-course-quick-notes-v1", JSON.stringify([1, 2]));
    expect(readLocalCourseNotes()).toBeNull();
  });

  it("non-array / corrupt course payloads read back as null, never throw", () => {
    writeLocalMenuCourses(null);
    expect(readLocalMenuCourses()).toEqual([]); // null normalizes to [] on write
    localStorage.setItem("milka-menu-courses-v1", "{not json");
    expect(readLocalMenuCourses()).toBeNull();
  });

  it("caches are isolated per workspace", () => {
    setWorkspaceId("restA");
    writeLocalMenuCourses([{ course_key: "a_only", position: 1 }]);
    writeLocalWines([{ id: "wA", name: "A-wine" }]);
    writeLocalLogo("logoA");
    writeLocalReservations([{ id: "rA", date: "2026-06-08" }]);

    setWorkspaceId("restB");
    // Restaurant B sees none of A's cached data.
    expect(readLocalMenuCourses()).toBeNull();
    expect(readLocalWines()).toBeNull();
    expect(readLocalLogo()).toBe("");
    expect(readLocalReservations()).toBeNull();

    writeLocalMenuCourses([{ course_key: "b_only", position: 1 }]);
    expect(readLocalMenuCourses()).toEqual([{ course_key: "b_only", position: 1 }]);

    // Switching back to A still has A's data intact.
    setWorkspaceId("restA");
    expect(readLocalMenuCourses()).toEqual([{ course_key: "a_only", position: 1 }]);
    expect(readLocalLogo()).toBe("logoA");
  });
});
