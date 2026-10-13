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
