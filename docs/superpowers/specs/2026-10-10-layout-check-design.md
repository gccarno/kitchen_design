# Layout check — design

Sub-project 1 of 4 from the 2026-10-10 feature review. The others are a parts list with cost, kitchen wall elevations, and side-by-side options with a spec sheet. Each gets its own spec.

## Purpose

Show which kitchen-planning guidelines (NKBA) the current kitchen meets and which it misses. Each line gives the measured value, so it's clear what to fix. Failed rules also go to the chat, so "fix the layout check" works.

## Decisions

- It's a **separate checklist panel**. The existing plan warnings are left unchanged, and there's no 0–100 score.
- **The chat sees failed rules** in its plan context. There are no new chat commands.
- It's for kitchens only. Closet projects get an empty list.

## Module: `src/lib/plan/layout-check.ts` (new, pure)

```ts
export type RuleStatus = 'pass' | 'fail' | 'n/a';
export interface LayoutRule {
  id: string;
  title: string;
  status: RuleStatus;
  detail: string;   // e.g. "sink ↔ range 2100 mm"; lengths in mm, the UI converts
  info?: boolean;   // shown, never counted as a failure
}
export function checkLayout(project: Project): LayoutRule[];
```

- Items are recognised by `PlacedItem.tag`, which is the first catalog tag: `fridge`, `range`, `sink`, `dishwasher`, `island`, `table`, `base`, `corner`, `tall`, `wall`, `filler`.
- It reuses the helpers in `src/lib/plan/geometry.ts` and `TALL_ITEM_MM` from `src/lib/plan/runs.ts`.
- It only looks at floor-level items (`mount` is unset or `'floor'`), except where a rule says otherwise.

## Rules

NKBA guidelines converted to mm. A rule is `n/a` when the items it needs aren't placed.

| id | Pass when |
|---|---|
| `triangle-legs` | Each of fridge↔sink↔range is 1200–2700 mm, measured centre to centre. If there are several of an item, the combination with the shortest total is used. |
| `triangle-total` | The three legs add up to 4000–7900 mm |
| `triangle-clear` | No leg crosses the footprint of an island, a table, or a floor item ≥1400 mm tall. The triangle's own three items are excluded. |
| `sink-landing` | Counter beside the sink: ≥600 mm on one side and ≥450 mm on the other |
| `range-landing` | Counter beside the range: ≥300 mm on one side and ≥380 mm on the other |
| `fridge-landing` | ≥380 mm of counter beside the fridge on either side, or an island within 1200 mm in front of it |
| `dishwasher-sink` | The nearest edges of the dishwasher and sink are ≤900 mm apart |
| `work-aisle` | From every counter front (`base`, `corner`, `sink`, `dishwasher`, `range`), the nearest floor item straight ahead within the item's width is ≥1067 mm away. Walls don't count, because the clearance warnings already cover them. |
| `counter-frontage` (info) | The total width of counter items (`base`, `corner`, `sink`, `dishwasher`, `filler`, `island`) is ≥3350 mm |

### Counter beside X

Walk outward from X, in each direction separately, through its side neighbours. Items A and B are side neighbours when all of the following hold:

- both are floor items;
- their rotations match within 1°, unless B is a corner cabinet;
- their front faces, or their back faces, lie on the same line within 50 mm;
- the gap between them along that line is ≤100 mm.

Neighbours tagged `base`, `corner`, `dishwasher`, `filler` or `sink` add their width. Any other neighbour (`range`, `fridge`, `tall`, …) ends the walk. X's own width isn't counted. The result is a pair of lengths, `[left, right]`.

Changed during implementation:
- **Backs as well as fronts.** Runs sit against a wall, so backs line up even when depths differ, for example a 900 mm corner cabinet or a deep fridge.
- **A gap of up to 100 mm.** Runs keep a fridge's 50 mm side gap and the sample kitchen leaves 80 mm. That's clearance, not a break in the counter.
- **Corner cabinets.** A corner cabinet faces the other run of an L, so any rotation is accepted. It counts toward the length, and the walk stops there because the counter turns the corner.

## UI: `src/components/LayoutCheckPanel.tsx` (new)

- It's mounted in `src/components/ProjectEditor.tsx` under the "Plan warnings" list, for kitchen projects only. It's computed with `useMemo` the same way the warnings are.
- The heading reads "Layout check — X of Y passed", where Y counts only pass and fail rules that aren't info.
- Rows are ordered with fails first, then passes, then info and n/a in muted text. Each row shows a status mark, the title and the detail, with lengths in the project's units.

## Chat: `src/lib/llm/plan-context.ts`

`describePlanForLLM` appends a `Layout check failures:` block with one line per failed rule. It's added only when at least one rule fails.

## Tests

- `src/lib/plan/layout-check.test.ts` covers pass, fail and n/a for each rule with small fixture projects, including a rotated run and a gap that breaks the neighbour chain.
- A gallery test runs `checkLayout` on the sample kitchen and the example kitchens. It snapshots the status by rule id, and checks that a kitchen with a fridge, a sink and a range never gets n/a triangle rules.
- `src/components/LayoutCheckPanel.test.tsx` checks the pass count, the row order and unit formatting.
- `plan-context.test.ts` checks that the failures block appears only when something fails.
- Playwright: the sample kitchen shows the "Layout check" panel.

## Out of scope

- Which side a fridge door opens (handle side).
- Two-cook aisle widths (1220 mm).
- Seating and walkway rules.
- Scoring weights.
