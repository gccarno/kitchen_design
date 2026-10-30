/**
 * What the new-project form needs to know about each starter template. Kept
 * apart from the builders so the client bundle doesn't pull in the catalog.
 */

import type { ProjectKind } from '../plan/schemas';

export interface TemplateInfo {
  /** Stable: sent to the API as `templateId`. */
  id: string;
  kind: ProjectKind;
  name: string;
  /** One line: the layout and the room it suits. */
  description: string;
  /** The name a project made from it gets when the user hasn't typed one. */
  defaultProjectName: string;
}

export const TEMPLATE_INFO: TemplateInfo[] = [
  // --- Kitchens ---
  {
    id: 'kitchen-one-wall',
    kind: 'kitchen',
    name: 'One-wall',
    description: 'Everything along one wall in a 4.4 × 3.0 m room. Suits an open-plan or studio kitchen.',
    defaultProjectName: 'One-wall kitchen',
  },
  {
    id: 'kitchen-galley',
    kind: 'kitchen',
    name: 'Galley',
    description: 'Two facing runs in a 2.6 × 4.2 m room, with the sink opposite the range.',
    defaultProjectName: 'Galley kitchen',
  },
  {
    id: 'kitchen-compact-l',
    kind: 'kitchen',
    name: 'Compact L',
    description: 'A small L in a 3.0 × 3.0 m room, with a corner cabinet and a slim fridge.',
    defaultProjectName: 'Compact L kitchen',
  },
  {
    id: 'kitchen-l-shape',
    kind: 'kitchen',
    name: 'L-shape',
    description: 'Two adjoining runs in a 3.3 × 3.3 m room, with room to add a table.',
    defaultProjectName: 'L-shaped kitchen',
  },
  {
    id: 'kitchen-u-shape',
    kind: 'kitchen',
    name: 'U-shape',
    description: 'Three runs around a 3.2 × 3.4 m room, with the sink on the end wall.',
    defaultProjectName: 'U-shaped kitchen',
  },
  {
    id: 'kitchen-l-island',
    kind: 'kitchen',
    name: 'L-shape with island',
    description: 'An L plus a 1.8 m island with three stools, in a 5.0 × 4.0 m room.',
    defaultProjectName: 'L-shaped kitchen with island',
  },
  {
    id: 'kitchen-sample',
    kind: 'kitchen',
    name: 'One wall with island',
    description: 'The sample kitchen: one run, an island and three stools in a 4.2 × 3.6 m room.',
    defaultProjectName: 'Sample kitchen',
  },
  // --- Closets ---
  {
    id: 'closet-double-hang',
    kind: 'closet',
    name: 'Double-hang reach-in',
    description: 'Shirts and trousers on two rods, with shoe shelves and a top shelf. 6 ft wide.',
    defaultProjectName: 'Double-hang closet',
  },
  {
    id: 'closet-hang-and-drawers',
    kind: 'closet',
    name: 'Hanging and drawers',
    description: 'A long-hang rod for dresses, a double-hang section and a four-drawer unit. 6 ft wide.',
    defaultProjectName: 'Hang-and-drawers closet',
  },
  {
    id: 'closet-shelving',
    kind: 'closet',
    name: 'Shelving and storage',
    description: 'A shelf tower, open shelves and a pull-out basket, with no doors. Suits linen or a pantry. 5 ft wide.',
    defaultProjectName: 'Storage closet',
  },
  {
    id: 'closet-kids',
    kind: 'closet',
    name: "Kids' closet",
    description: 'A low rod, low shelves and hooks a child can reach, with space above for out-of-season things. 5 ft wide.',
    defaultProjectName: "Kids' closet",
  },
  {
    id: 'closet-shoes-accessories',
    kind: 'closet',
    name: 'Shoes and accessories',
    description: 'Five tiers of shoe shelves, hooks, a valet rod and a basket behind sliding doors. 4 ft wide, shallow.',
    defaultProjectName: 'Shoe and accessories closet',
  },
  {
    id: 'closet-cleaning',
    kind: 'closet',
    name: 'Cleaning closet',
    description: 'The sample cleaning closet: hooks for tall tools, a supplies tower and a pull-out basket. 4 ft wide.',
    defaultProjectName: 'Sample cleaning closet',
  },
];

export const templatesForKind = (kind: ProjectKind): TemplateInfo[] => TEMPLATE_INFO.filter((t) => t.kind === kind);
