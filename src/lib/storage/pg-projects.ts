import { and, desc, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import { projects } from '../db/schema';
import type { Db } from '../db/types';
import { optionGroupId } from '../plan/options';
import { ProjectSchema, projectKind, type Project } from '../plan/schemas';
import { InvalidProjectIdError, isValidProjectId } from './ids';
import { ProjectNotFoundError, toSummary, type ProjectStore, type ProjectSummary } from './store';

/**
 * Projects in Postgres, one row each, scoped to one owner. `update` locks
 * the row (SELECT … FOR UPDATE) inside a transaction, so concurrent writers
 * — parallel photo uploads, two devices — are applied one after another.
 */
export class PgProjectStore implements ProjectStore {
  constructor(
    private readonly db: Db,
    private readonly ownerId: string | null = null
  ) {}

  private owned(): SQL {
    return this.ownerId === null ? isNull(projects.ownerId) : eq(projects.ownerId, this.ownerId);
  }

  private columns(project: Project) {
    const doc = ProjectSchema.parse(project);
    return {
      name: doc.name,
      kind: projectKind(doc),
      optionOf: doc.optionOf ?? null,
      revision: doc.revision,
      doc,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  async insert(project: Project): Promise<void> {
    if (!isValidProjectId(project.id)) throw new InvalidProjectIdError(project.id);
    await this.db.insert(projects).values({ id: project.id, ownerId: this.ownerId, ...this.columns(project) });
  }

  async load(id: string): Promise<Project | null> {
    if (!isValidProjectId(id)) return null;
    const [row] = await this.db
      .select({ doc: projects.doc })
      .from(projects)
      .where(and(eq(projects.id, id), this.owned()))
      .limit(1);
    return row ? ProjectSchema.parse(row.doc) : null;
  }

  async update(id: string, update: (current: Project) => Project | Promise<Project>): Promise<Project> {
    if (!isValidProjectId(id)) throw new ProjectNotFoundError(id);
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ doc: projects.doc })
        .from(projects)
        .where(and(eq(projects.id, id), this.owned()))
        .for('update');
      if (!row) throw new ProjectNotFoundError(id);
      const next = await update(ProjectSchema.parse(row.doc));
      if (next.id !== id) throw new Error('an update must not change the project id');
      const cols = this.columns(next);
      await tx.update(projects).set(cols).where(eq(projects.id, id));
      return cols.doc;
    });
  }

  async remove(id: string): Promise<boolean> {
    if (!isValidProjectId(id)) return false;
    const gone = await this.db
      .delete(projects)
      .where(and(eq(projects.id, id), this.owned()))
      .returning({ id: projects.id });
    return gone.length > 0;
  }

  async list(): Promise<ProjectSummary[]> {
    // The list never needs history, which is most of a long-lived document.
    const rows = await this.db
      .select({ doc: sql<Project>`${projects.doc} - 'history'` })
      .from(projects)
      .where(this.owned())
      .orderBy(desc(projects.updatedAt));
    return rows.flatMap((row) => {
      const parsed = ProjectSchema.safeParse({ ...row.doc, history: [] });
      return parsed.success ? [toSummary(parsed.data)] : [];
    });
  }

  async group(groupId: string): Promise<Project[]> {
    if (!isValidProjectId(groupId)) return [];
    const rows = await this.db
      .select({ doc: projects.doc })
      .from(projects)
      .where(and(this.owned(), or(eq(projects.id, groupId), eq(projects.optionOf, groupId))));
    return rows
      .flatMap((row) => {
        const parsed = ProjectSchema.safeParse(row.doc);
        return parsed.success ? [parsed.data] : [];
      })
      .filter((p) => optionGroupId(p) === groupId);
  }
}
