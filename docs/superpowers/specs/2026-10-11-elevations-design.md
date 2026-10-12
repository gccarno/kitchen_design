# Kitchen wall elevations — design

Sub-project 3 of 4 from the 2026-10-10 feature review. It follows the layout check (Phase 8) and the estimate (Phase 9), and comes before design options and the spec sheet. The spec sheet will reuse these drawings.

## Purpose

Show each kitchen wall as a front elevation, the way a cabinet maker draws it: cabinets, appliances, the countertop, doors and windows at their real heights, with dimensions. The drawings are worked out from the floor plan, shown in the editor and exported as SVG and PNG.

## Decisions

- **View and export only.** Edits stay on the floor plan; the elevations follow every edit and undo.
- **Only what's on the wall:** items whose back is against the wall, corner cabinets touching it, and the doors and windows in it. Islands and free-standing items aren't drawn. A wall with nothing on it is skipped.
- **Cabinet-maker style:** a plinth and a countertop, simple door and drawer lines, named appliances, and dimensions.
- **Standard heights.** The plan doesn't store how high things hang, and these drawings don't add it. Heights come from the item's tag (below).
- **Kitchens only.** Closets already have their own elevation.

## Geometry: `src/lib/plan/elevation.ts` (pure)

```ts
export type PieceKind = 'base' | 'appliance' | 'tall' | 'wall' | 'counter-appliance';
export interface ElevationPiece {
  itemId: string;
  name: string;          // catalog name, or the catalog id when unknown
  tag?: string;
  kind: PieceKind;
  x: number;             // left edge along the wall, from the wall's left end as seen from inside
  w: number;
  y: number;             // bottom, above the floor
  h: number;
  plinthMm: number;      // 0, or 100 for base, sink, filler, corner and tall cabinets
}
export interface ElevationOpening { openingId: string; kind: OpeningKind; x: number; w: number; y: number; h: number }
export interface WallElevation {
  wallIndex: number;
  label: string;         // "Wall 1 — north, 3600 mm" (compass from plan-context's `compass`)
  lengthMm: number;
  ceilingMm: number;
  pieces: ElevationPiece[];   // sorted by x, then by y
  counters: { x: number; w: number }[];
  openings: ElevationOpening[];
}
export const ELEVATION = {
  againstMm: 50, plinthMm: 100, counterTopMm: 900, counterThicknessMm: 40,
  wallCabinetBottomMm: 1450, hoodBottomMm: 1600, otrMicrowaveBottomMm: 1450,
  windowSillMm: 1050, ceilingMm: 2400,
};
export function wallElevations(project: Project, catalog: Catalog): WallElevation[];
```

**Which items belong to a wall**
- **Facing the room:** the item's front points along the wall's inward normal, within 1°. Its back edge is within `againstMm` (50 mm) of the wall's inside face, measured from the item's centre: |distance − d/2| ≤ 50.
- **Corner cabinets** (tag `corner`) belong to every wall that one of their footprint edges lies within 50 mm of, whatever their rotation.
- **Along the wall:** the item's footprint is projected onto the wall line to give `x` and `w`. It's clipped to [0, lengthMm] and dropped when nothing is left.
- **Left and right:** the wall is seen from inside the room, facing it. The viewer faces f = −(inward normal). In plan coordinates (x east, y south), their right is r = (−f.y, f.x); facing north, right is east. If (end − start) · r > 0, the wall's start is its left end and `x` is measured from the start. Otherwise `x` is measured from the end. Tests cover both polygon orientations.
- **Which items:** only items with mount `floor`, `wall` or `counter`. Tags `island`, `table`, `chair` and `stool` are never drawn.

**Heights by tag** (`y` is the bottom, `h` the height; `plinthMm` is part of `h`)

| Tag / mount | y | h | plinth |
|---|---|---|---|
| `base`, `sink`, `filler` (floor), `corner` (floor) | 0 | 860 | 100 |
| `dishwasher` | 0 | 860 | 0 |
| `range` | 0 | 900 | 0 |
| `fridge` and any other floor item without a rule | 0 | stored h | 0 |
| `tall` | 0 | stored h + 100 | 100 |
| wall mount (`wall`, `filler` wall, `corner` wall, other) | 1450 | stored h | 0 |
| `range-hood` | 1600 | stored h | 0 |
| `microwave`, wall mount (over the range) | 1450 | stored h | 0 |
| counter mount (`microwave` on the counter, other) | 900 | stored h | 0 |

`kind`: `base` for base, sink, filler and corner floor items; `appliance` for floor items that aren't cabinets (dishwasher, range, fridge); `tall` for tall; `wall` for wall mount; `counter-appliance` for counter mount.

**Countertop:** pieces of kind `base` plus dishwashers make runs. Two of them join when the gap between them along the wall is 100 mm or less (the layout check's neighbour allowance). Each run gives one strip `{x, w}` from its left edge to its right edge. It's drawn from 860 to 900 mm. A range, fridge or tall item breaks the run.

**Openings:** each opening on the wall becomes `{x, w}` along the wall, from `positionMm` and `widthMm` and flipped like the items. Doors and pass-throughs go from y = 0 to `heightMm`; windows go from y = 1050 to 1050 + `heightMm`.

**Ceiling:** `max(2400, highest top of a piece or opening + 100)`.

**Order:** walls in polygon order; pieces by `x`, then by `y`.

## Drawing: `src/lib/plan/elevation-drawing.ts` (pure)

- The `Shape` type and `shapeToSvg` move from `src/lib/closet/drawing.ts` and `src/lib/closet/svg.ts` to `src/lib/drawing/shapes.ts`. The closet modules import them from there and behave the same.
- `elevationDrawing(e: WallElevation, units): Shape[]`, in elevation mm with y down (svgY = ceilingMm − height):
  - **Wall:** a light rectangle 0..lengthMm × 0..ceilingMm, with a heavier floor line.
  - **Openings:** a window is a white rectangle with a dashed outline and a centre mullion. A door is a white rectangle with a thin diagonal (swing hint). A pass-through is a white rectangle.
  - **Pieces:** a filled rectangle with an outline, and the plinth as a darker strip at the bottom.
    - **Fronts:** `base` w < 600 gets 1 door. `base` w ≥ 600 gets 2 doors. `sink` gets 2 doors. `filler` gets none. `corner` gets 1 door. Drawer bases aren't modelled, so plain bases get doors. `wall` gets 1 door when w < 600 and 2 otherwise. `tall` gets 2 stacked doors split at 2/3 of the height.
    - **Appliances** are an outline with the catalog name centred. Text that won't fit the width falls back to the short name (before the first " (" or ","), and is left out only if that doesn't fit either.
  - **Countertop:** a dark strip 860–900 over each counter run.
  - **Dimensions:**
    - Each piece's width: floor pieces get theirs on a line under the floor, and wall pieces (bottom of 1450 or more) on a line above the ceiling. Counter-top appliances get none.
    - The wall length on a second line under the floor.
    - On the left: the counter height (900) and, when there are wall cabinets, their bottom (1450) and top.
    - All of them use `formatLength` in the project's units.

## Editor: `src/components/KitchenElevations.tsx`

- It's a "Wall elevations" section in `ProjectEditor`, for kitchens, right after "Current room".
- `useMemo(() => wallElevations(project, catalog), [project])`.
- **Wall picker:** a `role="group"` with `aria-label="Walls"` and one toggle button per elevation, labelled with `label` and using `aria-pressed`. The picked wall index is kept in state. It falls back to the first elevation when the picked wall no longer has one.
- **Drawing:** an `<svg role="img" aria-label="Elevation of {label}">` showing `elevationDrawing` at full width, with the viewBox padded like `ClosetElevation`.
- **Empty state:** "Place cabinets or appliances against a wall to see its elevation."

## Export

- **`elevationsToSvg(project, catalog, opts?: { date?: string }): string`** in `src/lib/plan/elevation-svg.ts`.
  - Every elevation is stacked top to bottom at 1:50 (`SVG_SCALE`), each with its label as a heading, and one title block at the bottom (project name, "Wall elevations", scale, revision and date), like `closetToSvg`.
  - It throws when there are no elevations.
- **`GET /api/export/[id]/elevations/svg`** returns `image/svg+xml`, with the filename `<slug>-elevations.svg` (fallback `kitchen-elevations`).
- **`GET /api/export/[id]/elevations/png?scale=1|2`** goes through `svgToPng`, like the plan's PNG route, including its scale check.
- **Errors:** 400 for an invalid id, and a bad scale for PNG. 404 for an unknown project, a closet project, or a kitchen with no elevations, with a JSON error saying which.
- **Header links:** an "Elevations:" row with SVG and PNG links (with `?rev=`), labelled "Elevations as SVG" and "Elevations as PNG" so they don't clash with the plan's "SVG" link. It's shown only for kitchens with at least one elevation.

## Tests

- **`elevation.test.ts`:**
  - Item membership: backed against the wall, turned the wrong way, 60 mm off, a corner cabinet on two walls, islands ignored.
  - Left and right for a clockwise and a counter-clockwise room.
  - Every row of the heights table.
  - Countertop runs that join across a 50 mm gap and break at a range.
  - Window sill and door heights, with flipped positions.
  - Clipping at a wall end.
  - The ceiling rising above 2400 mm.
  - Walls without items are skipped.
- **`elevation-drawing.test.ts`:** door counts by tag and width; dimension texts in mm and in inches; the plinth strip; names that don't fit are left out.
- **Closet tests** still pass after `Shape` moves, with no closet snapshot changes.
- **Snapshots:** the sample kitchen's `elevationsToSvg` output (fixed date), and a one-line summary per elevation for each example kitchen in `tests/integration/example-layouts.test.ts`.
- **`KitchenElevations.test.tsx`:** the picker lists the walls, switching changes the drawing's label, the empty state shows, and inch units are used.
- **Route tests:** SVG and PNG content types, filenames, and 400 and 404 (including a closet and an empty kitchen).
- **Playwright:** on the sample kitchen, the elevations section shows, picking another wall changes the drawing, and the SVG link downloads.

## Out of scope

- Editing on the elevation.
- Stored mounting heights or ceiling height.
- Items on neighbouring walls drawn in section.
- Islands and free-standing furniture.
- Handles, hardware, drawer bases, finishes and backsplash.
