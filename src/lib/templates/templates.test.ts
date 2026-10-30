import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { loadCatalog } from '../catalog/loader';
import { newProject } from '../plan/new-project';
import { checkAccessibility, checkLayout } from '../plan/layout-check';
import { pointInPolygon, type Point } from '../plan/geometry';
import { ProjectSchema, type Project } from '../plan/schemas';
import { validatePlan } from '../plan/validate';
import { validateCloset } from '../closet/validate';
import { closetFootprint, topOf } from '../closet/catalog';
import { TEMPLATE_INFO, buildFromTemplate, getTemplateInfo, templateRegistryGaps, templatesForKind } from './index';

const catalog = loadCatalog();
const build = (id: string): Project => {
  const info = getTemplateInfo(id)!;
  return buildFromTemplate(id, newProject({ name: info.defaultProjectName, kind: info.kind }), catalog, randomUUID);
};

/**
 * Layout rules a template is allowed to miss, by template id. None: every
 * template passes every counted NKBA check. A regression still fails the test.
 */
const RELAXED: Record<string, string[]> = {};

const kitchens = TEMPLATE_INFO.filter((t) => t.kind === 'kitchen');
const closets = TEMPLATE_INFO.filter((t) => t.kind === 'closet');

describe('template registry', () => {
  it('has a builder for every template and a template for every builder', () => {
    expect(templateRegistryGaps()).toEqual({ noBuilder: [], noInfo: [] });
  });

  it('has unique ids and non-empty text', () => {
    expect(new Set(TEMPLATE_INFO.map((t) => t.id)).size).toBe(TEMPLATE_INFO.length);
    for (const t of TEMPLATE_INFO) {
      expect(t.name.trim()).not.toBe('');
      expect(t.description.trim()).not.toBe('');
      expect(t.defaultProjectName.trim()).not.toBe('');
    }
  });

  it('offers several of each kind', () => {
    expect(templatesForKind('kitchen').length).toBeGreaterThanOrEqual(5);
    expect(templatesForKind('closet').length).toBeGreaterThanOrEqual(5);
  });

  it('refuses an unknown id and the wrong kind', () => {
    expect(() => buildFromTemplate('nope', newProject({ name: 'x' }), catalog, randomUUID)).toThrow(/unknown template/);
    expect(() => buildFromTemplate('closet-kids', newProject({ name: 'x' }), catalog, randomUUID)).toThrow(/is for a closet/);
    expect(() => buildFromTemplate('kitchen-galley', newProject({ name: 'x', kind: 'closet' }), catalog, randomUUID)).toThrow(/is for a kitchen/);
  });
});

describe.each(TEMPLATE_INFO.map((t) => [t.id, t] as const))('template %s', (id, info) => {
  const project = build(id);

  it('builds a valid project with no warnings', () => {
    const result = validatePlan(project);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('round-trips through the schema as a fresh project of its kind', () => {
    const copy = ProjectSchema.parse(JSON.parse(JSON.stringify(project)));
    expect(copy).toEqual(project);
    expect(project.kind).toBe(info.kind);
    expect(project.revision).toBe(0);
    expect(project.history).toEqual([]);
    expect(project.name).toBe(info.defaultProjectName);
  });

  it('keeps the base project identity and wall ids', () => {
    const base = newProject({ name: 'Mine', kind: info.kind });
    const built = buildFromTemplate(id, base, catalog, randomUUID);
    expect(built.id).toBe(base.id);
    expect(built.name).toBe('Mine');
    expect(built.room.walls.map((w) => w.id)).toEqual(base.room.walls.map((w) => w.id));
  });

  it('gives every placed thing its own id', () => {
    const ids = [...project.items.map((i) => i.id), ...(project.closet?.components.map((c) => c.id) ?? [])];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe.each(kitchens.map((t) => [t.id] as const))('kitchen template %s', (id) => {
  const project = build(id);
  const catalogIds = project.items.map((it) => it.catalogId);
  const tagged = (tag: string) => project.items.filter((it) => it.tag === tag);

  it('passes the NKBA layout checks', () => {
    const relaxed = RELAXED[id] ?? [];
    const failing = checkLayout(project).filter((r) => r.status === 'fail' && !r.info && !relaxed.includes(r.id));
    expect(failing.map((r) => `${r.id}: ${r.detail}`)).toEqual([]);
  });

  it('runs every layout rule, the work triangle included', () => {
    const layout = checkLayout(project);
    expect(layout).toHaveLength(9);
    expect(layout.filter((r) => r.id.startsWith('triangle-')).map((r) => r.status)).not.toContain('n/a');
  });

  it('has a sink, a range, a fridge and a dishwasher', () => {
    expect(tagged('sink')).toHaveLength(1);
    expect(tagged('range')).toHaveLength(1);
    expect(tagged('fridge')).toHaveLength(1);
    expect(tagged('dishwasher')).toHaveLength(1);
  });

  it('has a hood or microwave over the range, a door, and a window or none on the sink wall', () => {
    expect(catalogIds.some((c) => c.startsWith('range-hood') || c.startsWith('microwave-over'))).toBe(true);
    expect(project.room.openings.filter((o) => o.kind === 'door').length).toBeGreaterThanOrEqual(1);
  });

  it('keeps every item inside the room', () => {
    for (const it of project.items) {
      expect(pointInPolygon([it.position.x, it.position.y], project.room.polygon as Point[]), it.catalogId).toBe(true);
    }
  });

  it('summarises as expected', () => {
    const summary = {
      room: project.room.polygon,
      items: project.items.map((it) => [it.catalogId, Math.round(it.position.x), Math.round(it.position.y), it.rotationDeg]),
      openings: project.room.openings.map((o) => [o.kind, Math.round(o.positionMm), o.widthMm]),
      layout: Object.fromEntries(checkLayout(project).map((r) => [r.id, `${r.status}: ${r.detail}`])),
    };
    expect(summary).toMatchSnapshot();
  });
});

describe.each(closets.map((t) => [t.id] as const))('closet template %s', (id) => {
  const project = build(id);
  const closet = project.closet!;

  it('passes the closet checks', () => {
    const result = validateCloset(closet);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('keeps the room outline as the closet footprint', () => {
    expect(project.room.polygon).toEqual(closetFootprint(closet));
  });

  it('holds something to hang or shelve things on', () => {
    const kinds = closet.components.map((c) => c.kind);
    expect(kinds.some((k) => ['rod', 'shelf', 'shoe_shelf', 'tower', 'drawers', 'hooks'].includes(k))).toBe(true);
    expect(closet.components.length).toBeGreaterThanOrEqual(5);
  });

  it('keeps every component inside the closet', () => {
    for (const c of closet.components) {
      expect(c.xMm).toBeGreaterThanOrEqual(0);
      expect(c.xMm + c.widthMm).toBeLessThanOrEqual(closet.widthMm);
      expect(c.yMm).toBeGreaterThanOrEqual(0);
      expect(topOf(c)).toBeLessThanOrEqual(closet.heightMm);
      expect(c.depthMm ?? 0).toBeLessThanOrEqual(closet.depthMm);
    }
  });

  it('has a door opening inside the closet', () => {
    expect(closet.opening.leftMm).toBeGreaterThanOrEqual(0);
    expect(closet.opening.leftMm + closet.opening.widthMm).toBeLessThanOrEqual(closet.widthMm);
  });

  it('summarises as expected', () => {
    const summary = {
      size: [closet.widthMm, closet.heightMm, closet.depthMm],
      opening: closet.opening,
      components: closet.components.map((c) => [c.kind, c.xMm, c.yMm, c.widthMm, c.heightMm ?? null, c.count ?? null]),
    };
    expect(summary).toMatchSnapshot();
  });
});

/**
 * Counted accessibility rules each template misses, by template id, and why.
 * Listed exactly, so fixing one (or breaking another) fails the test.
 */
const ACCESS_MISSES: Record<string, { rules: string[]; why: string }> = {
  'kitchen-l-island': { rules: ['access-aisle'], why: 'the island leaves 1120 mm, enough for the NKBA aisle (1067 mm) but not 1220 mm' },
  'kitchen-sample': { rules: ['access-aisle', 'access-turning', 'access-door'], why: 'a demo packed tight around its island, with an 800 mm door' },
};

describe.each(TEMPLATE_INFO.map((t) => [t.id, t] as const))('accessibility of template %s', (id) => {
  const project = build(id);

  it('misses exactly the accessibility rules we expect', () => {
    const missed = checkAccessibility(project)
      .filter((r) => r.status === 'fail' && !r.info)
      .map((r) => r.id);
    expect(missed.sort()).toEqual([...(ACCESS_MISSES[id]?.rules ?? [])].sort());
  });
});
