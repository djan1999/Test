// ── Where a dragged ticket lands ──────────────────────────────────────────────
// Dragging a seated ticket straight UP onto the row of unseated banners did
// nothing; the same ticket dragged up AND sideways worked. The cause was the
// board's collision strategy: dnd-kit's rectIntersection scores each cell by
// how much of the DRAGGED CARD covers it, and a ticket is ~10× the height of a
// banner. Moved one row up, the ticket still overlapped the hole it came from
// far more than the banner under the cursor, so the board answered "you're over
// yourself" and the reorder was dropped on the floor.
//
// The board now asks what is under the POINTER. These are the geometry of the
// reported case, to the pixel: a 409px ticket, a 40px banner above it, and the
// cursor on the banner.

import { describe, it, expect } from "vitest";
import { rectIntersection } from "@dnd-kit/core";
import { ticketCollisions } from "../components/kitchen/KitchenBoard.jsx";

const rect = (id, left, top, width, height) => [id, { left, top, width, height, right: left + width, bottom: top + height }];

// Row 1: five short banners. Row 2: three tall tickets under them.
const BANNER_H = 40, TICKET_H = 409, COL_W = 289, GAP = 8, ROW1 = 55, ROW2 = 103;
const layout = new Map([
  ...[0, 1, 2, 3, 4].map(i => rect(`banner${i}`, 16 + i * (COL_W + GAP), ROW1, COL_W, BANNER_H)),
  ...[0, 1, 2].map(i => rect(`ticket${i}`, 16 + i * (COL_W + GAP), ROW2, COL_W, TICKET_H)),
]);
const containers = [...layout.keys()].map(id => ({ id, rect: { current: layout.get(id) } }));

// ticket0 lifted and carried straight up so the cursor sits on banner0. The
// card still covers most of its own slot — that is the whole problem.
const draggingTicket0Onto = (targetId, pointerY) => ({
  active: { id: "ticket0", rect: { current: { initial: layout.get("ticket0"), translated: layout.get("ticket0") } } },
  collisionRect: { ...layout.get("ticket0"), top: ROW1, bottom: ROW1 + TICKET_H },
  droppableRects: layout,
  droppableContainers: containers,
  pointerCoordinates: { x: layout.get(targetId).left + COL_W / 2, y: pointerY },
});

describe("kitchen board — a dragged ticket lands where the pointer is", () => {
  it("targets the banner under the cursor, not the hole the ticket came from", () => {
    const args = draggingTicket0Onto("banner0", ROW1 + BANNER_H / 2);
    expect(ticketCollisions(args)[0].id).toBe("banner0");
  });

  it("is the case rectIntersection got wrong — it answered with the ticket itself", () => {
    // Pinning the old behaviour, so nobody restores it thinking it equivalent.
    const args = draggingTicket0Onto("banner0", ROW1 + BANNER_H / 2);
    expect(rectIntersection(args)[0].id).toBe("ticket0");
  });

  it("still works across columns, which is how this had to be done before", () => {
    const args = draggingTicket0Onto("banner4", ROW1 + BANNER_H / 2);
    expect(ticketCollisions(args)[0].id).toBe("banner4");
  });

  it("falls back to the nearest card when the pointer is over a gap", () => {
    // Between two columns: nothing is under the cursor, but a drop must still
    // land somewhere rather than being silently discarded.
    const args = draggingTicket0Onto("banner0", ROW1 + BANNER_H / 2);
    args.pointerCoordinates = { x: 16 + COL_W + GAP / 2, y: ROW1 + BANNER_H / 2 };
    const hit = ticketCollisions(args);
    expect(hit.length).toBeGreaterThan(0);
    expect(hit[0].id).toBeDefined();
  });

  it("reports the ticket's own slot when the pointer never left it", () => {
    // Not a bug: the board drops this as a no-op, which is what should happen
    // when a card is picked up and put back down.
    const args = draggingTicket0Onto("ticket0", ROW2 + TICKET_H / 2);
    expect(ticketCollisions(args)[0].id).toBe("ticket0");
  });
});
