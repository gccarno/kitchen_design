# Parts list and cost estimate — design

Sub-project 2 of 4 from the 2026-10-10 feature review. It follows the layout check (Phase 8) and comes before kitchen elevations, design options and the spec sheet. The spec sheet will reuse this estimate.

## Purpose

Turn a kitchen or closet design into a priced parts list you can take to a store or a contractor. The app ships rough default prices so the list is useful straight away. Any price can be changed per project, and the list exports to CSV.

## Decisions

- **Default prices plus per-project overrides.** Defaults are generic ballpark numbers in USD and are always labelled as estimates. Overrides are stored in the project.
- **Extras:** a countertop line for kitchens, a hardware line for closets, installation as a percentage of parts, and tax as a percentage.
- **Currency** is set per project and defaults to `USD`.
- **Edits save directly** as user revisions, without a review step, and undo works. Chat commands never change pricing.

## Data: `Project.pricing` (optional)

```ts
pricing?: {
  currency: string;                      // ISO 4217 code, 3 letters; default 'USD'
  unitPrices: Record<string, number>;    // overrides by line key; ≥ 0
  countertopPerM2?: number;              // ≥ 0
  installPct?: number;                   // 0–100
  taxPct?: number;                       // 0–100
  hardwareEach?: number;                 // ≥ 0
}
```

- It's added to `ProjectSchema` in `src/lib/plan/schemas.ts`.
- `/pricing` is added to `EDITABLE_ROOTS` in `src/lib/plan/diff.ts`.
- The command compilers (`plan/commands.ts`, `closet/commands.ts`) never produce `/pricing` ops.
- A missing `pricing`, or a missing rate, means the defaults apply.

## Default prices: `src/lib/estimate/prices.ts`

```ts
export const DEFAULT_RATES = { countertopPerM2: 350, installPct: 30, taxPct: 0, hardwareEach: 4 };
export function defaultUnitPrice(key: string, catalog: Catalog): number;
```

- **Line keys:** a kitchen line's key is its `catalogId`. A closet line's key is `closet:<kind>`.
- **Seed items** (appliances, fixtures, furniture) get prices from a table keyed by catalog id.
- **Generated cabinets** are priced by formula from the first tag and the width: `base` 120 + 0.25/mm, `wall` 90 + 0.2/mm, `tall` 300 + 0.5/mm, `corner` 350 (base) or 220 (wall), `filler` 25.
- **Closet kinds** each have a price and a pricing unit:

  | Kind | Price | Unit |
  |---|---|---|
  | shelf | 30 | per m |
  | rod | 15 | per m |
  | shoe_shelf | 40 | per m |
  | hooks | 20 | per m |
  | drawers | 60 | per drawer |
  | tower | 180 | each |
  | basket | 25 | each |
  | valet_rod | 20 | each |

- A test checks that every catalog item and every closet kind has a default price above 0.

## Estimate: `src/lib/estimate/estimate.ts` (pure)

```ts
export interface EstimateLine {
  key: string;            // price key, or 'countertop' / 'hardware'
  label: string;          // e.g. "Range (760 mm)", "Shelf", "Countertop"
  quantity: number;       // count, metres, drawers, m² or ft²
  unit: 'each' | 'm' | 'drawer' | 'm²' | 'ft²';
  unitPrice: number;
  overridden: boolean;    // unitPrice comes from pricing, not the default
  total: number;
}
export interface Estimate {
  currency: string;
  lines: EstimateLine[];
  subtotal: number;
  installPct: number; install: number;
  taxPct: number; tax: number;
  total: number;
}
export function buildEstimate(project: Project, catalog: Catalog): Estimate;
```

**Kitchen**
- There's one line per distinct `catalogId` among the placed items, in order of first placement. The quantity is the count, the unit is `each`, and the label is the catalog name. An unknown catalog id uses the id as its label and is priced at 0.
- **Countertop line:** it covers floor items tagged `base`, `corner`, `sink`, `dishwasher`, `filler` or `island`. Area = Σ w × (d + 25), except corners and islands, which count w × d. The unit is m² in mm projects and ft² in inch projects, and the quantity is rounded to 0.01 so the line total matches the quantity shown. The price is `countertopPerM2`, converted to per ft² for inch projects (÷ 10.7639). The line is left out when there's nothing to put a counter on.
- The countertop rate is edited as the per-m² rate, and the panel shows the per-ft² equivalent in inch projects.

**Closet**
- There's one line per component kind present, in the order of `ClosetComponentKindSchema`.
  - Per-metre kinds: the quantity is the summed width ÷ 1000, rounded to 0.01 m.
  - Drawers: the quantity is the summed `count`, using the default when it isn't set.
  - The rest: the quantity is the number of components.
- **Hardware line** ("Hardware (brackets)"): 2 per rod, and for each shelf and shoe shelf 2 plus `floor(width / 800)`. It's priced at `hardwareEach` with the unit `each`, and left out when the count is 0.

**Totals**
- Line total = quantity × unit price.
- subtotal = Σ line totals.
- install = subtotal × installPct / 100.
- tax = (subtotal + install) × taxPct / 100.
- total = subtotal + install + tax.
- Totals are rounded to cents for display only. All arithmetic uses unrounded numbers.

## UI: `src/components/EstimatePanel.tsx`

- It's mounted as an "Estimate" section in `ProjectEditor` (kitchens) and in `ClosetEditor`.
- **Table:** line, quantity with unit, unit price, total. The unit price is a number input. Committing a changed value (on blur or Enter) saves `pricing.unitPrices[key]`. When a price is overridden, a "reset" button removes the override.
- **Rates row:** countertop per m² (kitchens), hardware each (closets), installation %, tax %, and currency. Each one saves on commit.
- **Footer:** subtotal, installation, tax and total, formatted with `Intl.NumberFormat(undefined, { style: 'currency', currency })`. An invalid currency code falls back to USD in the display.
- Text below says: "Prices are rough estimates; change any of them to match your quotes."
- **Saving** uses the same path as canvas edits. The new value goes through `proposalForPlan` (or a new `proposalForPricing(project, pricing, summary)` in `src/lib/plan/proposal.ts`), then `submitRevision`, then `saved`. Summaries read like "Set the price of Range (760 mm) to $1,200.00", "Reset the price of …", or "Set installation to 25%".
- Inputs reject negative numbers, and percentages above 100, before saving.

## Export: `GET /api/export/[id]/csv`

- The columns are `Item,Quantity,Unit,Unit price,Total`, with one row per line, then the subtotal, installation, tax and total rows.
- Numbers are plain, with 2 decimals and no currency symbol. A header comment row gives the currency.
- The response is `text/csv`, with a download filename taken from the project name, like the SVG and PNG routes.
- A "CSV" link goes beside the SVG and PNG links.

## Tests

- **`prices.test.ts`:** every catalog item and closet kind has a default above 0, and the cabinet formula is checked.
- **`estimate.test.ts`:**
  - Kitchen lines are grouped and counted.
  - The countertop area matches a hand calculation, and ft² is used in inch projects.
  - Closet metres, drawers and hardware counts.
  - The totals arithmetic.
  - Overrides set `overridden` and change the totals.
  - An unknown catalog id is priced at 0.
  - An empty project gives no lines and zero totals.
- **`schemas.test.ts` and `diff.test.ts`:** `pricing` round-trips through `/pricing` patches and undo.
- **`EstimatePanel.test.tsx`:** editing a price calls the save callback with the new pricing. Reset removes the override. Bad input isn't saved. Currency formatting is checked.
- **CSV route test:** the rows, the totals and the content type.
- **Playwright:** on the sample kitchen, change one unit price, see the total change, then undo it.

## Out of scope

- Real retailer prices or live price lookups.
- Quantity overrides.
- Discounts.
- Separate labour per item.
- Multiple currencies in one project.
