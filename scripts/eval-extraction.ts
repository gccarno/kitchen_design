/**
 * npm run eval:extract [-- <words from a kitchen's name>] [--no-measure] [--save <dir>] [--photos-only]
 *
 * How well does the configured vision model read a room from photos? Renders
 * photos of each sample kitchen (whose true room is known), runs the same
 * extraction the app runs, and prints how far the answer is from the truth.
 * Calls the real model in .env.local: one request per kitchen (two if the
 * first answer is rejected). With --save <dir> --photos-only it only writes the
 * sample photos and calls nothing.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCatalog } from '../src/lib/catalog/loader';
import { extractRoom, providerFromEnv } from '../src/lib/llm';
import { distance, type Point } from '../src/lib/plan/geometry';
import { cornerViews } from '../src/lib/plan/room-photo';
import type { Photo, Project } from '../src/lib/plan/schemas';
import { scoreRoom, type RoomScore } from '../tests/support/room-score';
import { SHAPED_KITCHENS } from '../tests/support/sample-kitchens';
import { buildExample, photoJpeg } from '../tests/support/sample-photos';

/** The app asks for 3–6 photos; more corners than that are thinned out evenly. */
const MOST_PHOTOS = 6;

function thin<T>(all: T[], most: number): T[] {
  if (all.length <= most) return all;
  return Array.from({ length: most }, (_, i) => all[Math.floor((i * all.length) / most)]);
}

/** The wall the user would measure: the one with a window, else the one with a door, else the first. */
function wallToMeasure(truth: Project): { index: number; description: string } {
  const { walls, openings } = truth.room;
  // Only a wall that can't be mistaken for another: "the wall with the window" needs there to be one.
  for (const kind of ['window', 'door'] as const) {
    const withIt = openings.filter((o) => o.kind === kind);
    const wallIds = new Set(withIt.map((o) => o.wallId));
    if (wallIds.size === 1) return { index: walls.findIndex((w) => wallIds.has(w.id)), description: `the wall with the ${kind}` };
  }
  const poly = truth.room.polygon as Point[];
  const lengths = poly.map((p, i) => distance(p, poly[(i + 1) % poly.length]));
  return { index: lengths.indexOf(Math.max(...lengths)), description: 'the longest wall' };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const measure = !args.includes('--no-measure');
  const photosOnly = args.includes('--photos-only');
  const saveAt = args.indexOf('--save');
  const saveDir = saveAt >= 0 ? args[saveAt + 1] : undefined;
  const words = args.filter((a, i) => !a.startsWith('--') && (saveAt < 0 || i !== saveAt + 1)).map((w) => w.toLowerCase());
  const kitchens = SHAPED_KITCHENS.filter((k) => words.every((w) => k.name.toLowerCase().includes(w)));
  if (kitchens.length === 0) throw new Error(`no sample kitchen matches "${words.join(' ')}"`);

  const catalog = loadCatalog();
  const provider = photosOnly ? undefined : providerFromEnv({ onCall: (call) => console.log(`    model call: ${JSON.stringify(call)}`) });
  const rows: Array<{ name: string; seconds: number; score?: RoomScore; error?: string }> = [];

  for (const example of kitchens) {
    const truth = buildExample(example, catalog);
    const jpegs = await Promise.all(thin(cornerViews(truth), MOST_PHOTOS).map((camera) => photoJpeg(truth, camera)));
    const photos: Photo[] = jpegs.map((_, i) => ({ id: `p${i}`, path: `photos/p${i}.jpg`, width: 1024, height: 768 }));
    if (saveDir) {
      mkdirSync(saveDir, { recursive: true });
      jpegs.forEach((jpeg, i) => writeFileSync(join(saveDir, `${example.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${i + 1}.jpg`), jpeg));
    }
    if (!provider) {
      console.log(`${example.name}: ${photos.length} photos${saveDir ? ` saved to ${saveDir}` : ' (pass --save <dir> to keep them)'}`);
      continue;
    }
    const wall = wallToMeasure(truth);
    const poly = truth.room.polygon as Point[];
    const measurements = measure ? [{ description: wall.description, lengthMm: Math.round(distance(poly[wall.index], poly[(wall.index + 1) % poly.length])) }] : [];

    console.log(`\n${example.name}: ${photos.length} photos${measure ? `, ${measurements[0].description} = ${measurements[0].lengthMm} mm` : ', nothing measured'}`);
    const started = Date.now();
    try {
      // An empty room of the same kind, as a new project has before its photos are read.
      const blank: Project = { ...truth, items: [], photos, room: { ...truth.room, polygon: [[0, 0], [3000, 0], [3000, 3000], [0, 3000]], walls: truth.room.walls.slice(0, 4), openings: [] } };
      const result = await extractRoom({ project: blank, provider, measurements, readPhoto: async (photo) => jpegs[photos.indexOf(photo)] });
      const score = scoreRoom(truth.room, result.room);
      rows.push({ name: example.name, seconds: (Date.now() - started) / 1000, score });
      console.log(`    confidence ${result.confidence}; notes: ${result.notes}`);
      console.log(`    outline: ${JSON.stringify(result.room.polygon.map(([x, y]) => [Math.round(x), Math.round(y)]))}`);
      for (const w of result.warnings) console.log(`    warning: ${w}`);
    } catch (err) {
      rows.push({ name: example.name, seconds: (Date.now() - started) / 1000, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
    }
  }

  if (photosOnly) return;
  const signed = (n: number) => `${n > 0 ? '+' : ''}${n}%`;
  console.log('\nResult (sizes are the error against the true room)');
  for (const row of rows) {
    const s = row.score;
    const detail = s
      ? `${s.good ? 'GOOD' : 'OFF '}  sides ${s.sides.got}/${s.sides.want}  area ${signed(s.areaErrorPct)}  long side ${signed(s.longSideErrorPct)}  short side ${signed(s.shortSideErrorPct)}  doors ${s.doors.got}/${s.doors.want}  windows ${s.windows.got}/${s.windows.want}`
      : `FAILED  ${row.error}`;
    console.log(`  ${row.name.padEnd(32)} ${row.seconds.toFixed(0).padStart(4)} s  ${detail}`);
  }
  console.log(`\n${rows.filter((r) => r.score?.good).length} of ${rows.length} good.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
