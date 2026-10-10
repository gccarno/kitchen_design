/**
 * Typed plan-edit commands, as proposed by the LLM, compiled into a new
 * plan and a JSON Patch. The LLM never writes patch paths: it names things
 * by short refs — items i1…, walls w1… (as labelled on screen), openings
 * o1… — and the compiler does the geometry with the same placement and
 * opening functions the canvas uses.
 */

import { z } from 'zod';
import type { Catalog } from '../catalog/loader';
import { planToJsonPatch } from './diff';
import { addOpening, alongWallMm, removeOpening } from './openings';
import { placedFromCatalog, positionItem } from './placement';
import { packRun } from './runs';
import { OpeningKindSchema, type JsonPatchOp, type Project } from './schemas';
import { validateRoom } from './validate';
import type { Point } from './geometry';

const position = {
  /** Put it against this wall (a wall ref, e.g. "w1"). */
  wall: z.string().optional(),
  /** Distance along that wall from its start corner to the item's centre, mm. */
  alongMm: z.number().optional(),
  /** Or: the item's centre, mm, anywhere in the room. */
  x: z.number().optional(),
  y: z.number().optional(),
};

export const CommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('addItem'), catalogId: z.string(), ...position, rotationDeg: z.number().optional() }),
  z.object({
    type: z.literal('addRun'),
    wall: z.string(),
    /** Catalog ids, in order from the wall's start corner toward its end. */
    items: z.array(z.string()).min(1).max(20),
    /** Push the run against the start or end corner, or centre it (default: start). */
    from: z.enum(['start', 'end', 'centre', 'center']).optional(),
  }),
  z.object({ type: z.literal('moveItem'), item: z.string(), ...position }),
  z.object({ type: z.literal('rotateItem'), item: z.string(), rotationDeg: z.number() }),
  z.object({ type: z.literal('removeItem'), item: z.string() }),
  z.object({ type: z.literal('setWallThickness'), wall: z.string(), thicknessMm: z.number().positive() }),
  z.object({
    type: z.literal('addOpening'),
    wall: z.string(),
    kind: OpeningKindSchema,
    /** Centre of the opening along the wall from its start corner, mm (default: middle). */
    alongMm: z.number().optional(),
    widthMm: z.number().positive().optional(),
  }),
  z.object({ type: z.literal('removeOpening'), opening: z.string() }),
  z.object({ type: z.literal('renameProject'), name: z.string().trim().min(1).max(200) }),
]);
export type Command = z.infer<typeof CommandSchema>;

/** A command couldn't be applied. The message is written to be fed back to the LLM. */
export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandError';
  }
}

export interface PlanRefs {
  items: Map<string, string>; // ref → item id
  walls: Map<string, number>; // ref → wall index
  openings: Map<string, string>; // ref → opening id
}

/** Short 1-based refs in plan order: i1…, w1… (matching the on-screen wall numbers), o1…. */
export function planRefs(project: Project): PlanRefs {
  return {
    items: new Map(project.items.map((it, i) => [`i${i + 1}`, it.id])),
    walls: new Map(project.room.walls.map((_, i) => [`w${i + 1}`, i])),
    openings: new Map(project.room.openings.map((o, i) => [`o${i + 1}`, o.id])),
  };
}

const range = (prefix: string, n: number) => (n === 1 ? `${prefix}1` : `${prefix}1–${prefix}${n}`);

/**
 * Apply `commands` in order. Returns the resulting project and the patch
 * from `project` to it. Throws `CommandError` naming the failing command.
 */
export function compileCommands(
  project: Project,
  commands: Command[],
  catalog: Catalog,
  makeId: () => string
): { project: Project; patch: JsonPatchOp[] } {
  const refs = planRefs(project);
  const itemRef = new Map([...refs.items].map(([ref, id]) => [id, ref]));
  const openingRef = new Map([...refs.openings].map(([ref, id]) => [id, ref]));
  let room = project.room;
  let items = project.items;
  let name = project.name;

  commands.forEach((cmd, k) => {
    const fail = (msg: string): never => {
      throw new CommandError(`commands[${k}] (${cmd.type}): ${msg}`);
    };
    const wallIndex = (ref: string) =>
      refs.walls.get(ref) ?? fail(`unknown wall "${ref}" — walls are ${range('w', refs.walls.size)}`);
    const itemId = (ref: string) => {
      const id = refs.items.get(ref);
      if (id === undefined || !items.some((it) => it.id === id)) {
        fail(`unknown item "${ref}" — ${refs.items.size ? `items are ${range('i', refs.items.size)}` : 'there are no items'}`);
      }
      return id!;
    };
    const wallPoint = (i: number, along: number): Point => {
      const [a, b] = [room.polygon[i], room.polygon[(i + 1) % room.polygon.length]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return [a[0] + ((b[0] - a[0]) * along) / len, a[1] + ((b[1] - a[1]) * along) / len];
    };
    const wallLen = (i: number) => {
      const [a, b] = [room.polygon[i], room.polygon[(i + 1) % room.polygon.length]];
      return Math.hypot(b[0] - a[0], b[1] - a[1]);
    };
    const attempt = <T>(f: () => T): T => {
      try {
        return f();
      } catch (err) {
        if (err instanceof CommandError) throw err;
        return fail((err as Error).message);
      }
    };

    switch (cmd.type) {
      case 'addItem': {
        const cat = catalog.byId.get(cmd.catalogId) ?? fail(`unknown catalog id "${cmd.catalogId}"`);
        const pose = attempt(() => {
          if (cmd.wall !== undefined) {
            const i = wallIndex(cmd.wall);
            const at = wallPoint(i, cmd.alongMm ?? wallLen(i) / 2);
            return positionItem(room, cat.sizeMm, cat.mount, at, { wallIndex: i });
          }
          if (cmd.x !== undefined && cmd.y !== undefined) {
            return positionItem(room, cat.sizeMm, cat.mount, [cmd.x, cmd.y], { rotationDeg: cmd.rotationDeg ?? 0, free: true });
          }
          return fail('needs a wall (and optionally alongMm) or x and y');
        });
        items = [...items, placedFromCatalog(cat, pose, makeId())];
        break;
      }
      case 'addRun': {
        const i = wallIndex(cmd.wall);
        const cats = cmd.items.map((id) => catalog.byId.get(id) ?? fail(`unknown catalog id "${id}"`));
        const from = cmd.from === 'center' ? 'centre' : (cmd.from ?? 'start');
        const centres = attempt(() =>
          packRun(room, items, i, cats.map((c) => ({ ...c, catalogId: c.id })), from, {
            item: (it) => itemRef.get(it.id) ?? `${it.catalogId} (added by an earlier command)`,
            opening: (o) => `${o.kind.replace('_', '-')} ${openingRef.get(o.id) ?? ''}`.trim(),
          })
        );
        cats.forEach((cat, k) => {
          const pose = attempt(() => positionItem(room, cat.sizeMm, cat.mount, wallPoint(i, centres[k]), { wallIndex: i }));
          items = [...items, placedFromCatalog(cat, pose, makeId())];
        });
        break;
      }
      case 'moveItem': {
        const id = itemId(cmd.item);
        const it = items.find((x) => x.id === id)!;
        const pose = attempt(() => {
          if (cmd.wall !== undefined) {
            const i = wallIndex(cmd.wall);
            const along = cmd.alongMm ?? alongWallMm(room, i, [it.position.x, it.position.y]);
            return positionItem(room, it.sizeMm, it.mount ?? 'floor', wallPoint(i, along), {
              wallIndex: i,
              rotationDeg: it.rotationDeg,
            });
          }
          if (cmd.x !== undefined && cmd.y !== undefined) {
            return positionItem(room, it.sizeMm, it.mount ?? 'floor', [cmd.x, cmd.y], { rotationDeg: it.rotationDeg, free: true });
          }
          return fail('needs a wall (and optionally alongMm) or x and y');
        });
        items = items.map((x) => (x.id === id ? { ...x, position: pose.position, rotationDeg: pose.rotationDeg } : x));
        break;
      }
      case 'rotateItem': {
        const id = itemId(cmd.item);
        const deg = ((cmd.rotationDeg % 360) + 360) % 360;
        items = items.map((x) => (x.id === id ? { ...x, rotationDeg: deg } : x));
        break;
      }
      case 'removeItem': {
        const id = itemId(cmd.item);
        items = items.filter((x) => x.id !== id);
        break;
      }
      case 'setWallThickness': {
        const i = wallIndex(cmd.wall);
        room = { ...room, walls: room.walls.map((w, j) => (j === i ? { ...w, thicknessMm: cmd.thicknessMm } : w)) };
        break;
      }
      case 'addOpening': {
        const i = wallIndex(cmd.wall);
        const centre = cmd.alongMm ?? wallLen(i) / 2;
        const id = makeId();
        room = attempt(() => addOpening(room, i, centre, cmd.kind, id));
        if (cmd.widthMm !== undefined) {
          const width = Math.min(cmd.widthMm, wallLen(i));
          const pos = Math.min(Math.max(centre - width / 2, 0), wallLen(i) - width);
          room = { ...room, openings: room.openings.map((o) => (o.id === id ? { ...o, widthMm: width, positionMm: pos } : o)) };
        }
        break;
      }
      case 'removeOpening': {
        const id =
          refs.openings.get(cmd.opening) ??
          fail(
            `unknown opening "${cmd.opening}" — ${refs.openings.size ? `openings are ${range('o', refs.openings.size)}` : 'there are no openings'}`
          );
        room = removeOpening(room, id);
        break;
      }
      case 'renameProject':
        name = cmd.name;
        break;
    }

    // Stop at the first command that breaks the plan, so the error points at it.
    const check = validateRoom(room, items);
    if (!check.valid) fail(`the result would be invalid: ${check.errors.join('; ')}`);
  });

  const next: Project = { ...project, name, room, items };
  return { project: next, patch: planToJsonPatch(project, next) };
}
