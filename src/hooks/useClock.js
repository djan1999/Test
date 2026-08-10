import { useEffect, useState } from "react";

// ── Wall clock ────────────────────────────────────────────────
// A live time-of-day readout. Nothing else in the app re-renders on a
// schedule, so anything showing the time has to drive its own tick.
//
// The tick is scheduled ON the minute boundary, not on a flat 60s interval:
// an interval started at :47 would flip the display 47 seconds late forever,
// and the kitchen reads this against arrival stamps and course timers.
export function useClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer;
    const tick = () => {
      const d = new Date();
      setNow(d);
      // Aim just past the next boundary — landing exactly on it (or a few ms
      // early, which setTimeout does) would re-read the minute that is still
      // ending and spin a 0ms reschedule.
      const untilNextMinute = 60000 - (d.getSeconds() * 1000 + d.getMilliseconds());
      timer = setTimeout(tick, untilNextMinute + 50);
    };
    tick();

    // A kitchen panel sleeps between services and timers do not fire while a
    // tab is frozen — re-read (and re-anchor the tick) the moment it wakes,
    // so nobody is shown a stale time on a screen they just tapped awake.
    const onWake = () => { clearTimeout(timer); tick(); };
    document.addEventListener("visibilitychange", onWake);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, []);

  return now;
}

// 24-hour HH:MM, formatted by hand rather than by locale: a device set to an
// en-US locale would render "7:05 PM" on a board where every other time —
// arrivals, fire stamps, reservations — is written 19:05.
export function formatClock(date) {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}
