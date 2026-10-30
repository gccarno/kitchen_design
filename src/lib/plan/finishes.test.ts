import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { randomUUID } from 'node:crypto';
import { loadCatalog } from '../catalog/loader';
import { buildEstimate } from '../estimate/estimate';
import { COUNTERTOP_RATES, DOOR_STYLE_FACTOR, defaultUnitPrice } from '../estimate/prices';
import { buildSpecSheet } from '../export/spec-sheet';
import { pdfText } from '../export/pdf-text';
import { describePlanForLLM } from '../llm/plan-context';
import { compileCommands, CommandError, CommandSchema } from './commands';
import { commitRevision } from './diff';
import { describePlanChanges } from './changes';
import { wallElevations } from './elevation';
import { elevationDrawing } from './elevation-drawing';
import { elevationsToSvg, wallElevationSvg } from './elevation-svg';
import {
  DEFAULT_FINISHES,
  FINISH_COLORS,
  colorName,
  darken,
  describeFinishes,
  edgeColor,
  finishChanges,
  finishesOf,
  resolveColor,
} from './finishes';
import { newProject } from './new-project';
import { proposalForFinishes } from './proposal';
import { buildSampleKitchen } from './sample-kitchen';
import { ProjectSchema, type Finishes, type Project } from './schemas';

const catalog = loadCatalog();
const kitchen = (): Project => buildSampleKitchen(newProject({ name: 'Sample kitchen' }), catalog, randomUUID);
const WHITE_SLAB: Finishes = { cabinetColor: '#f5f5f4', doorStyle: 'slab', countertop: 'granite' };

describe('colours', () => {
  it('resolves preset names in any case, and #rrggbb codes to lower case', () => {
    expect(resolveColor('White')).toBe('#f5f5f4');
    expect(resolveColor('  sage GREEN ')).toBe('#cfd8c5');
    expect(resolveColor('#ABCDEF')).toBe('#abcdef');
    expect(resolveColor('turquoise')).toBeNull();
    expect(resolveColor('#abc')).toBeNull();
    expect(resolveColor('')).toBeNull();
  });

  it('names a preset, and falls back to the code', () => {
    expect(colorName('#F5F5F4')).toBe('White');
    expect(colorName('#123456')).toBe('#123456');
    expect(new Set(FINISH_COLORS.map((c) => c.hex)).size).toBe(FINISH_COLORS.length);
  });

  it('darkens toward black, and keeps the standard outline on the default colour only', () => {
    expect(darken('#ffffff', 0.5)).toBe('#808080');
    expect(darken('#000000', 0.5)).toBe('#000000');
    expect(edgeColor(DEFAULT_FINISHES.cabinetColor, '#8a6a3b')).toBe('#8a6a3b');
    expect(edgeColor('#1e3a5f', '#8a6a3b')).toBe(darken('#1e3a5f', 0.45));
  });
});

describe('describing finishes', () => {
  it('reads as a phrase, and lists only what changed', () => {
    expect(describeFinishes(WHITE_SLAB)).toBe('White cabinets, slab (flat) doors, granite countertop');
    expect(finishChanges(DEFAULT_FINISHES, WHITE_SLAB)).toEqual([
      'Cabinet colour: Natural wood → White',
      'Door style: Shaker → Slab (flat)',
      'Countertop: Quartz → Granite',
    ]);
    expect(finishChanges(WHITE_SLAB, { ...WHITE_SLAB, cabinetColor: '#F5F5F4' })).toEqual([]);
  });
});

describe('the schema', () => {
  it('leaves finishes out of a project that has none, and round-trips ones that are set', () => {
    const plain = kitchen();
    expect(plain.finishes).toBeUndefined();
    expect(finishesOf(plain)).toEqual(DEFAULT_FINISHES);
    const set = { ...plain, finishes: WHITE_SLAB };
    expect(ProjectSchema.parse(JSON.parse(JSON.stringify(set)))).toEqual(set);
  });

  it('rejects a bad colour, door style or material', () => {
    const bad = (finishes: unknown) => ProjectSchema.safeParse({ ...kitchen(), finishes }).success;
    expect(bad(WHITE_SLAB)).toBe(true);
    expect(bad({ ...WHITE_SLAB, cabinetColor: 'white' })).toBe(false);
    expect(bad({ ...WHITE_SLAB, cabinetColor: '#fff' })).toBe(false);
    expect(bad({ ...WHITE_SLAB, doorStyle: 'louvred' })).toBe(false);
    expect(bad({ ...WHITE_SLAB, countertop: 'marble' })).toBe(false);
    expect(bad({ cabinetColor: '#ffffff', doorStyle: 'slab' })).toBe(false);
  });
});

describe('the setFinishes command', () => {
  const run = (p: Project, cmd: object) => compileCommands(p, [CommandSchema.parse(cmd)], catalog, randomUUID);

  it('starts from the standard look and changes only what it names', () => {
    const { project, patch } = run(kitchen(), { type: 'setFinishes', cabinetColor: 'navy' });
    expect(project.finishes).toEqual({ ...DEFAULT_FINISHES, cabinetColor: '#1e3a5f' });
    expect(patch.map((op) => op.path)).toEqual(['/finishes']);
  });

  it('merges into finishes already set, and takes a colour code', () => {
    const first = run(kitchen(), { type: 'setFinishes', doorStyle: 'glass', countertop: 'laminate' }).project;
    const second = run(first, { type: 'setFinishes', cabinetColor: '#AA0000' }).project;
    expect(second.finishes).toEqual({ cabinetColor: '#aa0000', doorStyle: 'glass', countertop: 'laminate' });
  });

  it('applies several in order', () => {
    const { project } = compileCommands(
      kitchen(),
      [
        { type: 'setFinishes', cabinetColor: 'white' },
        { type: 'setFinishes', cabinetColor: 'charcoal', doorStyle: 'slab' },
      ],
      catalog,
      randomUUID
    );
    expect(project.finishes).toEqual({ cabinetColor: '#4b5563', doorStyle: 'slab', countertop: 'quartz' });
  });

  it('leaves a project without finishes alone when no command sets them', () => {
    const { project, patch } = compileCommands(kitchen(), [{ type: 'renameProject', name: 'X' }], catalog, randomUUID);
    expect('finishes' in project).toBe(false);
    expect(patch.every((op) => !op.path.startsWith('/finishes'))).toBe(true);
  });

  it('explains an unknown colour, and an empty command', () => {
    expect(() => run(kitchen(), { type: 'setFinishes', cabinetColor: 'turquoise' })).toThrow(/unknown colour "turquoise" — use Natural wood, White/);
    expect(() => run(kitchen(), { type: 'setFinishes' })).toThrow(CommandError);
    expect(() => run(kitchen(), { type: 'setFinishes' })).toThrow(/needs a cabinetColor, doorStyle or countertop/);
    expect(CommandSchema.safeParse({ type: 'setFinishes', doorStyle: 'louvred' }).success).toBe(false);
  });
});

describe('saving finishes as an edit', () => {
  it('is allowed by the patch rules, and can be undone by going back to the standard look', () => {
    const before = kitchen();
    const proposal = proposalForFinishes(before, WHITE_SLAB, 'Pick finishes');
    expect(proposal.patch).toEqual([{ op: 'add', path: '/finishes', value: WHITE_SLAB }]);
    const after = commitRevision(before, proposal.patch, { summary: 'Pick finishes', source: 'user', baseRevision: 0 });
    expect(after.finishes).toEqual(WHITE_SLAB);
    expect(proposalForFinishes(after, undefined, 'Reset').patch).toEqual([{ op: 'remove', path: '/finishes' }]);
  });

  it('describes what changes in the review', () => {
    const before = kitchen();
    const after = { ...before, finishes: WHITE_SLAB };
    expect(describePlanChanges(before, after)).toEqual([
      { kind: 'changed', subject: 'finish', text: 'Cabinet colour: Natural wood → White' },
      { kind: 'changed', subject: 'finish', text: 'Door style: Shaker → Slab (flat)' },
      { kind: 'changed', subject: 'finish', text: 'Countertop: Quartz → Granite' },
    ]);
    expect(describePlanChanges(before, { ...before, finishes: DEFAULT_FINISHES })).toEqual([]);
  });

  it('tells the chat the finishes only once they are set', () => {
    const before = kitchen();
    expect(describePlanForLLM(before, catalog)).not.toContain('Finishes:');
    expect(describePlanForLLM({ ...before, finishes: WHITE_SLAB }, catalog)).toContain('Finishes: White cabinets, slab (flat) doors, granite countertop');
  });
});

describe('the elevations', () => {
  const wall = () => wallElevations(kitchen(), catalog).find((e) => e.pieces.some((p) => p.tag === 'base' || p.tag === 'sink'))!;
  const rects = (shapes: ReturnType<typeof elevationDrawing>) => shapes.filter((s) => s.type === 'rect');

  it('draws the standard look with no finishes, and the same with the defaults given', () => {
    const e = wall();
    expect(elevationDrawing(e, 'mm', DEFAULT_FINISHES)).toEqual(elevationDrawing(e, 'mm'));
  });

  it('paints the cabinets and the countertop in the chosen colours', () => {
    const e = wall();
    const shapes = elevationDrawing(e, 'mm', { cabinetColor: '#1e3a5f', doorStyle: 'shaker', countertop: 'butcher-block' });
    expect(rects(shapes).some((s) => s.fill === '#1e3a5f')).toBe(true);
    expect(rects(shapes).some((s) => s.fill === '#b0793a')).toBe(true);
    expect(rects(shapes).some((s) => s.fill === '#f3e8d2')).toBe(false);
  });

  it('draws a slab as joints with no framed panels, and glass as tinted panels', () => {
    const e = wall();
    const framed = (shapes: ReturnType<typeof elevationDrawing>) => rects(shapes).filter((s) => s.fill === 'none' || s.fill === '#dbeafe');
    const shaker = elevationDrawing(e, 'mm', { ...DEFAULT_FINISHES, doorStyle: 'shaker' });
    const slab = elevationDrawing(e, 'mm', { ...DEFAULT_FINISHES, doorStyle: 'slab' });
    const glass = elevationDrawing(e, 'mm', { ...DEFAULT_FINISHES, doorStyle: 'glass' });
    expect(framed(shaker).length).toBeGreaterThan(0);
    expect(framed(slab)).toHaveLength(0);
    expect(slab.filter((s) => s.type === 'line').length).toBeGreaterThan(shaker.filter((s) => s.type === 'line').length);
    expect(framed(glass)).toHaveLength(framed(shaker).length);
    expect(framed(glass).every((s) => s.fill === '#dbeafe')).toBe(true);
  });

  it('reaches the exported SVGs', () => {
    const project = { ...kitchen(), finishes: { cabinetColor: '#1e3a5f', doorStyle: 'slab' as const, countertop: 'granite' as const } };
    expect(elevationsToSvg(project, catalog)).toContain('#1e3a5f');
    expect(wallElevationSvg(wallElevations(project, catalog)[0], 'mm', project.finishes)).toContain('#1e3a5f');
    expect(elevationsToSvg(kitchen(), catalog)).not.toContain('#1e3a5f');
  });
});

describe('the estimate', () => {
  const line = (p: Project, key: string) => buildEstimate(p, catalog).lines.find((l) => l.key === key)!;

  it('prices a project with no finishes exactly as the defaults', () => {
    const plain = kitchen();
    const explicit = { ...plain, finishes: DEFAULT_FINISHES };
    expect(buildEstimate(explicit, catalog).lines.map((l) => [l.key, l.quantity, l.unitPrice, l.total])).toEqual(
      buildEstimate(plain, catalog).lines.map((l) => [l.key, l.quantity, l.unitPrice, l.total])
    );
    expect(line(plain, 'countertop').label).toBe('Countertop');
    expect(line(explicit, 'countertop').label).toBe('Countertop (quartz)');
  });

  it('prices the countertop by material and names it', () => {
    const p = kitchen();
    for (const material of Object.keys(COUNTERTOP_RATES) as Array<keyof typeof COUNTERTOP_RATES>) {
      const l = line({ ...p, finishes: { ...DEFAULT_FINISHES, countertop: material } }, 'countertop');
      expect(l.unitPrice).toBe(COUNTERTOP_RATES[material]);
      expect(l.label.toLowerCase()).toContain(material.replace('-', ' '));
    }
    expect(COUNTERTOP_RATES.laminate).toBeLessThan(COUNTERTOP_RATES.quartz);
    expect(COUNTERTOP_RATES.granite).toBeGreaterThan(COUNTERTOP_RATES.quartz);
  });

  it('lets your own countertop price win over the material', () => {
    const p = { ...kitchen(), finishes: { ...DEFAULT_FINISHES, countertop: 'granite' as const }, pricing: { currency: 'USD', unitPrices: {}, countertopPerM2: 99 } };
    expect(line(p, 'countertop').unitPrice).toBe(99);
  });

  it('prices cabinets by door style, and leaves appliances and your own prices alone', () => {
    const p = kitchen();
    const cabinet = p.items.find((it) => it.tag === 'base')!.catalogId;
    const appliance = p.items.find((it) => it.tag === 'range')!.catalogId;
    const priceOf = (style: keyof typeof DOOR_STYLE_FACTOR, key: string, extra: Partial<Project> = {}) =>
      line({ ...p, ...extra, finishes: { ...DEFAULT_FINISHES, doorStyle: style } }, key).unitPrice;
    const standard = priceOf('shaker', cabinet);
    expect(standard).toBe(defaultUnitPrice(cabinet, catalog));
    expect(priceOf('slab', cabinet)).toBeLessThan(standard);
    expect(priceOf('glass', cabinet)).toBeGreaterThan(standard);
    expect(priceOf('glass', cabinet)).toBeCloseTo(standard * DOOR_STYLE_FACTOR.glass, 1);
    expect(priceOf('glass', appliance)).toBe(priceOf('slab', appliance));
    expect(priceOf('glass', cabinet, { pricing: { currency: 'USD', unitPrices: { [cabinet]: 111 } } })).toBe(111);
  });
});

describe('the spec sheet', () => {
  it('lists the finishes on the cover once they are set', async () => {
    const text = async (p: Project) => pdfText(await buildSpecSheet(p, catalog, { date: '2026-02-03' })).join('\n');
    expect(await text(kitchen())).not.toContain('doors');
    expect(await text(kitchen())).not.toMatch(/Cabinets\s+Natural wood/);
    const set = await text({ ...kitchen(), finishes: WHITE_SLAB });
    expect(set).toMatch(/Cabinets\s+White, slab \(flat\) doors/);
    expect(set).toContain('White, slab (flat) doors');
    expect(set).toContain('Granite');
    expect((await PDFDocument.load(await buildSpecSheet({ ...kitchen(), finishes: WHITE_SLAB }, catalog))).getPageCount()).toBe(4);
  });
});
