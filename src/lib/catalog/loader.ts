/**
 * The catalog: a curated seed of standard-size appliances, fixtures, and
 * furniture (plus, from Task 18, generated cabinets). Static data, so it is
 * bundled and loads the same on the server and in the browser.
 */

import seed from './seed.json';
import { CatalogItemSchema, type CatalogCategory, type CatalogItem } from './schema';

export interface Catalog {
  items: CatalogItem[];
  byId: Map<string, CatalogItem>;
}

/**
 * Validate and merge item sources. Throws one error listing every invalid
 * item, and on any duplicate id — a broken catalog should never ship quietly.
 */
export function buildCatalog(...sources: unknown[][]): Catalog {
  const all = sources.flat();
  const problems: string[] = [];
  const items: CatalogItem[] = [];
  all.forEach((raw, i) => {
    const parsed = CatalogItemSchema.safeParse(raw);
    if (parsed.success) {
      items.push(parsed.data);
    } else {
      const id = (raw as { id?: unknown })?.id;
      const issues = parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ');
      problems.push(`item ${i} (${JSON.stringify(id)}): ${issues}`);
    }
  });
  if (problems.length > 0) throw new Error(`invalid catalog items:\n${problems.join('\n')}`);

  const byId = new Map<string, CatalogItem>();
  for (const item of items) {
    if (byId.has(item.id)) throw new Error(`duplicate catalog id "${item.id}"`);
    byId.set(item.id, item);
  }
  return { items, byId };
}

let cached: Catalog | null = null;

/** The shipped catalog (validated once, then cached). */
export function loadCatalog(): Catalog {
  cached ??= buildCatalog(seed);
  return cached;
}

/**
 * Items matching every word of `query` (any order, case-insensitive) in
 * their name, tags, category, or id, optionally within one category.
 */
export function searchCatalog(items: CatalogItem[], query: string, category?: CatalogCategory): CatalogItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    if (category && item.category !== category) return false;
    const haystack = [item.name, item.id, item.category, ...item.tags].join(' ').toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}
