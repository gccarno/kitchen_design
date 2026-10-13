# Design options and the spec sheet — design

This is sub-project 4 of 4 from the 2026-10-10 feature review. It follows the layout check (Phase 8), the estimate (Phase 9) and wall elevations (Phase 10).

## Purpose

- **Design options:** try a second (or third) version of a design without losing the first, then compare them side by side.
- **Spec sheet:** hand one finished design to a contractor, cabinet shop or client as a single PDF. It holds the plan, the elevations, the parts list and estimate, and the layout check.

## Decisions

- **An option is a copy of a project.** It's an ordinary project with its own undo history, linked to the original by one field. A project never holds several variants, so the document format, undo and every export stay as they are.
- **The compare view is read-only.** Edits happen in each option's own editor.
- **The spec sheet covers one design.** A PDF of the comparison is out of scope.
- **The PDF is built on the server with `pdf-lib`,** a small pure-JS dependency. Drawings are embedded as PNGs made by the existing `sharp` pipeline. No headless browser.
- **Paper follows units:** Letter for projects in inches, A4 for mm.
- **Both kitchens and closets** get options and a spec sheet.

## Part 1: Design options

### Data

`ProjectSchema` gets one optional field:

```ts
/** Set on a design option: the id of the original design it was copied from. */
optionOf: z.string().min(1).optional(),
```

- **Groups:** a project's option group is identified by its *group id*, `project.optionOf ?? project.id`. The group is the project with that id (the original), if it still exists, plus every project whose `optionOf` equals the group id.
- **No nesting:** copying an option sets the copy's `optionOf` to the same group id.
- **The original is never written to.** Old projects need no migration.
- **Not editable:** `optionOf` is not under `EDITABLE_ROOTS`, so revisions can't change it. It's set only at duplication.
- **Groups of one:** a project with no options is a group of one. It shows no group UI.

### Storage: `src/lib/storage/projects.ts`

```ts
export function duplicateAsOption(dataDir: string, sourceId: string): Project;
export function optionGroup(dataDir: string, groupId: string): Project[];
export function nextOptionName(groupName: string, existingNames: string[]): string;
```

- **`duplicateAsOption`:**
  - Loads the source and creates a new project with a new id, `createdAt`/`updatedAt` = now, `revision: 0` and `history: []`.
  - Copies `name` (see below), `kind`, `units`, `room`, `items`, `closet`, `pricing` and `photos`.
  - Copies each photo file (`photos/<photoId>.jpg`) into the new project's `photos/` directory. Photo ids and paths stay the same: paths are relative to the project.
  - Sets `optionOf` to the source's group id.
  - Writes atomically, as `createProject` does, and returns the new project.
  - Throws when the source doesn't exist.
- **Naming:**
  - The group name is the original's name. If the original is gone, it's the oldest remaining option's name with any " — Option X" suffix removed.
  - The new option is named `"<group name> — Option <L>"`, where L is the first letter from B to Z not already used as a suffix in the group. The original counts as A.
  - After Z, it falls back to `"<group name> — Option <n>"` with the next free number from 27.
  - The user can rename any option afterwards, as now.
- **`optionGroup`:** returns the group's projects. The original comes first, if present, then the rest by `createdAt`. It returns `[]` when none exist.
- **Project list:** `ProjectSummary` gains `optionOf` and `createdAt`.

### API

**`POST /api/projects/[id]/duplicate`**
- No body.
- Returns 201 with the new project.
- 400 for an invalid id; 404 for an unknown project.

**Group data for the compare page:** read on the server in the page component through `optionGroup`, the way the home page uses `listProjects`. No API route is needed.

### Editor: `src/components/ProjectEditor.tsx`

**"Duplicate as option" button** in the header, for both kinds:
- It POSTs to the duplicate route, then navigates to `/project/<newId>`.
- While the request runs, the button is disabled.
- A failure shows the error inline, as other header actions do.

**"Compare options" link** to `/compare/<groupId>`:
- Shown when the project belongs to a group with at least two projects.
- The editor learns the group size from its page component. `src/app/project/[id]/page.tsx` already loads the project on the server; it also passes `optionCount` and `groupId` as new optional `ProjectEditor` props. When the props are absent, the link stays hidden.

### Home page: `src/components/ProjectList.tsx`

- Projects in a group are listed together. The group sits where its newest member would sort, with its members ordered as in `optionGroup`.
- Options are indented under the first member and carry an "Option" badge.
- Single projects list as now.

### Compare page: `src/app/compare/[groupId]/page.tsx`

**Loading and errors:**
- A server component that loads `optionGroup(groupId)` and the catalog.
- If the id is invalid or the group is empty, it calls Next's `notFound()`.
- A group of one renders normally, with a single column.

**Heading:** "Compare options — <group name>", with a link back to the home page.

**Columns:** one per project, in group order, each showing:
- The name, linked to `/project/<id>`.
- `PlanThumbnail` of the room and items. Closets also use `PlanThumbnail` of their footprint, the same as the home list.
- "Total <money>" and "Subtotal <money>" from `buildEstimate`, formatted with `moneyFormat` in the project's currency.
- Kitchens only: "Layout check: X of Y passed", counted the way `LayoutCheckPanel` counts, with the titles of failed rules listed below.
- "<n> items": `items.length` for kitchens, `closet.components.length` for closets.

**"What differs" table** below the columns:
- One row per estimate line key whose quantity isn't the same in every column. A key missing from a column counts as quantity 0.
- Rows are labelled with the line's label and unit, with one quantity cell per column.
- Rows are sorted by label.
- With no differences, it shows "These options use the same parts."

**Layout:** the columns sit in a horizontally scrolling row, so phones can scroll sideways. Each column is at least 220 px wide.

## Part 2: The spec sheet (PDF)

### Route: `GET /api/export/[id]/pdf`

**Response:**
- `application/pdf`, with `Content-Disposition: attachment; filename="<slug>-spec-sheet.pdf"`.
- The filename uses `exportFileName(name, 'pdf', 'kitchen-spec-sheet')`, with `-spec-sheet` inserted the way `elevationsFileName` does it. The fallback is `closet-spec-sheet` for closets.

**Errors:** 400 for an invalid id; 404 for an unknown project. Both go through `loadExportProject`.

**Header link:** the editor header gets a "Spec sheet (PDF)" link with `?rev=<revision>`, for both kinds.

### Builder: `src/lib/export/spec-sheet.ts`

```ts
export const PAGE = { letter: [612, 792], a4: [595.28, 841.89] } as const; // points
export const MARGIN_PT = 42.52;                                             // 15 mm
export const STANDARD_SCALES = [20, 25, 50, 100] as const;                  // 1:N
export function pickScale(drawingMm: { w: number; h: number }, boxPt: { w: number; h: number }): number | null;
export function buildSpecSheet(project: Project, catalog: Catalog, opts?: { date?: string }): Promise<Uint8Array>;
```

**`pickScale`** returns the smallest N in `STANDARD_SCALES` (the largest drawing) for which the drawing fits the box at 1:N. A point is 25.4/72 mm on paper. It returns `null` when even 1:100 doesn't fit. Such a drawing is fitted to the box and labelled "Not to scale".

**Rendering drawings:**
- The plan comes from `planToSvg` and the closet front from `closetToSvg`. Elevations are built one wall at a time (see the kitchen pages).
- Each drawing is rendered with `sharp` to a PNG at 200 dpi for its printed size, then embedded with `embedPng`.
- The PDF doesn't use the SVG builders' own title blocks. `planToSvg` and `closetToSvg` get a new `titleBlock?: boolean` option, defaulting to `true` so existing exports are unchanged. The PDF passes `false`.

**Text:**
- Helvetica and Helvetica-Bold, the pdf-lib standard fonts (WinAnsi).
- Text passes through `pdfSafe(s)`, which replaces any character WinAnsi can't encode with "?".
- Lengths use `formatLength(mm, project.units)`. Money uses `moneyFormat`.

**Layout helper:** a small internal helper in the same file, or `src/lib/export/pdf-layout.ts` if the file grows past about 300 lines. It keeps a cursor on the current page and provides:
- `heading`, `text` and `keyValue` rows.
- `table(columns, rows)`, which breaks across pages and repeats the header row.
- `image(png, wPt, hPt)`.
- `ensureSpace(hPt)`, which starts a new page when needed.

**Paper:** Letter when `project.units === 'in'`, otherwise A4. Portrait. 15 mm margins.

**Footer** on every page, written after all pages exist: `<name> · <date> · revision <n> · page <i> of <m>`. `date` defaults to today, `YYYY-MM-DD`.

### Pages: kitchen

1. **Cover and plan.**
   - Title: the project name. Subtitle: "Kitchen spec sheet".
   - Key–value rows:
     - Room: the bounding size `W × D` and the area in m² or ft².
     - Items: `items.length`.
     - Estimate total.
     - Layout check: "X of Y passed".
   - Then the floor plan in the remaining space at `pickScale`, captioned "Floor plan — 1:N" (or "Floor plan — not to scale").
2. **Wall elevations.**
   - Heading "Wall elevations". Each `WallElevation` gets its label and drawing.
   - All walls use one scale: `pickScale` of the largest `elevationFrame` width and height across the walls, against a box of the full content width by a third of the content height.
   - They're stacked, and a new page starts when the next one doesn't fit.
   - Rendering: each wall is drawn from `elevationDrawing` with its `elevationFrame`, through `shapeToSvg` in a bare SVG wrapper. This is the same pipeline as `elevationsToSvg`, one wall at a time, with no title block.
   - Left out when `wallElevations` returns `[]`.
3. **Parts list and estimate.**
   - Heading "Parts list and estimate".
   - Table columns: Part, Qty, Unit, Unit price, Total, from `buildEstimate`.
   - Then the right-aligned rows Subtotal, Install (p%), Tax (p%), Total.
   - Then the note: "Prices are estimates from default or edited unit prices, not quotes."
4. **Layout check.**
   - Heading "Layout check — X of Y passed".
   - One row per rule, in the panel's order (fails, then passes, then info and n/a), with the columns Status, Rule, Detail.
   - Detail lengths are in the project's units, as in the panel.

### Pages: closet

1. **Cover and front elevation.**
   - Title: the project name. Subtitle: "Closet spec sheet".
   - Key–value rows: Interior (`W × H × D`), Door (style and width), Components (count), Estimate total.
   - Then the front elevation at `pickScale`, captioned "Front elevation — 1:N".
2. **Parts list and estimate,** as for kitchens.

### Shared helpers

- The layout check's pass/fail count and ordering move into `src/lib/plan/layout-check.ts` as `layoutSummary(rules): { passed: number; counted: number; ordered: LayoutRule[] }`. `LayoutCheckPanel`, the compare page and the PDF all use it.
- `moneyFormat(currency)` (today exported from `EstimatePanel.tsx`) moves to `src/lib/estimate/money.ts`. `EstimatePanel` re-exports it. The panel, the compare page and the PDF all use it.

## Tests

**Storage, `duplicateAsOption`:**
- New id, revision 0, empty history.
- Copies room, items, pricing and photos, including the photo files on disk.
- `optionOf` is set to the group id: an option of an option points at the original.
- The original's file is unchanged.
- Unknown source throws.

**Storage, `nextOptionName`:**
- B, then C; a gap is reused.
- The original's name has no suffix.
- After Z comes 27.
- A renamed option frees its letter.

**Storage, `optionGroup`:** order; a missing original; a group of one; `[]` for an unknown id.

**Duplicate route:** 201 and the body; 400; 404.

**`ProjectList`:** groups are listed together, with options indented and badged.

**`ProjectEditor`:**
- The duplicate button posts and navigates; it's disabled while pending; an error shows.
- The compare link appears only with two or more projects in the group.
- The PDF link has the right href.

**Compare page component:**
- Columns are in order, with totals.
- Kitchens show the layout-check line; closets don't.
- The "What differs" rows include a key missing from one column, and the no-differences text shows when nothing differs.

**`pickScale`:** each standard scale; `null` past 1:100; point/mm conversion.

**`buildSpecSheet`** (parsed back with `pdf-lib` `PDFDocument.load`):
- Page size by units.
- Page counts: sample kitchen = 4; kitchen with nothing on a wall = 3; closet = 2; a long parts list adds a page.
- Text checks: the document is saved without object-stream compression in tests, and the decoded content streams contain the project name, "Floor plan — 1:", "Parts list and estimate" and "page 1 of".
- A non-WinAnsi name doesn't throw.

**`layoutSummary` and `moneyFormat`:** the existing panel tests still pass, plus direct unit tests.

**SVG builders:** with `titleBlock: false`, `planToSvg` and `closetToSvg` output has no title text; the existing snapshots are unchanged.

**PDF route:** content type, filename (including the fallback), 400, 404.

**Playwright:**
- On the sample kitchen, "Duplicate as option" opens "Sample kitchen — Option B".
- "Compare options" shows two columns.
- After moving an item in the option, the compare page still renders.
- "Spec sheet (PDF)" downloads `sample-kitchen-spec-sheet.pdf`.

## Refinements made in the plan

- The compare page shows closets with `ClosetElevation`, as the home list does (the home list doesn't use `PlanThumbnail` for closets).
- The home list keeps its two-column grid: an option follows its original with an "Option" badge and a coloured left border instead of being indented.
- The layout-check detail conversion moves to `layoutDetail(detail, units)` in `src/lib/plan/layout-check.ts`, shared by the panel and the PDF. With no counted rule, the compare page and the PDF cover say "Layout check: nothing to check yet".
- In the PDF the layout-check status is a word (Pass, Fail, Info, n/a): the panel's check marks aren't in WinAnsi.
- The PDF layout helper is `src/lib/export/pdf-layout.ts`; page sizes, margins and `pickScale` are in `src/lib/export/paper.ts`. Tests read the drawn text back from the content streams with `pdfText` instead of saving uncompressed.
- PDF table cells wrap; a row that doesn't fit starts a new page under a repeated header.
- `closet/svg.ts` exports `DOOR_NAME` for the closet cover.
- The Playwright test edits a unit price in the option, not an item's position, and checks the compare page shows different totals.

## Out of scope

- A PDF of the comparison.
- Choosing which pages go in the spec sheet.
- A logo, company details or custom notes.
- Vector drawings in the PDF.
- Fonts beyond WinAnsi: unsupported characters print as "?".
- Merging options back together, or a diff of plan geometry.
- Moving a project into or out of a group after creation.
