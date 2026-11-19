/**
 * How close a room read from photos is to the true one: the numbers a person
 * would check (shape, overall size, doors and windows), not a vertex-by-vertex
 * match, since the model is free to start the outline at any corner.
 */
import { polygonAreaMm2, polygonBounds, type Point } from '@/lib/plan/geometry';
import type { Project } from '@/lib/plan/schemas';

type Room = Project['room'];

export interface RoomScore {
  sides: { want: number; got: number };
  /** Signed, percent of the true value: +10 means the room came out 10% too big. */
  areaErrorPct: number;
  /** The longer and the shorter side of the room's bounding box, so a turned outline still compares. */
  longSideErrorPct: number;
  shortSideErrorPct: number;
  doors: { want: number; got: number };
  windows: { want: number; got: number };
  /** Right number of sides, doors and windows, and every size within `tolerancePct`. */
  good: boolean;
}

const pct = (got: number, want: number) => Math.round(((got - want) / want) * 1000) / 10;

function sidesOf(room: Room): [number, number] {
  const b = polygonBounds(room.polygon as Point[]);
  const [w, d] = [b.maxX - b.minX, b.maxY - b.minY];
  return [Math.max(w, d), Math.min(w, d)];
}

export function scoreRoom(truth: Room, got: Room, tolerancePct = 10): RoomScore {
  const count = (room: Room, kind: string) => room.openings.filter((o) => o.kind === kind).length;
  const [wantLong, wantShort] = sidesOf(truth);
  const [gotLong, gotShort] = sidesOf(got);
  const score = {
    sides: { want: truth.polygon.length, got: got.polygon.length },
    areaErrorPct: pct(polygonAreaMm2(got.polygon as Point[]), polygonAreaMm2(truth.polygon as Point[])),
    longSideErrorPct: pct(gotLong, wantLong),
    shortSideErrorPct: pct(gotShort, wantShort),
    doors: { want: count(truth, 'door'), got: count(got, 'door') },
    windows: { want: count(truth, 'window'), got: count(got, 'window') },
  };
  const good =
    score.sides.want === score.sides.got &&
    score.doors.want === score.doors.got &&
    score.windows.want === score.windows.got &&
    [score.areaErrorPct, score.longSideErrorPct, score.shortSideErrorPct].every((e) => Math.abs(e) <= tolerancePct);
  return { ...score, good };
}
