import { projectKind, type Project } from '../plan/schemas';

/** What the project list page shows: name, last change, option link, and enough of the plan to draw a thumbnail. */
export type ProjectSummary = Pick<
  Project,
  'id' | 'name' | 'kind' | 'createdAt' | 'updatedAt' | 'revision' | 'room' | 'items' | 'closet' | 'optionOf'
>;

export function toSummary(project: Project): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    kind: projectKind(project),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    revision: project.revision,
    room: project.room,
    items: project.items,
    ...(project.closet ? { closet: project.closet } : {}),
    ...(project.optionOf ? { optionOf: project.optionOf } : {}),
  };
}

export class ProjectNotFoundError extends Error {
  constructor(id: string) {
    super(`Project not found: ${id}`);
    this.name = 'ProjectNotFoundError';
  }
}

/** Project records. Implementations: FsProjectStore (disk), PgProjectStore (Postgres). */
export interface ProjectStore {
  /** Add a new project. Rejects if the id is not a UUID or is already taken. */
  insert(project: Project): Promise<void>;
  /** The project, or null if there is none with this id (or the id isn't a UUID). */
  load(id: string): Promise<Project | null>;
  /**
   * Load → update → save, atomically per project: concurrent updates run one
   * after another, so none is lost. If `update` throws, nothing is saved.
   * Rejects with ProjectNotFoundError for an unknown project.
   */
  update(id: string, update: (current: Project) => Project | Promise<Project>): Promise<Project>;
  /** Delete the record (not its blobs — see deleteProject in service.ts). False if it didn't exist. */
  remove(id: string): Promise<boolean>;
  /** Every project that parses, newest change first. */
  list(): Promise<ProjectSummary[]>;
  /** Every project whose option group is `groupId` (the original and its options), in any order. */
  group(groupId: string): Promise<Project[]>;
}

/** Bytes by key ("projects/<id>/photos/<photo>.jpg"). Implementations: FsBlobStore (disk), GcsBlobStore. */
export interface BlobStore {
  /** Write (or overwrite) a blob. */
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  /** The bytes, or null if there is no such blob. */
  get(key: string): Promise<Buffer | null>;
  /** Delete a blob. Deleting a missing blob is not an error. */
  delete(key: string): Promise<void>;
  /** Delete every blob under `prefix`, which must end in "/". */
  deletePrefix(prefix: string): Promise<void>;
  /** Copy a blob. Resolves false (and copies nothing) if `from` doesn't exist. */
  copy(from: string, to: string): Promise<boolean>;
}

export type Storage = { projects: ProjectStore; blobs: BlobStore };
