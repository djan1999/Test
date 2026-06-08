import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setWorkspaceId } from "../lib/supabaseClient.js";
import {
  readLocalMenuCourses, writeLocalMenuCourses,
  readLocalWines, writeLocalWines,
  readLocalLogo, writeLocalLogo,
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

    setWorkspaceId("restB");
    // Restaurant B sees none of A's cached data.
    expect(readLocalMenuCourses()).toBeNull();
    expect(readLocalWines()).toBeNull();
    expect(readLocalLogo()).toBe("");

    writeLocalMenuCourses([{ course_key: "b_only", position: 1 }]);
    expect(readLocalMenuCourses()).toEqual([{ course_key: "b_only", position: 1 }]);

    // Switching back to A still has A's data intact.
    setWorkspaceId("restA");
    expect(readLocalMenuCourses()).toEqual([{ course_key: "a_only", position: 1 }]);
    expect(readLocalLogo()).toBe("logoA");
  });
});
