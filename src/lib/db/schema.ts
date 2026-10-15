import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { Project } from '../plan/schemas';

/**
 * One row per project. `doc` is the whole Project document (validated with
 * ProjectSchema on every read and write); the other columns copy the fields
 * the list and option-group queries filter and sort on.
 */
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey(),
    /** The owning user. Null until accounts arrive (Phase 2). */
    ownerId: uuid('owner_id'),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    optionOf: uuid('option_of'),
    revision: integer('revision').notNull(),
    doc: jsonb('doc').$type<Project>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (t) => [index('projects_owner_updated_idx').on(t.ownerId, t.updatedAt), index('projects_option_of_idx').on(t.optionOf)]
);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

/** Session tokens; only the SHA-256 digest of the token is stored. */
export const authTokens = pgTable('auth_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  label: text('label'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'string' }),
});

/**
 * Async LLM work (extract, refine) the client polls. `user_id` is null in
 * disk mode. `status` moves queued → running → done | failed; the claim is a
 * conditional UPDATE, so a job runs at most once per queueing.
 */
export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    input: jsonb('input').notNull(),
    result: jsonb('result'),
    error: jsonb('error'),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'string' }),
  },
  (t) => [index('jobs_user_created_idx').on(t.userId, t.createdAt), index('jobs_status_started_idx').on(t.status, t.startedAt)]
);
