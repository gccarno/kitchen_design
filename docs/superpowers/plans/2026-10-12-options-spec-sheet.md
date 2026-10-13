# Design Options and Spec Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Copy a design as a linked option and compare options side by side; download one design as a multi-page PDF spec sheet.

**Architecture:**
- **Options** are ordinary projects. A new optional `optionOf` field holds the original's id.
- Pure helpers in `src/lib/plan/options.ts` name and order a group. `src/lib/storage/projects.ts` copies a project and finds its group.
- A duplicate route and editor button create options. A server-rendered `/compare/[groupId]` page shows them side by side.
- **The spec sheet** is built on the server with `pdf-lib`. A small layout helper (`src/lib/export/pdf-layout.ts`) handles text, wrapping tables and page breaks.
- The drawings come from the existing SVG builders, rasterized by `sharp` and placed at a standard scale.

**Tech Stack:** TypeScript, Next.js 15 App Router (server components, route handlers), React 19, Vitest with Testing Library (no jest-dom: use `toBeTruthy()` / `not.toBeNull()`), Playwright, `pdf-lib` (new, MIT), `sharp` (existing).

**Spec:** `docs/superpowers/specs/2026-10-12-options-spec-sheet-design.md`

## Global Constraints

**Lengths and money**
- All lengths are stored in mm. Text shown to the user goes through `formatLength(mm, project.units)` from `src/lib/plan/viewport.ts`.
- Money goes through `moneyFormat(currency)` from `src/lib/estimate/money.ts` (moved there in Task 58).

**Options**
- An option's group id is `project.optionOf ?? project.id`. Copies of an option point at the same original, so groups don't nest. The original is never written to.
- `optionOf` is not under `EDITABLE_ROOTS`: only duplication sets it.
- Option names are `"<group name> — Option <L>"`, with L the first unused letter from B to Z, then numbers from 27. The group name is the original's name, or, if the original is gone, the oldest option's name without its suffix.
- A duplicate has a new id, `revision: 0`, `history: []` and `createdAt`/`updatedAt` = now. It copies `kind`, `units`, `room`, `items`, `closet`, `pricing` and `photos`, including the photo files.

**Copy strings**
- "Duplicate as option", "Compare options", "Compare options — <group name>", "What differs", "These options use the same parts.", "Spec sheet (PDF)", "Kitchen spec sheet", "Closet spec sheet", "Floor plan", "Front elevation", "Wall elevations", "Parts list and estimate".
- The estimate note: "Prices are estimates from default or edited unit prices, not quotes."

**PDF**
- Letter (612 × 792 pt) when `units === 'in'`, otherwise A4 (595.28 × 841.89 pt). Portrait, with 15 mm margins (`MARGIN_PT = 42.52`).
- Footer: `<name> · <date> · revision <n> · page <i> of <m>`.
- Drawings are placed at the smallest N in `[20, 25, 50, 100]` that fits, captioned "<caption> — 1:N", or fitted and captioned "<caption> — not to scale". Rasterized at 200 dpi.
- Fonts: Helvetica and Helvetica-Bold (WinAnsi). Any character WinAnsi can't encode prints as "?".

**Routes**
- `POST /api/projects/[id]/duplicate`: 201 `{ project }`, 400 for an invalid id, 404 for an unknown project.
- `GET /api/export/[id]/pdf`: `application/pdf` with `attachment; filename="<slug>-spec-sheet.pdf"`. The slug falls back to `kitchen` or `closet`. 400 for an invalid id, 404 for an unknown project.

**Refinements to the spec** (Task 66 records them in the spec):
1. **Closet thumbnails:** the compare page shows closets with `ClosetElevation`, the same as the home list. The home list doesn't use `PlanThumbnail` for closets.
2. **Home list:** it keeps its two-column grid. Each option sits right after its original, with an "Option" badge and a coloured left border instead of indentation.
3. **Shared detail conversion:** the layout-check detail conversion ("<n> mm" → project units) moves to `layoutDetail(detail, units)` in `src/lib/plan/layout-check.ts`, used by the panel and the PDF.
4. **Empty layout check:** the compare page and the PDF cover say "Layout check: nothing to check yet" when no rule is counted. The PDF's layout page heading falls back to the panel's "Layout check — place a fridge, sink and range to start".
5. **Status words:** in the PDF, the layout-check status is a word (Pass, Fail, Info, n/a), because the panel's check marks aren't in WinAnsi.
6. **PDF modules:** the layout helper lives in `src/lib/export/pdf-layout.ts` from the start. Page sizes, margins and `pickScale` live in `src/lib/export/paper.ts`, not `spec-sheet.ts`, so the two modules don't import each other. Test text checks read the content streams back with `pdfText` (inflate, then decode windows-1252); the PDF is not saved uncompressed for tests.
7. **Wrapping cells:** PDF table cells wrap onto more lines. A row that doesn't fit moves to the next page, under a repeated header row.
8. **Closet door names:** `closet/svg.ts` exports `DOOR_NAME`, which the closet cover uses.
9. **Playwright edit:** the test edits a unit price in the option, then checks the compare page shows two different totals. This replaces "move an item", because canvas drags are slow and brittle in e2e.

## Review Focus

1. **The original was deleted, then an option is duplicated.** The new option joins the same group with the next free letter, and the compare page still works. Tested in Task 59.
2. **Project names with characters outside WinAnsi** (Chinese, emoji, narrow no-break spaces from `Intl`). The PDF still builds and shows "?" for them. Tested in Tasks 64 and 65.
3. **A long parts list or a long layout-check detail.** The table continues on the next page with its header repeated, and long cells wrap instead of running off the page. Tested in Tasks 64 and 65.
4. **Opening `/compare/<id>` with an invalid or unknown id.** You get the 404 page, not a crash. Tested in Task 62.
5. **Double-clicking "Duplicate as option".** The button is disabled while the request runs, so only one copy is made. Tested in Task 60.

---

### Task 58: Shared money and layout-check helpers

**Files:**
- Create: `src/lib/estimate/money.ts`, `src/lib/estimate/money.test.ts`, `src/lib/plan/layout-summary.test.ts`
- Modify: `src/components/EstimatePanel.tsx` (lines 6 and 15–22: move `moneyFormat` out, re-export it), `src/lib/plan/layout-check.ts` (add `layoutSummary` and `layoutDetail`), `src/components/LayoutCheckPanel.tsx` (use them)

**Interfaces:**
- Produces:
  - `moneyFormat(currency: string): Intl.NumberFormat` from `@/lib/estimate/money`. It's also still exported from `EstimatePanel.tsx`.
  - `layoutSummary(rules: LayoutRule[]): { passed: number; counted: number; ordered: LayoutRule[] }` from `@/lib/plan/layout-check`.
  - `layoutDetail(detail: string, units: 'mm' | 'in'): string` from `@/lib/plan/layout-check`.

- [ ] **Step 1: Write the failing tests**

`src/lib/estimate/money.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { moneyFormat } from './money';

describe('moneyFormat', () => {
  it('formats in the given currency', () => {
    expect(moneyFormat('EUR').resolvedOptions().currency).toBe('EUR');
    expect(moneyFormat('USD').format(1234.5)).toContain('1,234.50');
  });

  it('falls back to USD for an unknown currency code instead of throwing', () => {
    expect(moneyFormat('NOPE').resolvedOptions().currency).toBe('USD');
  });
});
```

`src/lib/plan/layout-summary.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { layoutDetail, layoutSummary, type LayoutRule } from './layout-check';

const rule = (id: string, status: LayoutRule['status'], info = false): LayoutRule => ({ id, title: id, status, detail: '', ...(info ? { info } : {}) });

describe('layoutSummary', () => {
  it('counts passes and fails, not information or rules that do not apply', () => {
    const s = layoutSummary([rule('a', 'n/a'), rule('b', 'pass'), rule('c', 'pass', true), rule('d', 'fail')]);
    expect(s.passed).toBe(1);
    expect(s.counted).toBe(2);
  });

  it('orders fails first, then passes, then information, then what does not apply', () => {
    const s = layoutSummary([rule('a', 'n/a'), rule('b', 'pass'), rule('c', 'pass', true), rule('d', 'fail')]);
    expect(s.ordered.map((r) => r.id)).toEqual(['d', 'b', 'c', 'a']);
  });
});

describe('layoutDetail', () => {
  it('writes "<n> mm" lengths in the project units', () => {
    expect(layoutDetail('aisle 1067 mm', 'mm')).toBe('aisle 1067 mm');
    const inches = layoutDetail('aisle 1067 mm, gap 600 mm', 'in');
    expect(inches).not.toContain('mm');
    expect(inches).toContain(`1' 11 1/2"`);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/estimate/money.test.ts src/lib/plan/layout-summary.test.ts`
Expected: FAIL. `./money` can't be resolved, and `layoutSummary` and `layoutDetail` aren't exported.

- [ ] **Step 3: Implement**

`src/lib/estimate/money.ts`:

```ts
import { DEFAULT_CURRENCY } from './prices';

/** A currency formatter that never throws: an unknown code falls back to USD. */
export function moneyFormat(currency: string): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency });
  } catch {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: DEFAULT_CURRENCY });
  }
}
```

In `src/components/EstimatePanel.tsx`:
- Delete the `moneyFormat` function (lines 15–22) and add:

```ts
import { moneyFormat } from '@/lib/estimate/money';

export { moneyFormat };
```

- Keep `DEFAULT_CURRENCY` in the prices import only if the panel still uses it elsewhere; lint will say.

In `src/lib/plan/layout-check.ts`:
- Add `import { formatLength } from './viewport';` with the other imports.
- Add after the `LayoutRule` interface:

```ts
/** Fails first, then passes, then information, then what doesn't apply yet. */
const displayOrder = (r: LayoutRule) => (r.status === 'n/a' ? 3 : r.info ? 2 : r.status === 'fail' ? 0 : 1);

/** How many counted rules pass (information and n/a rules aren't counted), and the rules in display order. */
export function layoutSummary(rules: LayoutRule[]): { passed: number; counted: number; ordered: LayoutRule[] } {
  const counted = rules.filter((r) => !r.info && r.status !== 'n/a');
  return {
    passed: counted.filter((r) => r.status === 'pass').length,
    counted: counted.length,
    ordered: [...rules].sort((a, b) => displayOrder(a) - displayOrder(b)),
  };
}

/** A rule's detail with its "<n> mm" lengths in the project's units. */
export function layoutDetail(detail: string, units: 'mm' | 'in'): string {
  return detail.replace(/(\d+) mm/g, (_, n: string) => formatLength(Number(n), units));
}
```

Replace `src/components/LayoutCheckPanel.tsx` with:

```tsx
import React from 'react';
import { layoutDetail, layoutSummary, type LayoutRule } from '@/lib/plan/layout-check';

const MARK: Record<LayoutRule['status'], string> = { pass: '✓', fail: '✗', 'n/a': '–' };

/** The kitchen against the NKBA planning guidelines: what passes, what fails, what doesn't apply yet. */
export default function LayoutCheckPanel({ rules, units }: { rules: LayoutRule[]; units: 'mm' | 'in' }) {
  const { passed, counted, ordered } = layoutSummary(rules);

  return (
    <div className="rounded border border-gray-200 p-2 text-sm">
      <h3 className="font-medium">
        {counted > 0 ? `Layout check — ${passed} of ${counted} passed` : 'Layout check — place a fridge, sink and range to start'}
      </h3>
      <ul aria-label="Layout check" className="mt-1 flex flex-col gap-0.5">
        {ordered.map((r) => (
          <li
            key={r.id}
            className={r.status === 'n/a' || r.info ? 'text-gray-500' : r.status === 'fail' ? 'text-red-800' : 'text-green-800'}
          >
            <span aria-hidden="true" className="inline-block w-4">
              {r.info && r.status !== 'n/a' ? 'i' : MARK[r.status]}
            </span>
            <span className="font-medium">{r.title}</span>: {layoutDetail(r.detail, units)}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass, along with the panels' existing tests**

Run: `npx vitest run src/lib/estimate src/lib/plan/layout-summary.test.ts src/lib/plan/layout-check.test.ts src/components/LayoutCheckPanel.test.tsx src/components/EstimatePanel.test.tsx`
Expected: PASS, with no changes to existing tests.

- [ ] **Step 5: Full check and commit**

Run: `npm test && npx tsc --noEmit && npm run lint`

```bash
git add src/lib/estimate/money.ts src/lib/estimate/money.test.ts src/lib/plan/layout-summary.test.ts src/lib/plan/layout-check.ts src/components/EstimatePanel.tsx src/components/LayoutCheckPanel.tsx
git commit -m "refactor: share money formatting and the layout-check summary"
```

---

### Task 59: Option groups: schema, naming, duplication in storage

**Files:**
- Create: `src/lib/plan/options.ts`, `src/lib/plan/options.test.ts`, `src/lib/storage/options.test.ts`
- Modify:
  - `src/lib/plan/schemas.ts` (`ProjectSchema`: add `optionOf`)
  - `src/lib/storage/projects.ts`: add `loadAll`, `optionGroup` and `duplicateAsOption`; `ProjectSummary` gains `createdAt` and `optionOf`
  - `src/components/ProjectList.test.tsx` (its `summary` helper gains `createdAt`)

**Interfaces:**
- Produces, from `@/lib/plan/options` (pure, safe on the client):
  - `optionGroupId(p: { id: string; optionOf?: string }): string`
  - `optionBaseName(name: string): string`
  - `nextOptionName(base: string, existingNames: string[]): string`
  - `sortGroup<T extends OptionMember>(members: T[], groupId: string): T[]`
  - `groupName(sortedMembers: OptionMember[]): string`
  - `groupForList<T extends OptionMember>(newestFirst: T[]): T[][]`
  - `type OptionMember = { id: string; name: string; createdAt: string; optionOf?: string }`
- Produces, from `@/lib/storage/projects`:
  - `optionGroup(dataDir: string, groupId: string): Project[]`
  - `duplicateAsOption(dataDir: string, sourceId: string): Project`
  - `ProjectSummary` now includes `createdAt: string` and `optionOf?: string`.

- [ ] **Step 1: Write the failing pure tests**

`src/lib/plan/options.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { groupForList, groupName, nextOptionName, optionBaseName, optionGroupId, sortGroup } from './options';

const m = (id: string, name: string, createdAt: string, optionOf?: string) => ({ id, name, createdAt, ...(optionOf ? { optionOf } : {}) });

describe('design option helpers', () => {
  it('a project names its own group until it is an option', () => {
    expect(optionGroupId({ id: 'a' })).toBe('a');
    expect(optionGroupId({ id: 'b', optionOf: 'a' })).toBe('a');
  });

  it('strips an option suffix from a name', () => {
    expect(optionBaseName('Kitchen — Option B')).toBe('Kitchen');
    expect(optionBaseName('Kitchen — Option 27')).toBe('Kitchen');
    expect(optionBaseName('Kitchen')).toBe('Kitchen');
  });

  it('names options B, C, … reusing a free letter, then numbers after Z', () => {
    expect(nextOptionName('Kitchen', ['Kitchen'])).toBe('Kitchen — Option B');
    expect(nextOptionName('Kitchen', ['Kitchen', 'Kitchen — Option B'])).toBe('Kitchen — Option C');
    expect(nextOptionName('Kitchen', ['Kitchen', 'Kitchen — Option C'])).toBe('Kitchen — Option B');
    // A renamed option frees its letter.
    expect(nextOptionName('Kitchen', ['Kitchen', 'Galley idea'])).toBe('Kitchen — Option B');
    const all = 'BCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `Kitchen — Option ${l}`);
    expect(nextOptionName('Kitchen', all)).toBe('Kitchen — Option 27');
    expect(nextOptionName('Kitchen', [...all, 'Kitchen — Option 27'])).toBe('Kitchen — Option 28');
  });

  it('orders a group: the original first, then options oldest first', () => {
    const group = sortGroup([m('c', 'K — Option C', '2026-01-03', 'a'), m('a', 'K', '2026-01-01'), m('b', 'K — Option B', '2026-01-02', 'a')], 'a');
    expect(group.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(groupName(group)).toBe('K');
  });

  it('names a group whose original is gone after its oldest option, without the suffix', () => {
    const group = sortGroup([m('c', 'K — Option C', '2026-01-03', 'a'), m('b', 'K — Option B', '2026-01-02', 'a')], 'a');
    expect(groupName(group)).toBe('K');
  });

  it('lists each group where its newest member sorts, members in group order', () => {
    const newestFirst = [m('b', 'K — Option B', '2026-01-02', 'a'), m('x', 'Bath', '2026-01-05'), m('a', 'K', '2026-01-01')];
    expect(groupForList(newestFirst).map((g) => g.map((p) => p.id))).toEqual([['a', 'b'], ['x']]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/plan/options.test.ts`
Expected: FAIL because `./options` can't be resolved.

- [ ] **Step 3: Implement `src/lib/plan/options.ts`**

```ts
/**
 * Design options: copies of a design, linked to the original by `optionOf`
 * (the group id). Pure helpers shared by storage, the home list, the editor
 * and the compare page.
 */

export type OptionMember = { id: string; name: string; createdAt: string; optionOf?: string };

const SUFFIX = / — Option (?:[A-Z]|\d+)$/;
const LETTERS = 'BCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The id that names a project's option group: its original's id. */
export function optionGroupId(p: { id: string; optionOf?: string }): string {
  return p.optionOf ?? p.id;
}

/** A name without its " — Option X" suffix. */
export function optionBaseName(name: string): string {
  return name.replace(SUFFIX, '');
}

/** "<base> — Option <L>": the first letter from B not used in the group (the original is A), then numbers from 27. */
export function nextOptionName(base: string, existingNames: string[]): string {
  const prefix = `${base} — Option `;
  const used = new Set(existingNames.filter((n) => n.startsWith(prefix)).map((n) => n.slice(prefix.length)));
  for (const letter of LETTERS) if (!used.has(letter)) return prefix + letter;
  let n = 27;
  while (used.has(String(n))) n++;
  return prefix + n;
}

/** A group's members in order: the original first, then the options oldest first. */
export function sortGroup<T extends OptionMember>(members: T[], groupId: string): T[] {
  return [...members].sort(
    (a, b) => Number(b.id === groupId) - Number(a.id === groupId) || a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name)
  );
}

/** The group's name: the original's, or, with it gone, the oldest option's without its suffix. */
export function groupName(sortedMembers: OptionMember[]): string {
  return optionBaseName(sortedMembers[0]?.name ?? '');
}

/** The home list's order: each group where its newest member sorts (input is newest first), members in group order. */
export function groupForList<T extends OptionMember>(newestFirst: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const p of newestFirst) {
    const id = optionGroupId(p);
    groups.set(id, [...(groups.get(id) ?? []), p]);
  }
  return [...groups.entries()].map(([id, members]) => sortGroup(members, id));
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/plan/options.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing storage tests**

`src/lib/storage/options.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject, duplicateAsOption, listProjects, loadProject, optionGroup, projectDir, saveProject } from './projects';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';

describe('design options in storage', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'kd-options-'));
  });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  /** A kitchen with an item, prices, a photo on disk and some history to leave behind. */
  function kitchen(name = 'Our kitchen') {
    const p = createProject(dataDir, { name });
    saveProject(dataDir, {
      ...loadProject(dataDir, p.id),
      items: [{ id: 'i1', catalogId: 'base-600x560x720', tag: 'base', sizeMm: { w: 600, d: 560, h: 720 }, position: { x: 500, y: 500 }, rotationDeg: 0 }],
      pricing: { currency: 'EUR', unitPrices: { 'base-600x560x720': 99 } },
      photos: [{ id: 'ph1', path: 'photos/ph1.jpg', width: 10, height: 10 }],
      revision: 3,
    });
    writeFileSync(join(projectDir(dataDir, p.id), 'photos', 'ph1.jpg'), 'jpeg bytes');
    return loadProject(dataDir, p.id);
  }

  it('copies a design as Option B: new id, fresh history, same plan, prices and photos; the original is untouched', () => {
    const original = kitchen();
    const before = readFileSync(join(projectDir(dataDir, original.id), 'project.json'), 'utf-8');
    const b = duplicateAsOption(dataDir, original.id);
    expect(b.id).not.toBe(original.id);
    expect(b).toMatchObject({
      name: 'Our kitchen — Option B',
      optionOf: original.id,
      kind: 'kitchen',
      units: original.units,
      revision: 0,
      history: [],
      room: original.room,
      items: original.items,
      pricing: original.pricing,
      photos: original.photos,
    });
    expect(loadProject(dataDir, b.id)).toEqual(b);
    expect(readFileSync(join(projectDir(dataDir, b.id), 'photos', 'ph1.jpg'), 'utf-8')).toBe('jpeg bytes');
    expect(readFileSync(join(projectDir(dataDir, original.id), 'project.json'), 'utf-8')).toBe(before);
  });

  it('an option of an option joins the original group as the next letter', () => {
    const original = kitchen();
    const b = duplicateAsOption(dataDir, original.id);
    const c = duplicateAsOption(dataDir, b.id);
    expect(c.optionOf).toBe(original.id);
    expect(c.name).toBe('Our kitchen — Option C');
    expect(optionGroup(dataDir, original.id).map((p) => p.name)).toEqual(['Our kitchen', 'Our kitchen — Option B', 'Our kitchen — Option C']);
  });

  it('keeps the group together when the original is deleted, and names the next option after it', () => {
    const original = kitchen();
    const b = duplicateAsOption(dataDir, original.id);
    duplicateAsOption(dataDir, b.id);
    rmSync(projectDir(dataDir, original.id), { recursive: true, force: true });
    expect(optionGroup(dataDir, original.id).map((p) => p.name)).toEqual(['Our kitchen — Option B', 'Our kitchen — Option C']);
    expect(duplicateAsOption(dataDir, b.id).name).toBe('Our kitchen — Option D');
  });

  it('copies a closet with its closet', () => {
    const closet = createProject(dataDir, { name: 'Hall closet', kind: 'closet' });
    const b = duplicateAsOption(dataDir, closet.id);
    expect(b.kind).toBe('closet');
    expect(b.closet).toEqual(closet.closet);
  });

  it('still copies when a listed photo file is missing on disk', () => {
    const original = kitchen();
    rmSync(join(projectDir(dataDir, original.id), 'photos', 'ph1.jpg'));
    expect(duplicateAsOption(dataDir, original.id).photos).toEqual(original.photos);
  });

  it('throws for an unknown source', () => {
    expect(() => duplicateAsOption(dataDir, UNKNOWN)).toThrow(/not found/i);
  });

  it('finds nothing for an unknown or invalid group id; a lone project is a group of one', () => {
    const lone = kitchen('Cabin');
    expect(optionGroup(dataDir, UNKNOWN)).toEqual([]);
    expect(optionGroup(dataDir, '../etc')).toEqual([]);
    expect(optionGroup(dataDir, lone.id).map((p) => p.id)).toEqual([lone.id]);
  });

  it('lists options with their link and creation time', () => {
    const original = kitchen();
    const b = duplicateAsOption(dataDir, original.id);
    const listed = listProjects(dataDir).find((p) => p.id === b.id)!;
    expect(listed.optionOf).toBe(original.id);
    expect(listed.createdAt).toBe(b.createdAt);
    expect(listProjects(dataDir).find((p) => p.id === original.id)!.optionOf).toBeUndefined();
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run src/lib/storage/options.test.ts`
Expected: FAIL because `duplicateAsOption` and `optionGroup` aren't exported.

- [ ] **Step 7: Implement**

In `src/lib/plan/schemas.ts`, add `optionOf` to `ProjectSchema` after `kind: ProjectKindSchema.optional(),`:

```ts
  /** Set on a design option: the id of the original design it was copied from (`plan/options.ts`). */
  optionOf: z.string().min(1).optional(),
```

In `src/lib/storage/projects.ts`:

1. Add `copyFileSync` to the `node:fs` import.
2. Add `import { groupName, nextOptionName, optionGroupId, sortGroup } from '../plan/options';`.
3. Replace the `ProjectSummary` type and `listProjects` (lines 178–216) with:

```ts
/** What the project list page shows: name, last change, option link, and enough of the plan to draw a thumbnail. */
export type ProjectSummary = Pick<
  Project,
  'id' | 'name' | 'kind' | 'createdAt' | 'updatedAt' | 'revision' | 'room' | 'items' | 'closet' | 'optionOf'
>;

/**
 * Every project under `dataDir` that parses. Malformed ones are skipped
 * (surfaced via logs, not thrown — one bad project shouldn't break a list).
 */
function loadAll(dataDir: string): Project[] {
  const root = join(dataDir, 'projects');
  if (!existsSync(root)) return [];
  const out: Project[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(root, entry.name, 'project.json');
    if (!existsSync(file)) continue;
    try {
      out.push(ProjectSchema.parse(JSON.parse(readFileSync(file, 'utf-8'))));
    } catch {
      // Skip malformed projects — surfaced via logs, not errors.
      continue;
    }
  }
  return out;
}

/** List all projects under `dataDir`, newest first. */
export function listProjects(dataDir: string): ProjectSummary[] {
  return loadAll(dataDir)
    .map((project) => ({
      id: project.id,
      name: project.name,
      kind: projectKind(project),
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      revision: project.revision,
      room: project.room,
      items: project.items,
      ...(project.closet ? { closet: project.closet } : {}),
      ...(project.optionOf ? { optionOf: project.optionOf } : {}),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** The projects in option group `groupId`: the original first (if it still exists), then its options oldest first. */
export function optionGroup(dataDir: string, groupId: string): Project[] {
  if (!isValidProjectId(groupId)) return [];
  return sortGroup(
    loadAll(dataDir).filter((p) => optionGroupId(p) === groupId),
    groupId
  );
}

/**
 * Copy a project as a new design option: a new id and a fresh history,
 * linked to its group's original by `optionOf`, named "<group> — Option <L>",
 * with its photo files copied. The source is not changed.
 */
export function duplicateAsOption(dataDir: string, sourceId: string): Project {
  const source = loadProject(dataDir, sourceId);
  const groupId = optionGroupId(source);
  const group = optionGroup(dataDir, groupId);
  const now = new Date().toISOString();
  const id = randomUUID();
  const { history: _history, ...rest } = source;
  const copy: Project = ProjectSchema.parse({
    ...rest,
    id,
    name: nextOptionName(groupName(group), group.map((p) => p.name)),
    createdAt: now,
    updatedAt: now,
    revision: 0,
    optionOf: groupId,
    history: [],
  });

  const fromDir = join(projectDir(dataDir, source.id), 'photos');
  const toDir = join(projectDir(dataDir, id), 'photos');
  mkdirSync(toDir, { recursive: true });
  for (const photo of source.photos) {
    const file = `${photo.id}.jpg`;
    if (existsSync(join(fromDir, file))) copyFileSync(join(fromDir, file), join(toDir, file));
  }
  atomicWriteJson(join(projectDir(dataDir, id), 'project.json'), copy);
  return copy;
}
```

In `src/components/ProjectList.test.tsx`, add `createdAt` to the `summary` helper (line 34) so it still satisfies `ProjectSummary`:

```ts
const summary = (id: string, name: string, revision: number): ProjectSummary => ({
  id,
  name,
  revision,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-30T23:30:00.000Z',
  room: base.room,
  items: base.items,
});
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/lib/plan/options.test.ts src/lib/storage src/components/ProjectList.test.tsx src/app/api/projects`
Expected: PASS. The existing `listProjects` tests still pass.

- [ ] **Step 9: Full check and commit**

Run: `npm test && npx tsc --noEmit && npm run lint`

```bash
git add src/lib/plan/options.ts src/lib/plan/options.test.ts src/lib/storage/options.test.ts src/lib/plan/schemas.ts src/lib/storage/projects.ts src/components/ProjectList.test.tsx
git commit -m "feat(storage): design options — copy a project as a linked option, find its group"
```

---

### Task 60: Duplicate route and the editor's option controls

**Files:**
- Create: `src/app/api/projects/[id]/duplicate/route.ts`, `src/app/api/projects/[id]/duplicate/route.test.ts`
- Modify:
  - `src/components/ProjectEditor.tsx`: new props `optionCount?` and `groupId?`, the "Duplicate as option" button and the "Compare options" link
  - `src/components/ProjectEditor.test.tsx`
  - `src/app/project/[id]/page.tsx`: pass `groupId` and `optionCount`

**Interfaces:**
- Consumes: `duplicateAsOption` and `optionGroup` (Task 59); `optionGroupId` (Task 59).
- Produces:
  - `POST /api/projects/[id]/duplicate` → 201 `{ project: Project }`.
  - `ProjectEditor({ initialProject, optionCount?, groupId? })`.

- [ ] **Step 1: Write the failing route test**

`src/app/api/projects/[id]/duplicate/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject, loadProject } from '@/lib/storage/projects';
import type { Project } from '@/lib/plan/schemas';
import { POST } from './route';

const post = (id: string) => POST(new Request(`http://localhost/api/projects/${id}/duplicate`, { method: 'POST' }), { params: Promise.resolve({ id }) });

describe('POST /api/projects/[id]/duplicate', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'kd-duplicate-'));
    process.env.DATA_DIR = dataDir;
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('copies the project as an option and returns it (201)', async () => {
    const original = createProject(dataDir, { name: 'Our kitchen' });
    const res = await post(original.id);
    expect(res.status).toBe(201);
    const { project } = (await res.json()) as { project: Project };
    expect(project.name).toBe('Our kitchen — Option B');
    expect(project.optionOf).toBe(original.id);
    expect(loadProject(dataDir, project.id)).toEqual(project);
  });

  it('400s an invalid id and 404s an unknown project', async () => {
    expect((await post('../etc')).status).toBe(400);
    const res = await post('00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('project not found');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run "src/app/api/projects/[id]/duplicate"`
Expected: FAIL because `./route` can't be resolved.

- [ ] **Step 3: Implement the route**

`src/app/api/projects/[id]/duplicate/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { duplicateAsOption, isValidProjectId, projectExists, resolveDataDir } from '@/lib/storage/projects';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/projects/[id]/duplicate — copies the project as a new design option.
 *   201 { project } · 400 invalid id · 404 unknown project
 */
export async function POST(_req: Request, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  if (!isValidProjectId(id)) return NextResponse.json({ error: 'invalid project id' }, { status: 400 });
  const dataDir = resolveDataDir();
  if (!projectExists(dataDir, id)) return NextResponse.json({ error: 'project not found' }, { status: 404 });
  return NextResponse.json({ project: duplicateAsOption(dataDir, id) }, { status: 201 });
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run "src/app/api/projects/[id]/duplicate"`
Expected: PASS.

- [ ] **Step 5: Write the failing editor tests**

In `src/components/ProjectEditor.test.tsx`, add below the existing `vi.mock('./FloorPlanCanvas', …)` block:

```ts
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
```

Add `push.mockClear();` to the existing `beforeEach`. Then add these tests inside `describe('ProjectEditor', …)`. They use the file's existing `project` fixture and `json` helper.

```tsx
  it('duplicates the project as an option and opens the copy', async () => {
    fetchMock.mockResolvedValueOnce(json({ project: { ...project, id: 'copy-id', name: `${project.name} — Option B` } }, 201));
    render(<ProjectEditor initialProject={project} />);
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate as option' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/project/copy-id'));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/projects/${project.id}/duplicate`);
    expect(init.method).toBe('POST');
  });

  it('disables Duplicate as option while the copy is being made, so a double click makes one copy', () => {
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    render(<ProjectEditor initialProject={project} />);
    const button = screen.getByRole('button', { name: 'Duplicate as option' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('says why a duplicate failed and lets you try again', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'project not found' }, 404));
    render(<ProjectEditor initialProject={project} />);
    const button = screen.getByRole('button', { name: 'Duplicate as option' });
    fireEvent.click(button);
    expect((await screen.findByRole('alert')).textContent).toContain('project not found');
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it('links to the comparison only when the project has options', () => {
    const { unmount } = render(<ProjectEditor initialProject={project} />);
    expect(screen.queryByRole('link', { name: 'Compare options' })).toBeNull();
    unmount();
    const one = render(<ProjectEditor initialProject={project} groupId="g-1" optionCount={1} />);
    expect(screen.queryByRole('link', { name: 'Compare options' })).toBeNull();
    one.unmount();
    render(<ProjectEditor initialProject={project} groupId="g-1" optionCount={2} />);
    expect(screen.getByRole('link', { name: 'Compare options' }).getAttribute('href')).toBe('/compare/g-1');
  });
```

If the file's tests reset the editor store between renders in a particular way (for example `useEditorStore.setState`), follow that pattern for the unmount/re-render test.

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest run src/components/ProjectEditor.test.tsx`
Expected: FAIL. There's no "Duplicate as option" button and no "Compare options" link.

- [ ] **Step 7: Implement the editor controls and the page props**

In `src/components/ProjectEditor.tsx`:

1. Add `import { useRouter } from 'next/navigation';`.
2. Change the signature:

```tsx
interface ProjectEditorProps {
  initialProject: Project;
  /** How many projects share this one's option group (from the server); the compare link needs two. */
  optionCount?: number;
  /** The option group's id (from the server). */
  groupId?: string;
}

export default function ProjectEditor({ initialProject, optionCount, groupId }: ProjectEditorProps) {
```

3. After the `reviewRef` line, add:

```tsx
  const router = useRouter();
  const [duplicating, setDuplicating] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
```

4. After `savePricing`, add:

```tsx
  // Copy the design as a new option and open the copy. The button stays
  // disabled until the page changes, so a double click makes one copy.
  async function duplicate() {
    if (duplicating) return;
    setDuplicating(true);
    setDuplicateError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/duplicate`, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { project?: Project; error?: string };
      if (!res.ok || !body.project) throw new Error(body.error ?? `could not duplicate (${res.status})`);
      router.push(`/project/${body.project.id}`);
    } catch (err) {
      setDuplicateError((err as Error).message);
      setDuplicating(false);
    }
  }
```

5. In the header, after the closing `</div>` of the download links (line 130), add:

```tsx
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button
            type="button"
            className="rounded border px-3 py-1 disabled:opacity-40"
            disabled={duplicating}
            onClick={() => void duplicate()}
          >
            Duplicate as option
          </button>
          {groupId && (optionCount ?? 0) >= 2 && (
            <Link className="text-blue-700 underline" href={`/compare/${groupId}`}>
              Compare options
            </Link>
          )}
        </div>
        {duplicateError && (
          <p role="alert" className="text-sm text-red-700">
            Couldn’t duplicate: {duplicateError}
          </p>
        )}
```

Replace `src/app/project/[id]/page.tsx`'s imports and `ProjectPage` with:

```tsx
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ProjectEditor from '@/components/ProjectEditor';
import { optionGroupId } from '@/lib/plan/options';
import { isValidProjectId, loadProject, optionGroup, projectExists, resolveDataDir } from '@/lib/storage/projects';
```

```tsx
export default async function ProjectPage({ params }: Props) {
  const project = find((await params).id);
  if (!project) notFound();
  const groupId = optionGroupId(project);
  const optionCount = optionGroup(resolveDataDir(), groupId).length;
  return <ProjectEditor initialProject={project} groupId={groupId} optionCount={optionCount} />;
}
```

Leave `find` and `generateMetadata` unchanged.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/components/ProjectEditor.test.tsx "src/app/api/projects"`
Expected: PASS.

- [ ] **Step 9: Full check and commit**

Run: `npm test && npx tsc --noEmit && npm run lint`

```bash
git add "src/app/api/projects/[id]/duplicate" src/components/ProjectEditor.tsx src/components/ProjectEditor.test.tsx "src/app/project/[id]/page.tsx"
git commit -m "feat: duplicate a design as an option from the editor; link to the comparison"
```

---

### Task 61: Options grouped on the home page

**Files:**
- Modify: `src/components/ProjectList.tsx`, `src/components/ProjectList.test.tsx`

**Interfaces:**
- Consumes: `groupForList` (Task 59); `ProjectSummary.optionOf` and `ProjectSummary.createdAt` (Task 59).

- [ ] **Step 1: Write the failing test**

Add to `src/components/ProjectList.test.tsx`, inside `describe('ProjectList', …)`:

```tsx
  it('lists each option right after its original, with an Option badge', () => {
    const at = (day: string) => `2026-03-0${day}T00:00:00.000Z`;
    const original: ProjectSummary = { ...summary(A, 'Kitchen', 0), createdAt: at('1'), updatedAt: at('1') };
    const other: ProjectSummary = { ...summary(B, 'Bathroom', 0), createdAt: at('2'), updatedAt: at('3') };
    const C = '5b3b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6d';
    const option: ProjectSummary = { ...summary(C, 'Kitchen — Option B', 0), optionOf: A, createdAt: at('4'), updatedAt: at('5') };
    // Newest first, as listProjects returns them.
    render(<ProjectList projects={[option, other, original]} />);
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([`/project/${A}`, `/project/${C}`, `/project/${B}`]);
    const cards = screen.getAllByRole('listitem');
    expect(within(cards[1]).getByText('Option')).toBeTruthy();
    expect(within(cards[0]).queryByText('Option')).toBeNull();
    expect(within(cards[2]).queryByText('Option')).toBeNull();
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/ProjectList.test.tsx`
Expected: FAIL. The order is the input order, and there's no badge.

- [ ] **Step 3: Implement**

In `src/components/ProjectList.tsx`:

1. Add `import { groupForList } from '@/lib/plan/options';`.
2. Change the list's map and the `<li>` to:

```tsx
    <ul className="grid gap-4 sm:grid-cols-2">
      {/* Each design's options follow it, marked, so a group reads together. */}
      {groupForList(projects).flat().map((p) => (
        <li key={p.id} className={`flex flex-col gap-2 rounded border p-3${p.optionOf ? ' border-l-4 border-l-sky-400' : ''}`}>
```

3. Next to the Closet badge (line 82), add:

```tsx
                {p.optionOf && <span className="rounded bg-sky-100 px-1.5 text-xs font-normal text-sky-800">Option</span>}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/components/ProjectList.test.tsx`
Expected: PASS, including the existing tests.

- [ ] **Step 5: Full check and commit**

Run: `npm test && npx tsc --noEmit && npm run lint`

```bash
git add src/components/ProjectList.tsx src/components/ProjectList.test.tsx
git commit -m "feat: group design options with their original on the home page"
```

---

### Task 62: The compare page

**Files:**
- Create:
  - `src/lib/estimate/compare.ts` and `src/lib/estimate/compare.test.ts`
  - `src/components/CompareOptions.tsx` and `src/components/CompareOptions.test.tsx`
  - `src/app/compare/[groupId]/page.tsx` and `src/app/compare/[groupId]/page.test.tsx`

**Interfaces:**
- **Consumes:**
  - `buildEstimate` and `Estimate` from `@/lib/estimate/estimate`
  - `moneyFormat` and `layoutSummary` (Task 58)
  - `checkLayout` from `@/lib/plan/layout-check`
  - `groupName` and `optionGroup` (Task 59)
  - `PlanThumbnail({ room, items, label, className })` and `ClosetElevation({ closet, label, className })`
- **Produces:**
  - `partDifferences(estimates: Estimate[]): PartDifference[]`, where `PartDifference = { key: string; label: string; unit: string; quantities: number[] }`.
  - `CompareOptions({ projects, catalog }: { projects: Project[]; catalog: Catalog })`.
  - The page `/compare/[groupId]`.

- [ ] **Step 1: Write the failing tests**

`src/lib/estimate/compare.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Estimate, EstimateLine } from './estimate';
import { partDifferences } from './compare';

const line = (key: string, label: string, quantity: number, unit: EstimateLine['unit'] = 'each'): EstimateLine => ({
  key, label, quantity, unit, unitPrice: 1, overridden: false, total: quantity,
});
const est = (lines: EstimateLine[]): Estimate => ({ currency: 'USD', lines, subtotal: 0, installPct: 0, install: 0, taxPct: 0, tax: 0, total: 0 });

describe('partDifferences', () => {
  it('lists the lines whose quantity differs, a missing line counting as 0, sorted by label', () => {
    const rows = partDifferences([
      est([line('b', 'Base cabinet', 2), line('s', 'Sink base', 1), line('ct', 'Countertop', 1.5, 'm²')]),
      est([line('b', 'Base cabinet', 3), line('s', 'Sink base', 1), line('ct', 'Countertop', 1.5, 'm²'), line('d', 'Dishwasher', 1)]),
    ]);
    expect(rows).toEqual([
      { key: 'b', label: 'Base cabinet', unit: 'each', quantities: [2, 3] },
      { key: 'd', label: 'Dishwasher', unit: 'each', quantities: [0, 1] },
    ]);
  });

  it('finds nothing when every estimate uses the same parts', () => {
    expect(partDifferences([est([line('b', 'Base', 2)]), est([line('b', 'Base', 2)])])).toEqual([]);
  });
});
```

`src/components/CompareOptions.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import React from 'react';
import CompareOptions from './CompareOptions';
import { loadCatalog } from '@/lib/catalog/loader';
import { newCloset } from '@/lib/closet/catalog';
import { ProjectSchema, type PlacedItem, type Project } from '@/lib/plan/schemas';

const catalog = loadCatalog();
const project = (id: string, name: string, items: PlacedItem[], over: Partial<Project> = {}): Project =>
  ProjectSchema.parse({
    id, name, kind: 'kitchen', units: 'mm', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 0, photos: [],
    room: { polygon: [[0, 0], [3000, 0], [3000, 4000], [0, 4000]], walls: ['a', 'b', 'c', 'd'].map((w) => ({ id: w, thicknessMm: 100 })), openings: [] },
    items, history: [], ...over,
  });
const base = (id: string, x: number): PlacedItem => ({ id, catalogId: 'base-600x560x720', tag: 'base', sizeMm: { w: 600, d: 560, h: 720 }, position: { x, y: 330 }, rotationDeg: 0 });
const dishwasher: PlacedItem = { id: 'dw', catalogId: 'dishwasher-600', tag: 'dishwasher', sizeMm: { w: 600, d: 580, h: 850 }, position: { x: 2100, y: 340 }, rotationDeg: 0 };

describe('CompareOptions', () => {
  it('shows a column per option in order, linked to its editor, with totals and the layout check', () => {
    const a = project('a', 'Kitchen', [base('b1', 400)]);
    const b = project('b', 'Kitchen — Option B', [base('b1', 400), base('b2', 1000), dishwasher], { optionOf: 'a' });
    render(<CompareOptions projects={[a, b]} catalog={catalog} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Compare options — Kitchen' })).toBeTruthy();
    expect(screen.getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual(['/project/a', '/project/b']);
    expect(screen.getAllByText(/^Total /)).toHaveLength(2);
    expect(screen.getAllByText(/^Subtotal /)).toHaveLength(2);
    expect(screen.getAllByText(/^Layout check: /)).toHaveLength(2);
    expect(screen.getByText('1 item')).toBeTruthy();
    expect(screen.getByText('3 items')).toBeTruthy();
  });

  it('tabulates the parts that differ, a part missing from one option showing 0', () => {
    const a = project('a', 'Kitchen', [base('b1', 400)]);
    const b = project('b', 'Kitchen — Option B', [base('b1', 400), dishwasher], { optionOf: 'a' });
    render(<CompareOptions projects={[a, b]} catalog={catalog} />);
    const table = screen.getByRole('table', { name: 'What differs' });
    const name = catalog.byId.get('dishwasher-600')!.name;
    const row = within(table).getAllByRole('row').find((r) => r.textContent?.startsWith(name))!;
    expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual(['0', '1']);
  });

  it('says so when the options use the same parts', () => {
    const a = project('a', 'Kitchen', [base('b1', 400)]);
    const b = project('b', 'Kitchen — Option B', [base('b1', 1200)], { optionOf: 'a' });
    render(<CompareOptions projects={[a, b]} catalog={catalog} />);
    expect(screen.getByText('These options use the same parts.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows closets by their front, without a layout check', () => {
    const closet = newCloset();
    const a = project('a', 'Hall closet', [], { kind: 'closet', closet });
    const b = project('b', 'Hall closet — Option B', [], { kind: 'closet', closet, optionOf: 'a' });
    render(<CompareOptions projects={[a, b]} catalog={catalog} />);
    expect(screen.getByRole('img', { name: 'Elevation of Hall closet' })).toBeTruthy();
    expect(screen.queryByText(/^Layout check: /)).toBeNull();
  });
});
```

`src/app/compare/[groupId]/page.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject, duplicateAsOption } from '@/lib/storage/projects';
import ComparePage from './page';

const page = (groupId: string) => ComparePage({ params: Promise.resolve({ groupId }) });

describe('/compare/[groupId]', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'kd-compare-'));
    process.env.DATA_DIR = dataDir;
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('renders a group', async () => {
    const original = createProject(dataDir, { name: 'Kitchen' });
    duplicateAsOption(dataDir, original.id);
    expect(await page(original.id)).toBeTruthy();
  });

  it('is not found for an invalid or unknown group id', async () => {
    await expect(page('../etc')).rejects.toThrow();
    await expect(page('00000000-0000-4000-8000-000000000000')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/estimate/compare.test.ts src/components/CompareOptions.test.tsx "src/app/compare"`
Expected: FAIL because the modules can't be resolved.

- [ ] **Step 3: Implement**

`src/lib/estimate/compare.ts`:

```ts
import type { Estimate } from './estimate';

export interface PartDifference {
  key: string;
  label: string;
  unit: string;
  /** One per estimate, in order; 0 where the estimate has no such line. */
  quantities: number[];
}

/** The estimate lines whose quantity isn't the same in every estimate (a missing line counts as 0), sorted by label. */
export function partDifferences(estimates: Estimate[]): PartDifference[] {
  const meta = new Map<string, { label: string; unit: string }>();
  for (const e of estimates) for (const l of e.lines) if (!meta.has(l.key)) meta.set(l.key, { label: l.label, unit: l.unit });
  const rows: PartDifference[] = [];
  for (const [key, { label, unit }] of meta) {
    const quantities = estimates.map((e) => e.lines.find((l) => l.key === key)?.quantity ?? 0);
    if (quantities.some((q) => q !== quantities[0])) rows.push({ key, label, unit, quantities });
  }
  return rows.sort((a, b) => a.label.localeCompare(b.label));
}
```

`src/components/CompareOptions.tsx`:

```tsx
import React from 'react';
import Link from 'next/link';
import ClosetElevation from './ClosetElevation';
import PlanThumbnail from './PlanThumbnail';
import type { Catalog } from '@/lib/catalog/loader';
import { partDifferences } from '@/lib/estimate/compare';
import { buildEstimate } from '@/lib/estimate/estimate';
import { moneyFormat } from '@/lib/estimate/money';
import { checkLayout, layoutSummary } from '@/lib/plan/layout-check';
import { groupName } from '@/lib/plan/options';
import type { Project } from '@/lib/plan/schemas';

const quantity = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const count = (n: number) => `${n} item${n === 1 ? '' : 's'}`;

/** Design options side by side — thumbnail, estimate, layout check, item count — then the parts that differ. Read-only. */
export default function CompareOptions({ projects, catalog }: { projects: Project[]; catalog: Catalog }) {
  const estimates = projects.map((p) => buildEstimate(p, catalog));
  const differences = partDifferences(estimates);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Compare options — {groupName(projects)}</h1>

      <ul aria-label="Options" className="flex gap-4 overflow-x-auto pb-2">
        {projects.map((p, i) => {
          const money = moneyFormat(estimates[i].currency);
          const layout = p.closet ? null : layoutSummary(checkLayout(p));
          const failed = layout?.ordered.filter((r) => r.status === 'fail' && !r.info) ?? [];
          return (
            <li key={p.id} className="flex min-w-[220px] flex-1 flex-col gap-2 rounded border p-3 text-sm">
              <Link href={`/project/${p.id}`} className="font-medium text-blue-700 underline">
                {p.name}
              </Link>
              {p.closet ? (
                <ClosetElevation closet={p.closet} label={`Elevation of ${p.name}`} className="h-40 w-full rounded border bg-white" />
              ) : (
                <PlanThumbnail room={p.room} items={p.items} label={`Plan of ${p.name}`} className="h-40 w-full rounded border bg-white" />
              )}
              <span className="font-medium">Total {money.format(estimates[i].total)}</span>
              <span className="text-gray-600">Subtotal {money.format(estimates[i].subtotal)}</span>
              {layout && (
                <div className="flex flex-col">
                  <span>
                    {layout.counted > 0 ? `Layout check: ${layout.passed} of ${layout.counted} passed` : 'Layout check: nothing to check yet'}
                  </span>
                  {failed.length > 0 && (
                    <ul aria-label={`Failed checks for ${p.name}`} className="list-disc pl-5 text-red-800">
                      {failed.map((r) => (
                        <li key={r.id}>{r.title}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <span>{count(p.closet ? p.closet.components.length : p.items.length)}</span>
            </li>
          );
        })}
      </ul>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">What differs</h2>
        {differences.length === 0 ? (
          <p className="text-sm text-gray-600">These options use the same parts.</p>
        ) : (
          <div className="overflow-x-auto">
            <table aria-label="What differs" className="text-sm">
              <thead>
                <tr>
                  <th scope="col" className="pr-4 text-left">Part</th>
                  {projects.map((p) => (
                    <th key={p.id} scope="col" className="pr-4 text-right">{p.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {differences.map((d) => (
                  <tr key={d.key}>
                    <th scope="row" className="pr-4 text-left font-normal">
                      {d.label}
                      {d.unit === 'each' ? '' : ` (${d.unit})`}
                    </th>
                    {d.quantities.map((q, i) => (
                      <td key={projects[i].id} className="pr-4 text-right">{quantity(q)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
```

`src/app/compare/[groupId]/page.tsx`:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import CompareOptions from '@/components/CompareOptions';
import { loadCatalog } from '@/lib/catalog/loader';
import { groupName } from '@/lib/plan/options';
import { optionGroup, resolveDataDir } from '@/lib/storage/projects';

// Always read the projects from disk; they change on every save.
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ groupId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const group = optionGroup(resolveDataDir(), (await params).groupId);
  return { title: group.length > 0 ? `Compare options — ${groupName(group)} · Home Design` : 'Options not found' };
}

export default async function ComparePage({ params }: Props) {
  const group = optionGroup(resolveDataDir(), (await params).groupId);
  if (group.length === 0) notFound();
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-4 sm:p-8">
      <Link href="/" className="text-sm text-gray-600 underline">
        All projects
      </Link>
      <CompareOptions projects={group} catalog={loadCatalog()} />
    </main>
  );
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run src/lib/estimate/compare.test.ts src/components/CompareOptions.test.tsx "src/app/compare"`
Expected: PASS.

Notes:
- The "same parts" test moves one base cabinet. The countertop area doesn't change, so no row differs.
- If vitest's environment for `page.test.tsx` is jsdom and Next's `notFound` behaves differently there, the test still only needs `rejects.toThrow()`.

- [ ] **Step 5: Full check and commit**

Run: `npm test && npx tsc --noEmit && npm run lint`

```bash
git add src/lib/estimate/compare.ts src/lib/estimate/compare.test.ts src/components/CompareOptions.tsx src/components/CompareOptions.test.tsx "src/app/compare"
git commit -m "feat: compare design options side by side"
```

---

### Task 63: Drawings for the spec sheet: no title blocks, one wall alone, standard scales

**Files:**
- Create: `src/lib/export/paper.ts` (page sizes and scales), `src/lib/export/spec-drawings.test.ts`
- Modify:
  - `src/lib/plan/svg.ts`: `SvgOptions.titleBlock`
  - `src/lib/closet/svg.ts`: `titleBlock` option; export `DOOR_NAME`
  - `src/lib/plan/elevation-svg.ts`: add `wallElevationSvg`

**Interfaces:**
- Consumes: `elevationDrawing`, `elevationFrame` and `WallElevation` (Phase 10); `shapeToSvg`.
- Produces:
  - `planToSvg(project, { titleBlock?: boolean, ... })` and `closetToSvg(project, { date?, titleBlock? })`. Both default to `true`, so their output is unchanged.
  - `DOOR_NAME: Record<ClosetDoorStyle, string>` from `@/lib/closet/svg`.
  - `wallElevationSvg(e: WallElevation, units: 'mm' | 'in'): string`. It's framed by `elevationFrame(e)` and sized at 1:SVG_SCALE.
  - From `@/lib/export/paper`:
    - `PAGE = { letter: [612, 792], a4: [595.28, 841.89] }`
    - `MARGIN_PT = 42.52`
    - `PT_MM = 25.4 / 72`
    - `STANDARD_SCALES = [20, 25, 50, 100]`
    - `pickScale(drawingMm: { w: number; h: number }, boxPt: { w: number; h: number }): number | null`
    - `svgViewBoxSize(svg: string): { w: number; h: number }`

- [ ] **Step 1: Write the failing tests**

`src/lib/export/spec-drawings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { loadCatalog } from '../catalog/loader';
import { newCloset } from '../closet/catalog';
import { closetToSvg } from '../closet/svg';
import { wallElevations } from '../plan/elevation';
import { elevationFrame } from '../plan/elevation-drawing';
import { wallElevationSvg } from '../plan/elevation-svg';
import { buildSampleKitchen } from '../plan/sample-kitchen';
import { ProjectSchema, type Project } from '../plan/schemas';
import { planToSvg } from '../plan/svg';
import { pickScale, svgViewBoxSize } from './paper';

const catalog = loadCatalog();
const blank = (over: Partial<Project> = {}): Project =>
  ProjectSchema.parse({
    id: randomUUID(), name: 'Sample kitchen', kind: 'kitchen', units: 'mm', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 0, photos: [],
    room: { polygon: [[0, 0], [3000, 0], [3000, 4000], [0, 4000]], walls: ['a', 'b', 'c', 'd'].map((id) => ({ id, thicknessMm: 100 })), openings: [] },
    items: [], history: [], ...over,
  });
let k = 0;
const sample = buildSampleKitchen(blank(), catalog, () => `id-${k++}`);

describe('drawings without a title block', () => {
  it('the plan keeps its scale bar but drops the title block, and is unchanged by default', () => {
    expect(planToSvg(sample)).toContain('id="title"');
    const bare = planToSvg(sample, { titleBlock: false });
    expect(bare).not.toContain('id="title"');
    expect(bare).toContain('id="scale-bar"');
  });

  it('the closet front drops its title block and the space for it', () => {
    const closet = blank({ kind: 'closet', closet: newCloset(), name: 'Hall closet' });
    expect(closetToSvg(closet)).toContain('id="title"');
    const bare = closetToSvg(closet, { titleBlock: false });
    expect(bare).not.toContain('id="title"');
    expect(svgViewBoxSize(bare).h).toBe(closet.closet!.heightMm + 250 + 400);
  });
});

describe('wallElevationSvg', () => {
  it('draws one wall alone, framed like the editor view', () => {
    const [wall] = wallElevations(sample, catalog);
    const svg = wallElevationSvg(wall, 'mm');
    const f = elevationFrame(wall);
    expect(svgViewBoxSize(svg)).toEqual({ w: f.w, h: f.h });
    expect(svg.match(/<svg/g)).toHaveLength(1);
    expect(svg).toContain('>Refrigerator</text>');
  });
});

describe('pickScale', () => {
  it('picks the largest standard drawing that fits the box', () => {
    // A box 510 × 600 pt is 179.9 × 211.7 mm.
    expect(pickScale({ w: 4000, h: 3000 }, { w: 510, h: 600 })).toBe(25);
    expect(pickScale({ w: 3000, h: 3000 }, { w: 510, h: 600 })).toBe(20);
    expect(pickScale({ w: 5780, h: 6080 }, { w: 510, h: 615 })).toBe(50);
    expect(pickScale({ w: 12000, h: 3000 }, { w: 510, h: 600 })).toBe(100);
  });

  it('gives up past 1:100', () => {
    expect(pickScale({ w: 30000, h: 1000 }, { w: 510, h: 600 })).toBeNull();
  });
});

describe('svgViewBoxSize', () => {
  it('reads the size a drawing covers', () => {
    expect(svgViewBoxSize('<svg viewBox="-120.5 -80 4000 3000.5">')).toEqual({ w: 4000, h: 3000.5 });
    expect(() => svgViewBoxSize('<svg>')).toThrow(/viewBox/);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/export/spec-drawings.test.ts`
Expected: FAIL. `./paper` and `wallElevationSvg` can't be resolved.

- [ ] **Step 3: Implement**

In `src/lib/plan/svg.ts`:

- Add to `SvgOptions`:

```ts
  /** Draw the title block (default true); the spec sheet prints its own. */
  titleBlock?: boolean;
```

- Wrap the title block push (lines 127–135) so it's skipped when `opts.titleBlock === false`. Keep the scale bar and north arrow:

```ts
  if (opts.titleBlock !== false) {
    const date = (opts.date ?? project.updatedAt).slice(0, 10);
    out.push(
      `<g id="title" fill="#111827" text-anchor="end">` +
        `<text x="${r(x0 + width - 200)}" y="${r(fy + 150)}" font-size="${TEXT_MM * 1.6}" font-weight="bold">${escapeXml(project.name)}</text>` +
        `<text x="${r(x0 + width - 200)}" y="${r(fy + 380)}" font-size="${TEXT_MM}">${escapeXml(
          `Scale 1:${SVG_SCALE} · revision ${project.revision} · ${date} · ${units === 'mm' ? 'millimetres' : 'feet and inches'}`
        )}</text>` +
        `</g>`
    );
  }
```

In `src/lib/closet/svg.ts`:

- Export the door names: change `const DOOR_NAME = …` to `export const DOOR_NAME = …`.
- Change the signature and layout:

```ts
export function closetToSvg(project: Project, opts: { date?: string; titleBlock?: boolean } = {}): string {
  const closet = project.closet;
  if (!closet) throw new Error('not a closet project');
  const { widthMm: W, heightMm: H, depthMm: D, opening } = closet;
  const units = project.units;
  const titled = opts.titleBlock !== false;

  const left = 500;
  const top = 250;
  // Room under the floor for the width dimension, and the title block when there is one.
  const bottom = titled ? 900 : 400;
  const x0 = -left;
  const y0 = -top;
  // Wide enough for the title block even for a narrow closet.
  const width = titled ? Math.max(W + left + 300, 3000) : W + left + 300;
  const height = H + top + bottom;
```

- Replace the final push (lines 58–72) with:

```ts
  if (titled) {
    const door =
      opening.style === 'open'
        ? DOOR_NAME.open
        : `${DOOR_NAME[opening.style]}, ${formatLength(opening.widthMm, units)} opening at ${formatLength(opening.leftMm, units)} from the left`;
    const date = (opts.date ?? project.updatedAt).slice(0, 10);
    const fy = H + 450;
    out.push(
      `<g id="title" fill="${INK}">`,
      `<text x="0" y="${fy}" font-size="${TEXT_MM * 1.6}" font-weight="bold">${escapeXml(project.name)}</text>`,
      `<text x="0" y="${fy + 170}" font-size="${TEXT_MM}">${escapeXml(`Front elevation · ${formatLength(D, units)} deep · ${door}`)}</text>`,
      `<text x="0" y="${fy + 300}" font-size="${TEXT_MM}">${escapeXml(`Scale 1:${SVG_SCALE} · revision ${project.revision} · ${date}`)}</text>`,
      '</g>'
    );
  }
  out.push('</svg>');
  return out.join('\n');
```

In `src/lib/plan/elevation-svg.ts`:
- Add `type WallElevation` to the `./elevation` import: `import { wallElevations, type WallElevation } from './elevation';`.
- Append:

```ts
/** One wall's elevation alone, framed by `elevationFrame` and sized to print at 1:SVG_SCALE (for the spec sheet). */
export function wallElevationSvg(e: WallElevation, units: 'mm' | 'in'): string {
  const f = elevationFrame(e);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r(f.x)} ${r(f.y)} ${r(f.w)} ${r(f.h)}" width="${r(f.w / SVG_SCALE)}mm" height="${r(f.h / SVG_SCALE)}mm" font-family="${FONT}">`,
    `<rect x="${r(f.x)}" y="${r(f.y)}" width="${r(f.w)}" height="${r(f.h)}" fill="#ffffff"/>`,
    ...elevationDrawing(e, units).map(shapeToSvg),
    '</svg>',
  ].join('\n');
}
```

Create `src/lib/export/paper.ts`. Both the PDF layout helper (Task 64) and the spec sheet (Task 65) import from it, so neither imports the other's constants.

```ts
/**
 * Paper for the spec sheet: page sizes, margins, and the standard drawing
 * scales, so drawings can be measured with a scale rule. Pure.
 */

/** Paper sizes in points (1/72 in), portrait. */
export const PAGE = { letter: [612, 792], a4: [595.28, 841.89] } as const;
/** 15 mm. */
export const MARGIN_PT = 42.52;
/** Millimetres per point. */
export const PT_MM = 25.4 / 72;
/** Drawing scales tried, largest drawing first (1:N). */
export const STANDARD_SCALES = [20, 25, 50, 100] as const;

/**
 * The smallest N in STANDARD_SCALES (the largest drawing) at which a drawing
 * covering `drawingMm` fits `boxPt` at 1:N; null if not even 1:100 fits.
 */
export function pickScale(drawingMm: { w: number; h: number }, boxPt: { w: number; h: number }): number | null {
  const box = { w: boxPt.w * PT_MM, h: boxPt.h * PT_MM };
  return STANDARD_SCALES.find((n) => drawingMm.w / n <= box.w && drawingMm.h / n <= box.h) ?? null;
}

/** The real size (plan mm) one of our SVG drawings covers: its viewBox width and height. */
export function svgViewBoxSize(svg: string): { w: number; h: number } {
  const m = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!m) throw new Error('drawing has no viewBox');
  return { w: Number(m[1]), h: Number(m[2]) };
}
```

- [ ] **Step 4: Run the tests to verify they pass, with the existing snapshots unchanged**

Run: `npx vitest run src/lib/export src/lib/plan/svg.test.ts src/lib/plan/elevation-svg.test.ts src/lib/closet`
Expected: PASS, with no snapshot updates. If a snapshot fails, the default output changed. Fix the code, not the snapshot.

- [ ] **Step 5: Full check and commit**

Run: `npm test && npx tsc --noEmit && npm run lint`

```bash
git add src/lib/export/paper.ts src/lib/export/spec-drawings.test.ts src/lib/plan/svg.ts src/lib/closet/svg.ts src/lib/plan/elevation-svg.ts
git commit -m "feat(export): drawings for the spec sheet — no title blocks, one wall alone, standard scales"
```

---

### Task 64: PDF layout helper

**Files:**
- Create: `src/lib/export/pdf-layout.ts`, `src/lib/export/pdf-text.ts` (test support), `src/lib/export/pdf-layout.test.ts`
- Modify: `package.json` and `package-lock.json` (add `pdf-lib`)

**Interfaces:**
- Consumes: `MARGIN_PT` and `PAGE` from `@/lib/export/paper` (Task 63).
- Produces, from `@/lib/export/pdf-layout`:
  - `pdfSafe(font: PDFFont, s: string): string`
  - `fit(font: PDFFont, text: string, size: number, maxW: number): string`
  - `wrap(font: PDFFont, text: string, size: number, maxW: number): string[]`
  - `type Column = { header: string; width: number; align?: 'left' | 'right' }`, where `width` is a fraction of the content width
  - `class Sheet`, with:
    - `constructor(doc: PDFDocument, size: readonly [number, number], font: PDFFont, bold: PDFFont)`
    - `width`, `bottom` and `remaining` (getters, in pt)
    - `y` (cursor, pt from the top edge)
    - `newPage()`, `ensureSpace(h)` and `gap(h)`
    - `line(text, { size?, bold?, color? })`
    - `keyValues(rows: [string, string][])`
    - `table(columns: Column[], rows: string[][])`
    - `totals(rows: [string, string][])`
    - `image(png: Uint8Array, wPt: number, hPt: number): Promise<void>`
    - `footers(base: string)`
  - The constants `BODY = 10`, `SMALL = 8`, `H1 = 18`, `H2 = 13`, `LINE = 14` and `GREY`.
- Produces, from `@/lib/export/pdf-text` (tests only): `pdfText(bytes: Uint8Array): string[]`, the drawn strings in order.

- [ ] **Step 1: Add the dependency**

Run: `npm install pdf-lib@^1.17.1`
Expected: `package.json` lists `"pdf-lib": "^1.17.1"` under `dependencies`.

- [ ] **Step 2: Write the failing tests**

`src/lib/export/pdf-layout.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { fit, pdfSafe, Sheet, wrap } from './pdf-layout';
import { pdfText } from './pdf-text';
import { PAGE } from './paper';

async function sheet() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return { doc, font, sheet: new Sheet(doc, PAGE.a4, font, bold) };
}

describe('pdfSafe', () => {
  it('keeps what WinAnsi can draw and turns the rest into "?"', async () => {
    const { font } = await sheet();
    expect(pdfSafe(font, 'Café — 2 m² · ½')).toBe('Café — 2 m² · ½');
    expect(pdfSafe(font, '厨房 kitchen 🍳')).toBe('?? kitchen ?');
  });

  it('turns odd spaces (as Intl puts in money) and line breaks into spaces', async () => {
    const { font } = await sheet();
    expect(pdfSafe(font, '1 234 €\nnext')).toBe('1 234 € next');
  });
});

describe('fit and wrap', () => {
  it('shortens text with an ellipsis to fit a width', async () => {
    const { font } = await sheet();
    const long = 'Refrigerator, counter-depth (910 mm)';
    const short = fit(font, long, 10, 60);
    expect(short.endsWith('…')).toBe(true);
    expect(font.widthOfTextAtSize(short, 10)).toBeLessThanOrEqual(60);
    expect(fit(font, 'Sink', 10, 60)).toBe('Sink');
  });

  it('wraps words onto lines that fit', async () => {
    const { font } = await sheet();
    const lines = wrap(font, 'Fridge to sink 2300 mm, sink to range 1500 mm, range to fridge 3100 mm', 10, 120);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(font.widthOfTextAtSize(l, 10)).toBeLessThanOrEqual(120);
    expect(lines.join(' ')).toBe('Fridge to sink 2300 mm, sink to range 1500 mm, range to fridge 3100 mm');
  });
});

describe('Sheet', () => {
  it('breaks a long table across pages, repeating the header row', async () => {
    const { doc, sheet: s } = await sheet();
    s.line('Parts list and estimate', { size: 13, bold: true });
    const rows = Array.from({ length: 120 }, (_, i) => [`Part ${i + 1}`, '1', 'each']);
    s.table([{ header: 'Part', width: 0.6 }, { header: 'Qty', width: 0.2, align: 'right' }, { header: 'Unit', width: 0.2 }], rows);
    s.footers('Kitchen · 2026-02-03 · revision 0');
    const text = pdfText(await doc.save());
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(3);
    expect(text.filter((t) => t === 'Part')).toHaveLength(doc.getPageCount());
    expect(text).toContain('Part 120');
    expect(text).toContain(`Kitchen · 2026-02-03 · revision 0 · page 1 of ${doc.getPageCount()}`);
  });

  it('wraps a long cell instead of running past its column', async () => {
    const { doc, sheet: s } = await sheet();
    const detail = 'Fridge to sink 2300 mm, sink to range 1500 mm, range to fridge 3100 mm — every leg within 1200–2700 mm';
    s.table([{ header: 'Rule', width: 0.3 }, { header: 'Detail', width: 0.3 }], [['Work triangle', detail]]);
    const text = pdfText(await doc.save());
    expect(text.filter((t) => detail.includes(t) && t.length > 0).length).toBeGreaterThan(1);
  });

  it('starts a new page when content does not fit', async () => {
    const { doc, sheet: s } = await sheet();
    s.gap(s.remaining - 5);
    s.line('Next');
    expect(doc.getPageCount()).toBe(2);
  });

  it('keeps key–value rows and totals on the page, and draws them', async () => {
    const { doc, sheet: s } = await sheet();
    s.keyValues([['Room', '4200 mm × 3600 mm']]);
    s.totals([['Subtotal', '$100.00'], ['Total', '$130.00']]);
    const text = pdfText(await doc.save());
    expect(text).toEqual(expect.arrayContaining(['Room', '4200 mm × 3600 mm', 'Subtotal', '$100.00', 'Total', '$130.00']));
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/lib/export/pdf-layout.test.ts`
Expected: FAIL. `./pdf-layout` and `./pdf-text` can't be resolved.

- [ ] **Step 4: Implement**

`src/lib/export/pdf-text.ts`:

```ts
/**
 * Test support: the text a PDF draws, one string per text-showing operator,
 * in order. Reads pdf-lib's output: (usually Flate-compressed) content
 * streams whose `Tj` operators take hex strings in WinAnsi (windows-1252).
 */
import { constants, inflateSync } from 'node:zlib';

export function pdfText(bytes: Uint8Array): string[] {
  const raw = Buffer.from(bytes).toString('latin1');
  const decoder = new TextDecoder('windows-1252');
  const out: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content = m[1];
    try {
      content = inflateSync(Buffer.from(m[1], 'latin1'), { finishFlush: constants.Z_SYNC_FLUSH }).toString('latin1');
    } catch {
      // Not compressed: read it as it is.
    }
    for (const t of content.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) out.push(decoder.decode(Buffer.from(t[1], 'hex')));
  }
  return out;
}
```

`src/lib/export/pdf-layout.ts`:

```ts
/**
 * A small page-layout helper over pdf-lib for the spec sheet: a cursor that
 * moves down the page, text that wraps or shortens to fit, tables that break
 * across pages with their header repeated, images, and a footer on every
 * page. Text uses the standard fonts (WinAnsi); see `pdfSafe`.
 */
import { rgb, type Color, type PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib';
import { MARGIN_PT } from './paper';

export const BODY = 10;
export const SMALL = 8;
export const H1 = 18;
export const H2 = 13;
/** Line height for body text. */
export const LINE = 14;
/** Space kept for the footer above the bottom margin. */
const FOOTER_PT = 20;
const PAD = 4;
const INK = rgb(0.07, 0.09, 0.15);
export const GREY = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.8, 0.82, 0.85);

export interface Column {
  header: string;
  /** Fraction of the content width. */
  width: number;
  align?: 'left' | 'right';
}

/** Text the standard fonts can draw: odd spaces and line breaks become spaces, anything WinAnsi can't encode becomes "?". */
export function pdfSafe(font: PDFFont, s: string): string {
  let out = '';
  for (const ch of s.replace(/[ -​  　\r\n\t]/g, ' ')) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += '?';
    }
  }
  return out;
}

/** `text`, shortened with an ellipsis if it is wider than `maxW` at `size`. */
export function fit(font: PDFFont, text: string, size: number, maxW: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxW) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

/** `text` broken at spaces into lines no wider than `maxW`; a single word that is too wide is shortened. */
export function wrap(font: PDFFont, text: string, size: number, maxW: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (!line || font.widthOfTextAtSize(next, size) <= maxW) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines.map((l) => fit(font, l, size, maxW));
}

export class Sheet {
  page!: PDFPage;
  /** Cursor: the top of the next line, in points from the page's top edge. */
  y = 0;

  constructor(
    private readonly doc: PDFDocument,
    readonly size: readonly [number, number],
    private readonly font: PDFFont,
    private readonly bold: PDFFont
  ) {
    this.newPage();
  }

  /** Content width between the margins. */
  get width(): number {
    return this.size[0] - 2 * MARGIN_PT;
  }
  /** The lowest the content may reach (the footer sits below). */
  get bottom(): number {
    return this.size[1] - MARGIN_PT - FOOTER_PT;
  }
  get remaining(): number {
    return this.bottom - this.y;
  }

  newPage(): void {
    this.page = this.doc.addPage([this.size[0], this.size[1]]);
    this.y = MARGIN_PT;
  }

  ensureSpace(h: number): void {
    if (this.y + h > this.bottom) this.newPage();
  }

  gap(h: number): void {
    this.y += h;
  }

  /** Draw already-safe text with its top at the cursor (not moving it). */
  private draw(text: string, x: number, size: number, font: PDFFont, color: Color = INK): void {
    this.page.drawText(text, { x, y: this.size[1] - this.y - size, size, font, color });
  }

  /** One line of text across the content width, shortened if it doesn't fit. */
  line(text: string, o: { size?: number; bold?: boolean; color?: Color } = {}): void {
    const size = o.size ?? BODY;
    const font = o.bold ? this.bold : this.font;
    const height = size * 1.4;
    this.ensureSpace(height);
    this.draw(fit(font, pdfSafe(font, text), size, this.width), MARGIN_PT, size, font, o.color);
    this.y += height;
  }

  /** "Label   value" rows: bold labels, values in a column 110 pt in. */
  keyValues(rows: [string, string][]): void {
    for (const [key, value] of rows) {
      this.ensureSpace(LINE);
      this.draw(fit(this.bold, pdfSafe(this.bold, key), BODY, 104), MARGIN_PT, BODY, this.bold);
      this.draw(fit(this.font, pdfSafe(this.font, value), BODY, this.width - 110), MARGIN_PT + 110, BODY, this.font);
      this.y += LINE;
    }
  }

  /** A table whose cells wrap; a row that doesn't fit starts a new page under a repeated header row. */
  table(columns: Column[], rows: string[][]): void {
    const widths = columns.map((c) => c.width * this.width);
    const lefts = widths.map((_, i) => MARGIN_PT + widths.slice(0, i).reduce((a, b) => a + b, 0));
    const layout = (cells: string[], font: PDFFont) => {
      const lines = cells.map((c, i) => wrap(font, pdfSafe(font, c), BODY, widths[i] - PAD));
      return { lines, height: Math.max(1, ...lines.map((l) => l.length)) * LINE };
    };
    const paint = ({ lines, height }: ReturnType<typeof layout>, font: PDFFont) => {
      lines.forEach((cellLines, i) =>
        cellLines.forEach((text, k) => {
          const x = columns[i].align === 'right' ? lefts[i] + widths[i] - PAD - font.widthOfTextAtSize(text, BODY) : lefts[i];
          this.page.drawText(text, { x, y: this.size[1] - this.y - k * LINE - BODY, size: BODY, font, color: INK });
        })
      );
      this.y += height;
    };
    const header = () => {
      paint(layout(columns.map((c) => c.header), this.bold), this.bold);
      const y = this.size[1] - this.y + 2;
      this.page.drawLine({ start: { x: MARGIN_PT, y }, end: { x: MARGIN_PT + this.width, y }, thickness: 0.5, color: RULE });
      this.y += 3;
    };

    this.ensureSpace(LINE * 2 + 3);
    header();
    for (const cells of rows) {
      const row = layout(cells, this.font);
      if (this.y + row.height > this.bottom) {
        this.newPage();
        header();
      }
      paint(row, this.font);
    }
  }

  /** Right-aligned "label  value" rows under a table; the last (the total) is bold. */
  totals(rows: [string, string][]): void {
    rows.forEach(([label, value], i) => {
      const font = i === rows.length - 1 ? this.bold : this.font;
      this.ensureSpace(LINE);
      const l = pdfSafe(font, label);
      const v = pdfSafe(font, value);
      this.draw(l, MARGIN_PT + this.width * 0.8 - 8 - font.widthOfTextAtSize(l, BODY), BODY, font);
      this.draw(v, MARGIN_PT + this.width - PAD - font.widthOfTextAtSize(v, BODY), BODY, font);
      this.y += LINE;
    });
  }

  /** A PNG `wPt` × `hPt`, centred across the content width at the cursor. */
  async image(png: Uint8Array, wPt: number, hPt: number): Promise<void> {
    this.ensureSpace(hPt);
    const embedded = await this.doc.embedPng(png);
    this.page.drawImage(embedded, { x: MARGIN_PT + (this.width - wPt) / 2, y: this.size[1] - this.y - hPt, width: wPt, height: hPt });
    this.y += hPt;
  }

  /** "<base> · page i of n" at the foot of every page; call once, after the last page exists. */
  footers(base: string): void {
    const pages = this.doc.getPages();
    pages.forEach((p, i) => {
      const text = fit(this.font, pdfSafe(this.font, `${base} · page ${i + 1} of ${pages.length}`), SMALL, this.width);
      p.drawText(text, { x: MARGIN_PT, y: MARGIN_PT / 2, size: SMALL, font: this.font, color: GREY });
    });
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/export/pdf-layout.test.ts`
Expected: PASS.

If `pdfText` finds nothing, check how pdf-lib wrote the text operator in a saved file (for example with `console.log` of an inflated stream). Then adjust the regex in `pdf-text.ts`, not the assertions.

- [ ] **Step 6: Full check and commit**

Run: `npm test && npx tsc --noEmit && npm run lint`

```bash
git add package.json package-lock.json src/lib/export/pdf-layout.ts src/lib/export/pdf-text.ts src/lib/export/pdf-layout.test.ts
git commit -m "feat(export): PDF layout helper — wrapping tables that break across pages, footers"
```

---

### Task 65: The spec sheet, its route and its link

**Files:**
- Create: `src/lib/export/spec-sheet.ts`, `src/lib/export/spec-sheet.test.ts`, `src/app/api/export/[id]/pdf/route.ts`, `src/app/api/export/[id]/pdf/route.test.ts`
- Modify:
  - `src/lib/export/drawing.ts`: add `specSheetFileName`
  - `src/components/ProjectEditor.tsx`: the "Spec sheet (PDF)" link
  - `src/components/ProjectEditor.test.tsx`

**Interfaces:**
- Consumes:
  - From Task 64: `Sheet`, `Column`, `BODY`, `SMALL`, `H1`, `H2`, `LINE` and `GREY`.
  - From Task 63: `pickScale`, `svgViewBoxSize`, `PAGE` and `PT_MM` from `@/lib/export/paper`; `wallElevationSvg`, `DOOR_NAME`, and `planToSvg`/`closetToSvg` with `titleBlock: false`.
  - From Task 58: `layoutSummary`, `layoutDetail` and `moneyFormat`.
  - Existing: `buildEstimate`, `FT2_PER_M2`, `wallElevations`, `elevationFrame`, `checkLayout`, `polygonBounds`, `polygonAreaMm2` and `SVG_SCALE`.
- Produces:
  - `buildSpecSheet(project: Project, catalog: Catalog, opts?: { date?: string }): Promise<Uint8Array>`.
  - `PRINT_DPI = 200`.
  - `specSheetFileName(project: Project): string`.
  - `GET /api/export/[id]/pdf`.

- [ ] **Step 1: Write the failing tests**

`src/lib/export/spec-sheet.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { loadCatalog } from '../catalog/loader';
import { newCloset } from '../closet/catalog';
import { buildSampleKitchen } from '../plan/sample-kitchen';
import { ProjectSchema, type PlacedItem, type Project } from '../plan/schemas';
import { pdfText } from './pdf-text';
import { buildSpecSheet } from './spec-sheet';

const catalog = loadCatalog();
const blank = (over: Partial<Project> = {}): Project =>
  ProjectSchema.parse({
    id: randomUUID(), name: 'Sample kitchen', kind: 'kitchen', units: 'mm', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 0, photos: [],
    room: { polygon: [[0, 0], [3000, 0], [3000, 4000], [0, 4000]], walls: ['a', 'b', 'c', 'd'].map((id) => ({ id, thicknessMm: 100 })), openings: [] },
    items: [], history: [], ...over,
  });
let k = 0;
const sample = () => buildSampleKitchen(blank(), catalog, () => `id-${k++}`);
const read = async (pdf: Uint8Array) => ({ doc: await PDFDocument.load(pdf), text: pdfText(pdf).join('\n') });

describe('buildSpecSheet', () => {
  it('a kitchen is four A4 pages: cover and plan, wall elevations, parts and estimate, layout check', async () => {
    const { doc, text } = await read(await buildSpecSheet(sample(), catalog, { date: '2026-02-03' }));
    expect(doc.getPageCount()).toBe(4);
    expect(doc.getPage(0).getSize()).toEqual({ width: 595.28, height: 841.89 });
    for (const s of [
      'Sample kitchen',
      'Kitchen spec sheet',
      'Floor plan — 1:50',
      'Wall elevations',
      'Wall 1 — north, 4200 mm — 1:50',
      'Parts list and estimate',
      'Prices are estimates from default or edited unit prices, not quotes.',
      'Layout check — ',
      'Sample kitchen · 2026-02-03 · revision 0 · page 1 of 4',
      'page 4 of 4',
    ]) {
      expect(text).toContain(s);
    }
  });

  it('is on Letter, in feet and inches, for a project in inches', async () => {
    const { doc, text } = await read(await buildSpecSheet({ ...sample(), units: 'in' }, catalog, { date: '2026-02-03' }));
    expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    expect(text).toContain('ft²');
  });

  it('leaves out the elevations page when nothing is against a wall', async () => {
    const { doc, text } = await read(await buildSpecSheet(blank(), catalog));
    expect(doc.getPageCount()).toBe(3);
    expect(text).not.toContain('Wall elevations');
    expect(text).toContain('nothing to check yet');
  });

  it('a closet is two pages: cover with the front elevation, then parts and estimate', async () => {
    const { doc, text } = await read(await buildSpecSheet(blank({ kind: 'closet', closet: newCloset(), name: 'Hall closet' }), catalog));
    expect(doc.getPageCount()).toBe(2);
    expect(text).toContain('Closet spec sheet');
    expect(text).toMatch(/Front elevation — 1:\d+/);
    expect(text).not.toContain('Layout check');
  });

  it('carries a long parts list onto another page', async () => {
    // Many different parts, turned 45° in the middle of the room so none is against a wall.
    const items: PlacedItem[] = catalog.items.slice(0, 80).map((c, i) => ({
      id: `p${i}`, catalogId: c.id, sizeMm: c.sizeMm, mount: c.mount, position: { x: 1500, y: 2000 }, rotationDeg: 45, ...(c.tags[0] ? { tag: c.tags[0] } : {}),
    }));
    const { doc, text } = await read(await buildSpecSheet(blank({ items }), catalog));
    expect(doc.getPageCount()).toBeGreaterThan(3);
    expect(text.split('\n').filter((t) => t === 'Part').length).toBeGreaterThan(1);
  });

  it('builds for a name the standard fonts cannot draw, showing "?"', async () => {
    const { text } = await read(await buildSpecSheet(blank({ name: '厨房 kitchen' }), catalog));
    expect(text).toContain('?? kitchen');
  });
});
```

`src/app/api/export/[id]/pdf/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject, loadProject } from '@/lib/storage/projects';
import { specSheetFileName } from '@/lib/export/drawing';
import { GET } from './route';

const get = (id: string) => GET(new Request(`http://localhost/api/export/${id}/pdf`), { params: Promise.resolve({ id }) });

describe('GET /api/export/[id]/pdf', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'kd-pdf-'));
    process.env.DATA_DIR = dataDir;
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('downloads the spec sheet as a PDF', async () => {
    const p = createProject(dataDir, { name: 'Our Kitchen!' });
    const res = await get(p.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="our-kitchen-spec-sheet.pdf"');
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('names the download after the kind when the name slugifies to nothing', () => {
    expect(specSheetFileName(loadProject(dataDir, createProject(dataDir, { name: '***' }).id))).toBe('kitchen-spec-sheet.pdf');
    expect(specSheetFileName(loadProject(dataDir, createProject(dataDir, { name: '***', kind: 'closet' }).id))).toBe('closet-spec-sheet.pdf');
  });

  it('400s a bad id and 404s an unknown project', async () => {
    expect((await get('../etc')).status).toBe(400);
    expect((await get('00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });
});
```

Add to `src/components/ProjectEditor.test.tsx`:

```tsx
  it('links to the spec sheet PDF for the current revision', () => {
    render(<ProjectEditor initialProject={project} />);
    expect(screen.getByRole('link', { name: 'Spec sheet (PDF)' }).getAttribute('href')).toBe(`/api/export/${project.id}/pdf?rev=${project.revision}`);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/export/spec-sheet.test.ts "src/app/api/export/[id]/pdf" src/components/ProjectEditor.test.tsx`
Expected: FAIL. `buildSpecSheet`, `./route` and `specSheetFileName` don't exist, and neither does the link.

- [ ] **Step 3: Implement**

Create `src/lib/export/spec-sheet.ts`:

```ts
/**
 * The spec sheet: one design as a PDF to hand to a contractor, cabinet shop
 * or client — the plan (or a closet's front), the wall elevations, the parts
 * list and estimate, and the layout check. Drawings come from the SVG
 * builders, rasterized by sharp at PRINT_DPI and placed at a standard scale.
 * Server-only (sharp is native).
 */
import { PDFDocument, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';
import type { Catalog } from '../catalog/loader';
import { closetToSvg, DOOR_NAME } from '../closet/svg';
import { buildEstimate, FT2_PER_M2, type Estimate, type EstimateLine } from '../estimate/estimate';
import { moneyFormat } from '../estimate/money';
import { wallElevations } from '../plan/elevation';
import { elevationFrame } from '../plan/elevation-drawing';
import { wallElevationSvg } from '../plan/elevation-svg';
import { polygonAreaMm2, polygonBounds, type Point } from '../plan/geometry';
import { checkLayout, layoutDetail, layoutSummary } from '../plan/layout-check';
import { projectKind, type Project } from '../plan/schemas';
import { planToSvg, SVG_SCALE } from '../plan/svg';
import { formatLength } from '../plan/viewport';
import { PAGE, pickScale, PT_MM, svgViewBoxSize } from './paper';
import { GREY, H1, H2, LINE, SMALL, Sheet, type Column } from './pdf-layout';

/** Drawings are rasterized at this resolution for their printed size. */
export const PRINT_DPI = 200;

type Box = { w: number; h: number };

/**
 * Place an SVG drawing in a box at 1:`scale` (or, with no scale, fitted and
 * marked "not to scale"), rasterized at PRINT_DPI, with a caption under it.
 * Our SVGs declare their size at 1:SVG_SCALE, which sets the density.
 */
async function placeDrawing(sheet: Sheet, svg: string, caption: string, box: Box, scale = pickScale(svgViewBoxSize(svg), box)): Promise<void> {
  const real = svgViewBoxSize(svg);
  const k = scale ? 1 / scale : Math.min((box.w * PT_MM) / real.w, (box.h * PT_MM) / real.h);
  const printed = { w: real.w * k, h: real.h * k }; // paper mm
  const density = (PRINT_DPI * printed.w) / (real.w / SVG_SCALE);
  const png = await sharp(Buffer.from(svg), { density }).flatten({ background: '#ffffff' }).png().toBuffer();
  sheet.ensureSpace(printed.h / PT_MM + LINE + 4);
  await sheet.image(png, printed.w / PT_MM, printed.h / PT_MM);
  sheet.gap(4);
  sheet.line(`${caption} — ${scale ? `1:${scale}` : 'not to scale'}`, { size: SMALL, color: GREY });
}

const quantityText = (l: EstimateLine) => (Number.isInteger(l.quantity) ? String(l.quantity) : l.quantity.toFixed(2));
const STATUS = { pass: 'Pass', fail: 'Fail', 'n/a': 'n/a' } as const;

const PART_COLUMNS: Column[] = [
  { header: 'Part', width: 0.46 },
  { header: 'Qty', width: 0.1, align: 'right' },
  { header: 'Unit', width: 0.1 },
  { header: 'Unit price', width: 0.17, align: 'right' },
  { header: 'Total', width: 0.17, align: 'right' },
];

function partsPage(sheet: Sheet, estimate: Estimate): void {
  const money = moneyFormat(estimate.currency);
  sheet.newPage();
  sheet.line('Parts list and estimate', { size: H2, bold: true });
  sheet.gap(4);
  sheet.table(
    PART_COLUMNS,
    estimate.lines.map((l) => [l.label, quantityText(l), l.unit, money.format(l.unitPrice), money.format(l.total)])
  );
  sheet.gap(6);
  sheet.totals([
    ['Subtotal', money.format(estimate.subtotal)],
    [`Install (${estimate.installPct}%)`, money.format(estimate.install)],
    [`Tax (${estimate.taxPct}%)`, money.format(estimate.tax)],
    ['Total', money.format(estimate.total)],
  ]);
  sheet.gap(6);
  sheet.line('Prices are estimates from default or edited unit prices, not quotes.', { size: SMALL, color: GREY });
}

function cover(sheet: Sheet, project: Project, subtitle: string, rows: [string, string][]): void {
  sheet.line(project.name, { size: H1, bold: true });
  sheet.line(subtitle, { color: GREY });
  sheet.gap(6);
  sheet.keyValues(rows);
  sheet.gap(10);
}

async function kitchenPages(sheet: Sheet, project: Project, catalog: Catalog, estimate: Estimate): Promise<void> {
  const units = project.units;
  const money = moneyFormat(estimate.currency);
  const poly = project.room.polygon as Point[];
  const b = polygonBounds(poly);
  const areaM2 = polygonAreaMm2(poly) / 1e6;
  const area = units === 'in' ? `${(areaM2 * FT2_PER_M2).toFixed(1)} ft²` : `${areaM2.toFixed(2)} m²`;
  const layout = layoutSummary(checkLayout(project));

  cover(sheet, project, 'Kitchen spec sheet', [
    ['Room', `${formatLength(b.maxX - b.minX, units)} × ${formatLength(b.maxY - b.minY, units)} · ${area}`],
    ['Items', String(project.items.length)],
    ['Estimate total', money.format(estimate.total)],
    ['Layout check', layout.counted > 0 ? `${layout.passed} of ${layout.counted} passed` : 'nothing to check yet'],
  ]);
  const labels = Object.fromEntries(project.items.map((it) => [it.id, catalog.byId.get(it.catalogId)?.name ?? it.catalogId]));
  await placeDrawing(sheet, planToSvg(project, { labels, titleBlock: false }), 'Floor plan', { w: sheet.width, h: sheet.remaining - LINE * 2 });

  const elevations = wallElevations(project, catalog);
  if (elevations.length > 0) {
    sheet.newPage();
    sheet.line('Wall elevations', { size: H2, bold: true });
    sheet.gap(4);
    const frames = elevations.map(elevationFrame);
    const box = { w: sheet.width, h: (sheet.bottom - sheet.y) / 3 };
    const scale = pickScale({ w: Math.max(...frames.map((f) => f.w)), h: Math.max(...frames.map((f) => f.h)) }, box);
    for (const e of elevations) {
      await placeDrawing(sheet, wallElevationSvg(e, units), e.label, box, scale);
      sheet.gap(8);
    }
  }

  partsPage(sheet, estimate);

  sheet.newPage();
  sheet.line(
    layout.counted > 0 ? `Layout check — ${layout.passed} of ${layout.counted} passed` : 'Layout check — place a fridge, sink and range to start',
    { size: H2, bold: true }
  );
  sheet.gap(4);
  sheet.table(
    [{ header: 'Status', width: 0.12 }, { header: 'Rule', width: 0.3 }, { header: 'Detail', width: 0.58 }],
    layout.ordered.map((r) => [r.info && r.status !== 'n/a' ? 'Info' : STATUS[r.status], r.title, layoutDetail(r.detail, units)])
  );
}

async function closetPages(sheet: Sheet, project: Project, estimate: Estimate): Promise<void> {
  const closet = project.closet!;
  const units = project.units;
  const { opening } = closet;
  cover(sheet, project, 'Closet spec sheet', [
    ['Interior', `${formatLength(closet.widthMm, units)} × ${formatLength(closet.heightMm, units)} × ${formatLength(closet.depthMm, units)}`],
    ['Door', opening.style === 'open' ? DOOR_NAME.open : `${DOOR_NAME[opening.style]}, ${formatLength(opening.widthMm, units)} wide`],
    ['Components', String(closet.components.length)],
    ['Estimate total', moneyFormat(estimate.currency).format(estimate.total)],
  ]);
  await placeDrawing(sheet, closetToSvg(project, { titleBlock: false }), 'Front elevation', { w: sheet.width, h: sheet.remaining - LINE * 2 });
  partsPage(sheet, estimate);
}

/** One design as a PDF: Letter for projects in inches, A4 otherwise. */
export async function buildSpecSheet(project: Project, catalog: Catalog, opts: { date?: string } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${project.name} — spec sheet`);
  doc.setCreator('Home Design');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const sheet = new Sheet(doc, project.units === 'in' ? PAGE.letter : PAGE.a4, font, bold);
  const estimate = buildEstimate(project, catalog);

  if (projectKind(project) === 'closet') await closetPages(sheet, project, estimate);
  else await kitchenPages(sheet, project, catalog, estimate);

  const date = (opts.date ?? new Date().toISOString()).slice(0, 10);
  sheet.footers(`${project.name} · ${date} · revision ${project.revision}`);
  return doc.save();
}
```

In `src/lib/export/drawing.ts`, add after `elevationsFileName`:

```ts
/** A download name for the spec sheet, e.g. "our-kitchen-spec-sheet.pdf". */
export function specSheetFileName(project: Project): string {
  return exportFileName(project.name, 'pdf', projectKind(project) === 'closet' ? 'closet' : 'kitchen').replace(/\.pdf$/, '-spec-sheet.pdf');
}
```

`src/app/api/export/[id]/pdf/route.ts`:

```ts
import { loadCatalog } from '@/lib/catalog/loader';
import { loadExportProject, specSheetFileName } from '@/lib/export/drawing';
import { buildSpecSheet } from '@/lib/export/spec-sheet';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/export/[id]/pdf — the spec sheet: plan (or closet front), wall
 * elevations, parts list and estimate, layout check, as one PDF.
 *   200 application/pdf · 400 invalid id · 404 unknown project
 */
export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const loaded = loadExportProject((await params).id);
  if ('error' in loaded) return loaded.error;
  const pdf = await buildSpecSheet(loaded.project, loadCatalog());
  return new Response(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${specSheetFileName(loaded.project)}"`,
      'cache-control': 'no-store',
    },
  });
}
```

In `src/components/ProjectEditor.tsx`, after the CSV link (line 118), add:

```tsx
          <a className="text-blue-700 underline" href={`/api/export/${project.id}/pdf?rev=${project.revision}`} download>
            Spec sheet (PDF)
          </a>
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run src/lib/export "src/app/api/export/[id]/pdf" src/components/ProjectEditor.test.tsx`
Expected: PASS.

The page-count expectations were checked against the layout:
- **Sample kitchen floor plan:** the drawing is 5780 × 6080 mm. In a box of about 180 × 210 mm, 1:50 is the first scale that fits.
- **Sample kitchen elevation:** the frame is 4800 × 3200 mm in a box of about 180 × 87 mm, so 1:50.
- **Sample parts list:** it fits on one page.

If a count is off, print `pdfText` for that case and check which page broke unexpectedly. Then fix the layout, not the expectation, unless the expectation contradicts the spec.

- [ ] **Step 5: Look at it**

Write the sample kitchen's PDF to the scratchpad. For example, use a throwaway script that calls `buildSpecSheet` and writes the bytes, or run `npm run dev` and use the link. Open it and check:
- The drawings are sharp, centred and not cut off.
- The tables line up, and the footers sit inside the page.
- A closet looks right too.

Note what you saw in the report.

- [ ] **Step 6: Full check and commit**

Run: `npm test && npx tsc --noEmit && npm run lint`

```bash
git add src/lib/export/spec-sheet.ts src/lib/export/spec-sheet.test.ts src/lib/export/drawing.ts "src/app/api/export/[id]/pdf" src/components/ProjectEditor.tsx src/components/ProjectEditor.test.tsx
git commit -m "feat(export): the spec sheet PDF — plan, elevations, parts and estimate, layout check"
```

---

### Task 66: End-to-end test and docs

**Files:**
- Create: `tests/e2e/options.spec.ts`
- Modify:
  - `docs/plan.md` (Phase 11 checklist line, and a Phase 11 section after Phase 10)
  - `README.md` (feature paragraph, exports sentence, status line)
  - `docs/superpowers/specs/2026-10-12-options-spec-sheet-design.md` (the refinements from Global Constraints)

**Interfaces:**
- Consumes: everything above. The UI strings are "Try a sample kitchen", "Spec sheet (PDF)", "Duplicate as option", "Compare options", the "Options" list, "These options use the same parts." and the estimate's `Unit price: …` textboxes.

- [ ] **Step 1: Write the e2e test**

`tests/e2e/options.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('download the spec sheet, duplicate the sample kitchen as an option, edit it, and compare', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a sample kitchen' }).click();
  await page.waitForURL(/\/project\/[0-9a-f-]{36}$/);
  const originalUrl = page.url();

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Spec sheet (PDF)' }).click()]);
  expect(download.suggestedFilename()).toBe('sample-kitchen-spec-sheet.pdf');

  await page.getByRole('button', { name: 'Duplicate as option' }).click();
  await page.waitForURL((url) => /\/project\/[0-9a-f-]{36}$/.test(url.pathname) && url.href !== originalUrl);
  await expect(page.getByRole('heading', { level: 1, name: 'Sample kitchen — Option B' })).toBeVisible();
  await expect(page.getByText('Revision 0')).toBeVisible();

  // Make the option cost more: raise the first unit price.
  const price = page.getByRole('table', { name: 'Estimate' }).getByRole('textbox', { name: /^Unit price: / }).first();
  await price.fill(String(Number(await price.inputValue()) + 100));
  await price.press('Enter');
  await expect(page.getByText('Revision 1')).toBeVisible();

  await page.getByRole('link', { name: 'Compare options' }).click();
  await page.waitForURL(/\/compare\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Compare options — Sample kitchen' })).toBeVisible();
  const columns = page.getByRole('list', { name: 'Options' }).locator(':scope > li');
  await expect(columns).toHaveCount(2);
  await expect(columns.nth(0).getByRole('link', { name: 'Sample kitchen', exact: true })).toBeVisible();
  await expect(columns.nth(1).getByRole('link', { name: 'Sample kitchen — Option B' })).toBeVisible();
  const totals = await columns.getByText(/^Total /).allTextContents();
  expect(totals).toHaveLength(2);
  expect(totals[0]).not.toBe(totals[1]);
  await expect(page.getByText('These options use the same parts.')).toBeVisible();
});
```

- [ ] **Step 2: Run it**

Run: `npx playwright test tests/e2e/options.spec.ts`
Expected: PASS.

If it fails, check whether the app or the test is wrong against the spec. Fix the app when the app is wrong, and record any test change in the report.

- [ ] **Step 3: Docs**

**`docs/plan.md`:**
- Under the Phase 10 checklist line (line 39), add:

```markdown
- [x] Phase 11 — Design options and the spec sheet (Tasks 58–66; see below)
```

- After the Phase 10 section (before `## Tests / Validation Strategy`), add:

```markdown
## Phase 11 — Design options and the spec sheet (tasks 58–66)

Sub-project 4 of 4 from the 2026-10-10 feature review. Spec: `docs/superpowers/specs/2026-10-12-options-spec-sheet-design.md`; task-by-task plan: `docs/superpowers/plans/2026-10-12-options-spec-sheet.md`.

> ✅ Done. "Duplicate as option" in the editor copies a design (room, items, prices, photos) as a new project linked to the original by `optionOf`, named "<name> — Option B", C, …, with its own undo history (`duplicateAsOption` in `src/lib/storage/projects.ts`, naming in `src/lib/plan/options.ts`). Options follow their original on the home page with an "Option" badge. `/compare/<groupId>` shows the options side by side — thumbnail, estimate total and subtotal, layout check, item count — and a "What differs" table of the parts whose quantities differ. "Spec sheet (PDF)" downloads `GET /api/export/[id]/pdf`: the plan at a standard scale (1:20, 1:25, 1:50 or 1:100), the wall elevations, the parts list and estimate, and the layout check, on Letter or A4 by the project's units (`buildSpecSheet` in `src/lib/export/spec-sheet.ts`, over the `pdf-lib` layout helper in `src/lib/export/pdf-layout.ts`).

Refinements made along the way: closets show their front on the compare page, as on the home list; options are marked on the home page with a badge and a coloured border rather than indented; the layout-check status in the PDF is a word (the check marks aren't in the PDF's standard fonts); PDF table cells wrap, and long tables repeat their header on the next page.

Known gaps: the PDF's standard fonts can't draw characters outside Western European text (they print as "?"); drawings in the PDF are 200 dpi images, not vectors; there's no PDF of the comparison, and a project can't be moved into or out of an option group after it's made.
```

**`README.md`:**
- In the first paragraph, change "Exports to JSON, SVG/PNG (plan and wall elevations), and a CSV parts list." to:

```markdown
Exports to JSON, SVG/PNG (plan and wall elevations), a CSV parts list, and a PDF spec sheet.
```

- After the **elevations** paragraph, add:

```markdown
**Design options** let you try another version of a design without losing the first: "Duplicate as option" makes a linked copy ("Option B"), and "Compare options" shows the options side by side — estimate, layout check, and which parts differ. The **spec sheet** downloads one design as a PDF to hand to a contractor or cabinet shop: the plan at a standard scale, the wall elevations, the parts list and estimate, and the layout check.
```

- After the Phase 10 status line, add:

```markdown
**Phase 11 — Options and spec sheet:** done (Tasks 58–66) — design options with a side-by-side comparison, and a PDF spec sheet.
```

**`docs/superpowers/specs/2026-10-12-options-spec-sheet-design.md`:** add a section before "## Out of scope":

```markdown
## Refinements made in the plan

- The compare page shows closets with `ClosetElevation`, as the home list does (the home list doesn't use `PlanThumbnail` for closets).
- The home list keeps its two-column grid: an option follows its original with an "Option" badge and a coloured left border instead of being indented.
- The layout-check detail conversion moves to `layoutDetail(detail, units)` in `src/lib/plan/layout-check.ts`, shared by the panel and the PDF. With no counted rule, the compare page and the PDF cover say "Layout check: nothing to check yet".
- In the PDF the layout-check status is a word (Pass, Fail, Info, n/a): the panel's check marks aren't in WinAnsi.
- The PDF layout helper is `src/lib/export/pdf-layout.ts`; page sizes, margins and `pickScale` are in `src/lib/export/paper.ts`. Tests read the drawn text back from the content streams with `pdfText` instead of saving uncompressed.
- PDF table cells wrap; a row that doesn't fit starts a new page under a repeated header.
- `closet/svg.ts` exports `DOOR_NAME` for the closet cover.
- The Playwright test edits a unit price in the option, not an item's position, and checks the compare page shows different totals.
```

- [ ] **Step 4: Full check, including e2e, and commit**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run e2e`
Expected: everything passes.

```bash
git add tests/e2e/options.spec.ts docs/plan.md README.md docs/superpowers/specs/2026-10-12-options-spec-sheet-design.md
git commit -m "test: options and spec sheet end to end; docs"
```
