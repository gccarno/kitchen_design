# Closet Design: Reach-In Closet Elevation Editor (Design Spec)

Date: 2026-10-04 · Status: approved design, awaiting spec review

## Goal
Extend the kitchen planner so it can also design **reach-in closets**. A kitchen is a top-down plan problem. A reach-in closet is a front-elevation problem: rods, shelves, towers and drawers stacked on one wall behind a door opening. So closets get their own project type and their own elevation editor.

## Decisions (locked in with user)
- **Closet type:** reach-in closets only. Walk-ins and wardrobes are out of scope.
- **Components:** rods & shelves, drawers & towers, shoe shelves & accessories (baskets, hooks, valet rod), and the door type and opening width.
- **Catalog:** generic standard sizes. No brand or product line.
- **AI chat:** must work for closets in v1.
- **View:** a new front-elevation editor. The plan view is not used for closets.

## Assumptions (not yet confirmed by the user)
- A closet is its own project, not a closet inside a bedroom plan.
- No photo or room extraction for closets in v1.
- No 3D view.

## Success criteria
- I can create a "Closet" project and set its interior width, height and depth and its door opening (style, position, width).
- I can place, move, resize and remove components on a front elevation, by tap and drag or through the chat.
- Warnings flag real closet problems: clothes hitting a shelf, a box or the floor; drawers blocked by doors; hard-to-reach corners; a shelf too high to reach; overlapping boxes.
- Undo and redo, the diff preview, the project list thumbnail and PNG/SVG export all work for closets.
- Existing kitchen projects load and behave exactly as before.

## Data model (`src/lib/plan/schemas.ts`)
```ts
kind: z.enum(['kitchen', 'closet']).default('kitchen')   // on ProjectSchema
closet: ClosetSchema.optional()                          // present iff kind === 'closet'

ClosetSchema = {
  widthMm, heightMm, depthMm,                // interior, positive
  opening: { style: 'bifold' | 'sliding' | 'hinged' | 'open', leftMm, widthMm },
  components: ClosetComponent[],
}

ClosetComponent = {
  id,
  kind: 'shelf' | 'rod' | 'tower' | 'drawers' | 'shoe_shelf' | 'basket' | 'hooks' | 'valet_rod',
  xMm,        // left edge, from the closet's left wall
  widthMm,
  yMm,        // height above the floor: rods/shelves/hooks at their own height; boxes at their bottom
  heightMm?,  // boxes only (tower, drawers, basket)
  depthMm?,
  count?,     // drawers in a drawer unit, shelves in a tower
}
```
- `room` and `items` stay required. A closet project keeps a footprint rectangle (width × depth) and an empty `items`.
- `validatePlan` reports an error when `kind` and `closet` disagree.
- The whole project is diffed into a JSON Patch (`planToJsonPatch`). So `/closet/...` changes get revisions, undo/redo and the diff preview with no changes to that machinery.

## Closet domain (`src/lib/closet/`)
- **`catalog.ts`**: the component kinds with defaults and allowed ranges. Examples:
  - Shelf depth 305 mm (12").
  - Rods at 1067 / 2134 mm for double hang, or 1727 mm for long hang.
  - Tower 457–610 mm wide.
  - Drawer unit with 3–5 drawers.
  - Shoe shelf 305 mm deep.

  Positions snap to 25 mm, or ½" when the project is in inches.
- **`validate.ts`**: `validateCloset(closet)`.
  - **Errors:**
    - a component outside the closet bounds
    - an opening outside the front face
    - an invalid count
  - **Warnings:**
    - Towers, drawers or baskets overlap.
    - The garment drop under a rod hits a shelf, a box or the floor. Short hang drops ~1000 mm and long hang ~1500 mm. Which applies depends on the rod's height and what is below it.
    - A rod has less than ~50 mm of clearance under the shelf above it.
    - Drawers are not fully inside the opening, after allowing for the stack-back of bifold or hinged doors.
    - A component reaches more than ~300 mm past an opening edge ("hard to reach").
    - A shelf is above ~2130 mm ("needs a step stool").
- **`commands.ts`**: `ClosetCommandSchema` is a discriminated union, mirroring `src/lib/plan/commands.ts`:
  - `setClosetSize`, `setOpening`
  - `addComponent`, `moveComponent`, `resizeComponent`, `removeComponent`
  - `renameProject`

  Components are referred to as `c1…`. `compileClosetCommands` reuses `CommandError`, stops at the first command that makes the closet invalid, and returns `{ project, patch }`.
- **`svg.ts`**: `closetToSvg(project)` draws the front elevation with dimension labels and the door opening as a dashed overlay. Export and thumbnails both use it.

## UI
- **`NewProjectForm`**: a Kitchen / Closet choice. `createProject` takes `kind`. A new closet is 1830 × 2440 × 610 mm (6′ × 8′ × 24″) with a full-width bifold opening and no components.
- **`ProjectEditor`**: branches on `project.kind`. Closets render `ClosetEditor`; the kitchen path is unchanged.
- **`ClosetEditor`** reuses the header, export links, `DiffPreview`, `HistoryControls`, `ChatPanel` and the warnings box. It adds:
  - A size and opening form. It goes through the existing proposal and review flow.
  - **`ClosetElevationCanvas`** (react-konva). In it you can:
    - drag on x and y with snapping
    - drag a side handle to resize width
    - tap to place the palette pick
    - delete the selected component
    - snap rods and shelves to tower sides and walls

    Edits commit straight away as user revisions, like the kitchen canvas's `editPlan`.
  - **`ClosetPalette`**: one button per component kind.
- **Project list**: the closet thumbnail draws the elevation, and a "Closet" badge marks the project.
- **Strings**: the app name becomes neutral ("Home Design"), and the project page title follows the kind.

## AI chat
- The refine route branches on kind to `refineCloset` (`src/lib/llm/refine-closet.ts`). It uses the same two-attempt retry loop as `refinePlan`.
- The prompt, `buildClosetRefinePrompt`, covers:
  - double hang vs. long hang
  - a continuous top shelf
  - towers splitting sections
  - drawers kept inside the opening
  - shoes kept low
  - standard heights
- `describeClosetForLLM` gives the model the dimensions, the opening, and `c1…` with their positions.
- `ClosetRefinementSchema` is `{ commands, summary, reply }`.
- LLM: OpenRouter free models only. Ask before any paid call.

## Export
`loadDrawing` branches on kind to `closetToSvg`. The PNG/SVG routes don't change. The default file name is `closet-elevation`.

## Testing
- **Vitest:**
  - schema back-compat (old project JSON with no `kind`)
  - each validation rule
  - command compilation and errors
  - undo round-trip
  - SVG snapshot
- **Playwright e2e:** create a closet, add components, edit through chat (with a stubbed provider), undo, export.
- `npm run typecheck`, `npm run lint`, `npm test` and `npm run e2e` all pass. The existing kitchen tests stay green.

## Out of scope (v1)
- Walk-in closets and wardrobes.
- 3D view.
- Photo extraction for closets.
- Brand catalogs, price and shopping lists.
- Multiple closet walls.
