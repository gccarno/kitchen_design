/**
 * Typed closet-edit commands, as proposed by the LLM, compiled into a new
 * project and a JSON Patch — the closet counterpart of `plan/commands.ts`.
 * The LLM names components by the short refs c1… shown on screen; the
 * compiler fills in catalog defaults and keeps everything inside the closet.
 */

import { z } from 'zod';
import { planToJsonPatch } from '../plan/diff';
import { CommandError } from '../plan/commands';
import {
  ClosetComponentKindSchema,
  ClosetDoorStyleSchema,
  projectKind,
  type Closet,
  type ClosetComponent,
  type JsonPatchOp,
  type Project,
} from '../plan/schemas';
import { CLOSET_COMPONENTS, closetFootprint, componentRef, newComponent } from './catalog';
import { validateCloset } from './validate';

const size = {
  widthMm: z.number().positive().optional(),
  heightMm: z.number().positive().optional(),
  depthMm: z.number().positive().optional(),
};

export const ClosetCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('setClosetSize'), ...size }),
  z.object({
    type: z.literal('setOpening'),
    style: ClosetDoorStyleSchema.optional(),
    leftMm: z.number().min(0).optional(),
    widthMm: z.number().positive().optional(),
  }),
  z.object({
    type: z.literal('addComponent'),
    kind: ClosetComponentKindSchema,
    /** Left edge from the closet's left side. */
    xMm: z.number(),
    /** Height above the floor (a box's bottom); default: the kind's standard height. */
    yMm: z.number().optional(),
    ...size,
    count: z.number().int().positive().optional(),
  }),
  z.object({ type: z.literal('moveComponent'), component: z.string(), xMm: z.number().optional(), yMm: z.number().optional() }),
  z.object({
    type: z.literal('resizeComponent'),
    component: z.string(),
    ...size,
    count: z.number().int().positive().optional(),
  }),
  z.object({ type: z.literal('removeComponent'), component: z.string() }),
  z.object({ type: z.literal('renameProject'), name: z.string().trim().min(1).max(200) }),
]);
export type ClosetCommand = z.infer<typeof ClosetCommandSchema>;

/** The project with `closet` in place and its room outline kept as the closet's footprint. */
export function withCloset(project: Project, closet: Closet): Project {
  return { ...project, closet, room: { ...project.room, polygon: closetFootprint(closet) } };
}

/** Slide (and if need be shrink) a component so it fits inside the closet. */
export function clampComponent(closet: Pick<Closet, 'widthMm' | 'heightMm'>, c: ClosetComponent): ClosetComponent {
  const widthMm = Math.min(c.widthMm, closet.widthMm);
  const height = CLOSET_COMPONENTS[c.kind].box ? Math.min(c.heightMm ?? 0, closet.heightMm) : 0;
  return {
    ...c,
    widthMm,
    ...(CLOSET_COMPONENTS[c.kind].box && c.heightMm !== undefined ? { heightMm: height } : {}),
    xMm: Math.min(Math.max(c.xMm, 0), closet.widthMm - widthMm),
    yMm: Math.min(Math.max(c.yMm, 0), closet.heightMm - height),
  };
}

const range = (n: number) => (n === 1 ? 'c1' : `c1–c${n}`);

/**
 * Apply `commands` in order. Returns the resulting project and the patch
 * from `project` to it. Throws `CommandError` naming the failing command.
 */
export function compileClosetCommands(
  project: Project,
  commands: ClosetCommand[],
  makeId: () => string
): { project: Project; patch: JsonPatchOp[] } {
  if (projectKind(project) !== 'closet' || !project.closet) throw new CommandError('this project is not a closet');
  const refs = new Map(project.closet.components.map((c, i) => [componentRef(i), c.id]));
  let closet = project.closet;
  let name = project.name;

  commands.forEach((cmd, k) => {
    const fail = (msg: string): never => {
      throw new CommandError(`commands[${k}] (${cmd.type}): ${msg}`);
    };
    const find = (ref: string): ClosetComponent => {
      const id = refs.get(ref);
      const c = closet.components.find((x) => x.id === id);
      return c ?? fail(`unknown component "${ref}" — ${refs.size ? `components are ${range(refs.size)}` : 'there are no components'}`);
    };
    const replace = (c: ClosetComponent) => {
      closet = { ...closet, components: closet.components.map((x) => (x.id === c.id ? clampComponent(closet, c) : x)) };
    };
    const defined = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

    switch (cmd.type) {
      case 'setClosetSize': {
        const next = { ...closet, ...defined({ widthMm: cmd.widthMm, heightMm: cmd.heightMm, depthMm: cmd.depthMm }) };
        const o = closet.opening;
        const fullWidth = o.leftMm === 0 && Math.abs(o.widthMm - closet.widthMm) < 1;
        const widthMm = fullWidth ? next.widthMm : Math.min(o.widthMm, next.widthMm);
        closet = { ...next, opening: { ...o, widthMm, leftMm: Math.min(o.leftMm, next.widthMm - widthMm) } };
        break;
      }
      case 'setOpening':
        closet = { ...closet, opening: { ...closet.opening, ...defined({ style: cmd.style, leftMm: cmd.leftMm, widthMm: cmd.widthMm }) } };
        break;
      case 'addComponent': {
        const { type: _type, kind, xMm, ...over } = cmd;
        const c = clampComponent(closet, newComponent(kind, makeId(), xMm, defined(over)));
        closet = { ...closet, components: [...closet.components, c] };
        break;
      }
      case 'moveComponent':
        replace({ ...find(cmd.component), ...defined({ xMm: cmd.xMm, yMm: cmd.yMm }) });
        break;
      case 'resizeComponent':
        replace({
          ...find(cmd.component),
          ...defined({ widthMm: cmd.widthMm, heightMm: cmd.heightMm, depthMm: cmd.depthMm, count: cmd.count }),
        });
        break;
      case 'removeComponent': {
        const c = find(cmd.component);
        closet = { ...closet, components: closet.components.filter((x) => x.id !== c.id) };
        break;
      }
      case 'renameProject':
        name = cmd.name;
        break;
    }

    // Stop at the first command that breaks the closet, so the error points at it.
    const check = validateCloset(closet);
    if (!check.valid) fail(`the result would be invalid: ${check.errors.join('; ')}`);
  });

  const next = withCloset({ ...project, name }, closet);
  return { project: next, patch: planToJsonPatch(project, next) };
}
