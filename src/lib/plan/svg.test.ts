import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { escapeXml, planToSvg, SVG_SCALE } from './svg';
import { ProjectSchema, type Project } from './schemas';

const kitchen: Project = ProjectSchema.parse({
  id: 'p',
  name: 'Mum & Dad’s <kitchen>',
  units: 'mm',
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-30T10:00:00.000Z',
  revision: 12,
  photos: [],
  room: {
    polygon: [
      [0, 0],
      [3600, 0],
      [3600, 3000],
      [0, 3000],
    ],
    walls: ['a', 'b', 'c', 'd'].map((id) => ({ id, thicknessMm: 100 })),
    openings: [
      { id: 'door', wallId: 'c', kind: 'door', positionMm: 2400, widthMm: 800, heightMm: 2100 },
      { id: 'win', wallId: 'a', kind: 'window', positionMm: 1200, widthMm: 1200, heightMm: 1200 },
    ],
  },
  items: [
    { id: 'sink', catalogId: 'sink-base-900', sizeMm: { w: 900, d: 600, h: 870 }, position: { x: 1800, y: 300 }, rotationDeg: 0 },
    { id: 'range', catalogId: 'range-760', sizeMm: { w: 760, d: 650, h: 910 }, position: { x: 3275, y: 1500 }, rotationDeg: 90 },
    {
      id: 'upper',
      catalogId: 'wall-600x320x720',
      mount: 'wall',
      sizeMm: { w: 600, d: 320, h: 720 },
      position: { x: 600, y: 160 },
      rotationDeg: 0,
    },
  ],
  history: [],
});

const svg = planToSvg(kitchen, { labels: { sink: 'Sink base 900 mm' } });

describe('planToSvg', () => {
  it('is sized to print at 1:50, with the room and its margins in plan millimetres', () => {
    const [, vx, vy, vw, vh] = svg.match(/viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/)!.map(Number);
    expect(vx).toBeLessThan(-100);
    expect(vy).toBeLessThan(-100);
    expect(vx + vw).toBeGreaterThan(3700);
    expect(vy + vh).toBeGreaterThan(3100);
    expect(svg).toContain(`width="${Math.round((vw / SVG_SCALE) * 10) / 10}mm"`);
  });

  it('draws every wall, cuts the openings, and draws a door swing and window lines', () => {
    expect(svg.match(/<g id="walls"[\s\S]*?<\/g>/)![0].match(/<polygon/g)).toHaveLength(4);
    expect(svg).toMatch(/<g class="door">.*<path d="M [\d.]+ [\d.]+ A 800 800 0 0 [01] /);
    expect(svg.match(/<g class="window">.*?<\/g>/)![0].match(/<line/g)).toHaveLength(4); // 2 jambs + 2 glass lines
  });

  it('labels items (catalog names when given), dashes wall cabinets, and escapes text', () => {
    expect(svg).toContain('>Sink base 900 mm</text>');
    expect(svg).toContain('>range-760</text>');
    expect(svg).toMatch(/<g class="item wall-mounted">.*stroke-dasharray/);
    expect(svg).toContain('<title>Mum &amp; Dad’s &lt;kitchen&gt;</title>');
    expect(escapeXml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;');
  });

  it('dimensions each wall and adds a scale bar, north arrow, and title block', () => {
    for (const label of ['1 · 3600 mm', '2 · 3000 mm', '3 · 3600 mm', '4 · 3000 mm']) expect(svg).toContain(`>${label}</text>`);
    expect(svg).toContain('<g id="scale-bar">');
    expect(svg).toContain('>2 m</text>');
    expect(svg).toContain('<g id="north"');
    expect(svg).toContain('Scale 1:50 · revision 12 · 2026-09-30 · millimetres');
  });

  it('uses feet and inches for an imperial project', () => {
    const imperial = planToSvg({ ...kitchen, units: 'in' });
    expect(imperial).toContain('>2 · 9&apos; 10&quot;</text>');
    expect(imperial).toContain(">6'</text>");
  });

  it('is a well-formed SVG that renders', async () => {
    const meta = await sharp(Buffer.from(svg)).metadata();
    expect(meta.format).toBe('svg');
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    expect(png.length).toBeGreaterThan(1000);
  });
});
