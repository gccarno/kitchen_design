/**
 * Starter templates for a new kitchen or closet. A template is a function
 * that furnishes a freshly created project; the metadata the form shows
 * lives in `info.ts`.
 */

import type { Catalog } from '../catalog/loader';
import { projectKind, type Project } from '../plan/schemas';
import { CLOSET_BUILDERS } from './closet';
import { TEMPLATE_INFO, type TemplateInfo } from './info';
import { KITCHEN_BUILDERS } from './kitchen';

export { TEMPLATE_INFO, templatesForKind, type TemplateInfo } from './info';

export function getTemplateInfo(id: string): TemplateInfo | undefined {
  return TEMPLATE_INFO.find((t) => t.id === id);
}

/**
 * `base` (a freshly created project of the template's kind) furnished as the
 * template; id, name, units and dates are kept. Throws for an unknown id, or
 * for a template of the other kind than `base`.
 */
export function buildFromTemplate(id: string, base: Project, catalog: Catalog, makeId: () => string): Project {
  const info = getTemplateInfo(id);
  if (!info) throw new Error(`unknown template "${id}"`);
  if (info.kind !== projectKind(base)) throw new Error(`template "${id}" is for a ${info.kind}, not a ${projectKind(base)}`);
  return info.kind === 'closet' ? CLOSET_BUILDERS[id](base, makeId) : KITCHEN_BUILDERS[id](base, catalog, makeId);
}

/** Ids that have metadata but no builder, and the reverse: both should be empty. */
export function templateRegistryGaps(): { noBuilder: string[]; noInfo: string[] } {
  const builders = new Set([...Object.keys(KITCHEN_BUILDERS), ...Object.keys(CLOSET_BUILDERS)]);
  const infos = new Set(TEMPLATE_INFO.map((t) => t.id));
  return { noBuilder: [...infos].filter((id) => !builders.has(id)), noInfo: [...builders].filter((id) => !infos.has(id)) };
}
